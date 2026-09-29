// ---------- 应用更新（免安装版补丁热替换）----------
// 思路：发版时把会变的「核心」resources/app/（dist + dist-electron + package.json，约 3.6MB / 压缩 0.96MB）
// 打成补丁 zip 托管到更新源（文汇百川网站库 / GitHub / 任意静态托管）。软件检测版本 → 点更新 →
// 下载补丁 → sha256 校验 → 解压 → 逐文件覆盖 resources/app → 重启。
// 设计要点：
//  - 解压复用 electron/zip.ts 的 unzipBuffer（自带路径穿越防护、条目/体积上限）
//  - 覆盖禁止用 fs.cpSync（中文路径在本机会段错误），必须 manualCopy（copyFileSync 逐文件）
//  - 校验失败 / 解压失败一律抛错，绝不半截替换，保证原子性（先落临时目录再整体覆盖）

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { unzipBuffer } from './zip'

/** 更新源根地址：version.json 与补丁同目录。生产走文汇百川公开 URL，可用环境变量 DEEPWORK_UPDATE_URL 覆盖（测试用本地服务）。 */
export const UPDATE_BASE_URL: string =
  process.env.DEEPWORK_UPDATE_URL && process.env.DEEPWORK_UPDATE_URL.trim()
    ? process.env.DEEPWORK_UPDATE_URL.trim().replace(/\/+$/, '')
    : 'https://s100636-weba.publicos.cn/deepwork-update'

/** 软件当前版本（来自 package.json，打包后 = app.getVersion()） */
export function currentVersion(): string {
  return app.getVersion()
}

/** 免安装版核心目录 resources/app */
export function getAppDir(): string {
  return path.join(process.resourcesPath, 'app')
}

export interface CheckUpdateResult {
  ok: boolean
  current: string
  latest?: string
  hasUpdate?: boolean
  patchUrl?: string | null
  sha256?: string | null
  size?: number
  notes?: string
  pubDate?: string
  error?: string
}

export interface DownloadResult {
  ok: boolean
  error?: string
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0（仅比较数字段，非数字段忽略） */
export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function resolvePatchUrl(base: string, patch: string | undefined): string | null {
  if (!patch) return null
  if (/^https?:\/\//i.test(patch)) return patch // 绝对地址直接用
  return `${base}/${patch.replace(/^\/+/, '')}` // 相对 base 拼接
}

/** 拉取 JSON（带超时） */
async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** 流式下载为 Buffer，支持进度回调（依赖 content-length） */
async function fetchBuffer(
  url: string,
  onProgress?: (received: number, total: number) => void,
  timeoutMs = 120000,
): Promise<Buffer> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0
    const reader = res.body?.getReader()
    if (!reader) {
      // 无流（理论上不会）：直接整取
      return Buffer.from(await res.arrayBuffer())
    }
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        if (onProgress) onProgress(received, total)
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)))
  } finally {
    clearTimeout(t)
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * 逐文件复制（禁用 cpSync：中文路径在本机会段错误）。
 * 覆盖式：src 的文件写入 dest 同名路径；src 有、dest 无 → 新增；dest 有、src 无 → 保留（补丁不删文件，安全）。
 */
function manualCopy(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      manualCopy(s, d)
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
    }
  }
}

/** 检查更新：拉取 version.json 并与当前版本比对 */
export async function checkUpdate(baseUrl: string, current: string): Promise<CheckUpdateResult> {
  const base = (baseUrl || '').replace(/\/+$/, '')
  const result: CheckUpdateResult = { ok: true, current }
  try {
    // 占位符 / 未配置：给出明确提示，而不是抛出难懂的网络错误
    if (!base || /^https?:\/\/placeholder(\.invalid)?$/i.test(base)) {
      throw new Error('更新源尚未配置（待接入文汇百川）')
    }
    const info = await fetchJson(`${base}/version.json`)
    const latest = String(info.version || '')
    result.latest = latest
    result.hasUpdate = compareVersions(latest, current) > 0
    result.patchUrl = resolvePatchUrl(base, info.patch)
    result.sha256 = info.sha256 || null
    result.size = info.size || 0
    result.notes = info.notes || ''
    result.pubDate = info.pubDate || ''
    return result
  } catch (e: any) {
    return { ok: false, current, error: String(e?.message || e) }
  }
}

/**
 * 下载补丁并应用到 targetDir（默认 resources/app）。
 * 流程：下载 → sha256 校验 → 解压到临时目录 → manualCopy 覆盖 → 清理临时目录。
 * 任何一步失败都抛错，不触碰 targetDir 已有文件（原子性）。
 */
export async function downloadAndApply(
  patchUrl: string,
  expectedSha256: string | null,
  targetDir: string = getAppDir(),
  onProgress?: (received: number, total: number) => void,
): Promise<DownloadResult> {
  try {
    if (!fs.existsSync(targetDir)) {
      throw new Error(`目标目录不存在：${targetDir}`)
    }
    // 1) 下载（补丁可能是 .zip 直链，或 .json 内 base64 封装——文汇百川 file2url 不支持 .zip，用后者）
    let buf: Buffer
    if (/\.json$/i.test(patchUrl)) {
      const raw = await fetchBuffer(patchUrl, onProgress)
      const j = JSON.parse(raw.toString('utf8'))
      if (!j || typeof j.b64 !== 'string') throw new Error('补丁 JSON 缺少 b64 字段')
      buf = Buffer.from(j.b64, 'base64')
    } else {
      buf = await fetchBuffer(patchUrl, onProgress)
    }
    // 2) 校验
    if (expectedSha256 && sha256Hex(buf) !== String(expectedSha256).toLowerCase()) {
      throw new Error('补丁校验失败（sha256 不匹配），已中止更新')
    }
    // 3) 解压到临时目录（unzipBuffer 自带路径穿越 / 体积防护）
    const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'dw-patch-'))
    try {
      const { files, skipped } = unzipBuffer(buf, tmp, {
        maxEntries: 2000,
        maxFileBytes: 30 * 1024 * 1024,
        maxTotalBytes: 80 * 1024 * 1024,
      })
      if (files.length === 0) throw new Error('补丁内无可应用文件')
      if (skipped > 0) console.warn(`[updater] 跳过 ${skipped} 个越界/超限条目`)
      // 4) 覆盖（仅新增/覆盖，不删除 targetDir 既有文件）
      manualCopy(tmp, targetDir)
    } finally {
      // 5) 清理临时目录
      fs.rmSync(tmp, { recursive: true, force: true })
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}
