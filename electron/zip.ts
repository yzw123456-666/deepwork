// ---------- 极简 ZIP 解压（无第三方依赖）----------
// 技能包来自 ClawHub，只用到 store / deflate 两种压缩方式，因此自己解析即可。
// 同时做三重防护：条目数上限、单文件上限、总解压上限、路径穿越拒绝。

import zlib from 'zlib'
import fs from 'fs'
import path from 'path'

export interface UnzipOptions {
  maxEntries?: number      // 最多解压多少个条目（默认 500）
  maxFileBytes?: number    // 单文件解压后上限（默认 8MB）
  maxTotalBytes?: number   // 全部文件解压后总上限（默认 40MB）
}

export interface UnzipResult {
  files: string[]          // 落盘的相对路径
  skipped: number          // 因越界/超限被跳过的条目数
}

const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50
const FLAG_ENCRYPTED = 0x1

function findEocd(buf: Buffer): number {
  // EOCD 在末尾 22 + 65535 字节范围内
  const minStart = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

// 归一化并校验压缩包内路径，返回安全的相对路径；不安全返回 null
function safeEntryName(raw: string): string | null {
  let name = String(raw || '').replace(/\\/g, '/')
  if (!name) return null
  // 拒绝绝对路径 / 盘符 / UNC
  if (/^[a-zA-Z]:/.test(name) || name.startsWith('/') || name.startsWith('//')) return null
  const parts: string[] = []
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return null // 路径穿越
    if (/[<>:"|?*\u0000-\u001f]/.test(seg)) return null
    parts.push(seg)
  }
  if (parts.length === 0) return null
  return parts.join('/')
}

// 创建父目录；父路径已被同名文件占用时返回 false（由调用方按冲突跳过）
function ensureParentDir(filePath: string): boolean {
  const dir = path.dirname(filePath)
  try {
    if (fs.existsSync(dir)) return fs.statSync(dir).isDirectory()
    fs.mkdirSync(dir, { recursive: true })
    return true
  } catch {
    return false
  }
}

export function unzipBuffer(buf: Buffer, destDir: string, opts: UnzipOptions = {}): UnzipResult {
  const maxEntries = opts.maxEntries ?? 500
  const maxFileBytes = opts.maxFileBytes ?? 8 * 1024 * 1024
  const maxTotalBytes = opts.maxTotalBytes ?? 40 * 1024 * 1024

  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到结束记录）')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16) // central directory 起始偏移

  // ---- 第一遍：收集条目元信息，并推断真实目录名 ----
  // 部分打包工具把目录写成没有尾斜杠、大小 0 的条目（如 "references"），
  // 若当作空文件落盘，后面所有 "references/xxx.md" 都会因父路径是文件而被跳过。
  interface Entry {
    method: number; compSize: number; uncompSize: number
    rawName: string; relName: string; dataStart: number
  }
  const entries: Entry[] = []
  const dirNames = new Set<string>()
  let skipped = 0
  let total = 0
  const files: string[] = []

  for (let i = 0; i < entryCount && i < maxEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) break
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const rawName = buf.toString('utf-8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    const relName = safeEntryName(rawName)
    if (!relName) { skipped++; continue }
    if (flags & FLAG_ENCRYPTED) { skipped++; continue }
    if (rawName.endsWith('/')) { dirNames.add(relName); continue }
    // 名字里带 "/" → 其每一级前缀都是目录
    const segs = relName.split('/')
    for (let k = 1; k < segs.length; k++) dirNames.add(segs.slice(0, k).join('/'))
    // 畸形/截断包里 localOff 可能越界，早期版本直接 readUInt32LE 会抛 RangeError
    // 让整个安装以「安装失败」告终，而不是友好地跳过该条目
    if (localOff < 0 || localOff + 30 > buf.length) { skipped++; continue }
    if (buf.readUInt32LE(localOff) !== SIG_LOC) { skipped++; continue }
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    entries.push({ method, compSize, uncompSize, rawName, relName, dataStart: localOff + 30 + lNameLen + lExtraLen })
  }

  // ---- 第二遍：建目录 + 写文件 ----
  for (const name of dirNames) {
    const dirPath = path.join(destDir, name)
    if (fs.existsSync(dirPath)) {
      if (fs.statSync(dirPath).isDirectory()) continue
      try { fs.unlinkSync(dirPath) } catch { /* 冲突文件删不掉就跳过 */ }
    }
    try { fs.mkdirSync(dirPath, { recursive: true }) } catch { /* 忽略 */ }
  }

  for (const e of entries) {
    if (dirNames.has(e.relName)) continue // 实为目录的 0 字节条目
    if (e.uncompSize > maxFileBytes || total + e.uncompSize > maxTotalBytes) { skipped++; continue }

    let data: Buffer
    const raw = buf.subarray(e.dataStart, Math.min(e.dataStart + e.compSize, buf.length))
    try {
      if (e.method === 0) data = Buffer.from(raw)
      else if (e.method === 8) data = zlib.inflateRawSync(raw)
      else { skipped++; continue } // 不支持的压缩算法
    } catch {
      skipped++
      continue
    }
    if (data.length > maxFileBytes) { skipped++; continue }
    total += data.length

    const outPath = path.join(destDir, e.relName)
    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) { skipped++; continue }
    if (!ensureParentDir(outPath)) { skipped++; continue }
    fs.writeFileSync(outPath, data)
    files.push(e.relName)
  }

  if (files.length === 0 && skipped > 0) {
    throw new Error('压缩包内没有可安全解压的文件')
  }
  return { files, skipped }
}
