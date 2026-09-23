// ---------- 技能包管理（本地安装 / 卸载 / 启用 / 读取）----------
// 技能来自 ClawHub（SkillHub 的上游），下载接口：
//   GET https://clawhub.ai/api/v1/download?slug={slug}&owner={owner}  → application/zip
// slug 有歧义时接口会返回 409，携带 owner 即可定位；owner 取自 SkillHub 列表的 upstream_owner_login。

import fs from 'fs'
import path from 'path'
import { unzipBuffer } from './zip'
import { requestBuffer } from './websearch'

export const CLAWHUB_API = 'https://clawhub.ai/api/v1'
const MAX_ZIP_BYTES = 30 * 1024 * 1024 // 技能包体积上限 30MB

export interface SkillMeta {
  slug: string
  name: string
  desc?: string
  version?: string
  iconUrl?: string
  owner?: string
  category?: string
  installedAt: number
  enabled: boolean
  files?: string[]
}

export type UrlGuard = (url: string, label: string) => Promise<{ ok: boolean; error?: string; notice?: string }>

// ---------- 极简 YAML frontmatter 解析 ----------
// 只支持技能包实际会用到的两种写法：
//   key: value
//   key: |        （后续缩进行拼接为多行文本）
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return out
  const lines = m[1].split(/\r?\n/)
  let key = ''
  let block = false
  const flush = () => {
    if (key) out[key] = out[key] ?? ''
    key = ''
    block = false
  }
  for (const line of lines) {
    if (!line.trim()) { if (block) continue; flush(); continue }
    if (/^\s/.test(line) && block && key) {
      out[key] = (out[key] ? out[key] + ' ' : '') + line.trim()
      continue
    }
    flush()
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    key = kv[1]
    const val = kv[2].trim()
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      out[key] = ''
      block = true
    } else {
      out[key] = val.replace(/^['"]|['"]$/g, '')
      block = false
      key = ''
    }
  }
  flush()
  return out
}

// 从已解压的技能目录里补全元信息：SKILL.md frontmatter 优先，其次包内 _meta.json
export function extractLocalMeta(base: string): { name?: string; desc?: string; version?: string } {
  const out: { name?: string; desc?: string; version?: string } = {}
  try {
    const metaPath = path.join(base, '_meta.json')
    if (fs.existsSync(metaPath)) {
      const j = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, any>
      if (typeof j.version === 'string' && j.version) out.version = j.version
    }
  } catch { /* 包内元信息缺失不影响安装 */ }

  const skillFile = ['SKILL.md', 'skill.md', 'SKILL.MD'].find(f => fs.existsSync(path.join(base, f)))
  if (skillFile) {
    try {
      const fm = parseFrontmatter(fs.readFileSync(path.join(base, skillFile), 'utf-8'))
      if (fm.displayName) out.name = fm.displayName
      else if (fm.name) out.name = fm.name
      if (fm.description) out.desc = fm.description
      if (fm.version) out.version = fm.version
    } catch { /* frontmatter 解析失败不影响安装 */ }
  }
  return out
}

export function skillsDir(userData: string): string {
  return path.join(userData, 'skills')
}

// slug 只允许安全字符：它会被拼进目录路径
export function isSafeSlug(slug: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(slug || ''))
}

function readInstalled(dir: string, slug: string): SkillMeta | null {
  try {
    const p = path.join(dir, slug, '_install.json')
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8').trim()
    if (!raw) return null
    return JSON.parse(raw) as SkillMeta
  } catch {
    return null
  }
}

function writeInstalled(dir: string, meta: SkillMeta) {
  fs.mkdirSync(path.join(dir, meta.slug), { recursive: true })
  fs.writeFileSync(path.join(dir, meta.slug, '_install.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

// 列出本地已安装技能（目录存在但没有 _install.json 时按目录名兜底）
export function listSkills(dir: string): SkillMeta[] {
  try {
    if (!fs.existsSync(dir)) return []
    const out: SkillMeta[] = []
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.') || name.startsWith('_tmp-')) continue
      const full = path.join(dir, name)
      if (!fs.statSync(full).isDirectory()) continue
      const meta = readInstalled(dir, name)
      if (meta) {
        out.push({ ...meta, slug: meta.slug || name, enabled: meta.enabled !== false })
      } else {
        const local = extractLocalMeta(full)
        out.push({
          slug: name,
          name: local.name || name,
          desc: local.desc || '',
          version: local.version || '',
          installedAt: (fs.statSync(full).mtimeMs || Date.now()),
          enabled: true,
        })
      }
    }
    return out.sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
  } catch {
    return []
  }
}

export function removeSkill(dir: string, slug: string): boolean {
  if (!isSafeSlug(slug)) return false
  const target = path.join(dir, slug)
  if (!fs.existsSync(target)) return false
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function setSkillEnabled(dir: string, slug: string, enabled: boolean): boolean {
  if (!isSafeSlug(slug)) return false
  const meta = readInstalled(dir, slug)
  if (!meta) return false
  meta.enabled = !!enabled
  writeInstalled(dir, meta)
  return true
}

// 读取技能正文（SKILL.md），供 use_skill 工具注入给模型
export function readSkill(dir: string, slug: string, maxChars = 20000): { ok: boolean; content?: string; files?: string[]; error?: string } {
  if (!isSafeSlug(slug)) return { ok: false, error: `非法的技能名: ${slug}` }
  const base = path.join(dir, slug)
  if (!fs.existsSync(base)) return { ok: false, error: `技能未安装: ${slug}` }

  const files: string[] = []
  try {
    // 深度上限 + 不跟随符号链接：技能包里放个指向上级目录的软链就会无限递归
    const walk = (d: string, rel: string, depth: number) => {
      if (files.length > 200 || depth > 6) return
      for (const item of fs.readdirSync(d)) {
        if (item === '_install.json' || item.startsWith('.')) continue
        const full = path.join(d, item)
        const st = fs.lstatSync(full)
        if (st.isSymbolicLink()) continue
        const r = rel ? `${rel}/${item}` : item
        if (st.isDirectory()) walk(full, r, depth + 1)
        else files.push(r)
      }
    }
    walk(base, '', 0)
  } catch { /* 清单失败不影响正文 */ }

  const candidates = ['SKILL.md', 'skill.md', 'SKILL.MD', ...files.filter(f => f.toLowerCase().endsWith('.md'))]
  const picked = candidates.find(f => fs.existsSync(path.join(base, f)))
  if (!picked) return { ok: false, error: `技能「${slug}」没有可读取的说明文件`, files }
  try {
    let content = fs.readFileSync(path.join(base, picked), 'utf-8')
    if (content.length > maxChars) content = content.slice(0, maxChars) + `\n…（技能正文共 ${content.length} 字符，已截断）`
    return { ok: true, content, files }
  } catch (e: any) {
    return { ok: false, error: e?.message || '读取技能失败', files }
  }
}

export interface InstallOptions {
  slug: string
  owner?: string
  name?: string
  desc?: string
  version?: string
  iconUrl?: string
  category?: string
}

// 下载并安装技能包：下载 → 校验 → 解压到临时目录 → 替换目标目录 → 写元信息
export async function installSkill(
  dir: string,
  opts: InstallOptions,
  guard: UrlGuard
): Promise<{ ok: boolean; meta?: SkillMeta; error?: string; notice?: string }> {
  const slug = String(opts.slug || '').trim()
  if (!isSafeSlug(slug)) return { ok: false, error: `非法的技能标识: ${slug}` }

  const url = `${CLAWHUB_API}/download?slug=${encodeURIComponent(slug)}` +
    (opts.owner ? `&owner=${encodeURIComponent(opts.owner)}` : '')

  const g = await guard(url, `下载技能包 ${slug}`)
  if (!g.ok) return { ok: false, error: g.error || '安全策略阻止了本次下载' }

  fs.mkdirSync(dir, { recursive: true })
  const tmpDir = path.join(dir, `_tmp-${process.pid}-${Date.now()}`)
  try {
    const res = await requestBuffer(url, 40000, async (nextUrl) => {
      const rg = await guard(nextUrl, `下载跳转到 ${nextUrl}`)
      return rg.ok
    })
    if (res.status >= 400) return { ok: false, error: `下载失败：HTTP ${res.status}（该技能可能暂不支持打包下载）` }
    if (res.body.length === 0) return { ok: false, error: '下载内容为空' }
    if (res.body.length > MAX_ZIP_BYTES) return { ok: false, error: '技能包过大（>30MB），已取消安装' }

    fs.mkdirSync(tmpDir, { recursive: true })
    const unzipped = unzipBuffer(res.body, tmpDir)

    // 有些包把内容放在单一子目录里（如 dev-expert/SKILL.md），需要提一层
    let payloadDir = tmpDir
    const entries = fs.readdirSync(tmpDir)
    const hasSkillFile = (d: string) => fs.existsSync(path.join(d, 'SKILL.md'))
    if (!hasSkillFile(tmpDir) && entries.length === 1) {
      const only = path.join(tmpDir, entries[0])
      if (fs.statSync(only).isDirectory() && hasSkillFile(only)) payloadDir = only
    }

    // 原子替换：早期版本是「先 rmSync(target) 再拷」，拷贝中途失败（磁盘满 / 文件占用）
    // 会让已装技能直接消失。改为先落到暂存目录，再整体换名。
    const target = path.join(dir, slug)
    const staging = path.join(dir, `_staging-${process.pid}-${Date.now()}`)
    fs.mkdirSync(staging, { recursive: true })
    try {
      for (const item of fs.readdirSync(payloadDir)) {
        const from = path.join(payloadDir, item)
        const to = path.join(staging, item)
        if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true })
        else fs.copyFileSync(from, to)
      }
    } catch (e: any) {
      try { fs.rmSync(staging, { recursive: true, force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: `解压写入失败：${e?.message || e}` }
    }

    // Windows 上 rename 不能覆盖已存在目录，先把旧版本挪走，成功后再删除
    const oldDir = path.join(dir, `_old-${process.pid}-${Date.now()}`)
    let hasOld = false
    try {
      if (fs.existsSync(target)) {
        fs.renameSync(target, oldDir)
        hasOld = true
      }
      fs.renameSync(staging, target)
    } catch (e: any) {
      // 换名失败：把旧版本放回去，保证原技能还在
      try { if (hasOld) fs.renameSync(oldDir, target) } catch { /* 尽力而为 */ }
      try { fs.rmSync(staging, { recursive: true, force: true }) } catch { /* 忽略 */ }
      return { ok: false, error: `替换技能失败：${e?.message || e}` }
    }
    if (hasOld) {
      try { fs.rmSync(oldDir, { recursive: true, force: true }) } catch { /* 旧版本残留不影响使用 */ }
    }

    // 包内自带的信息最可信，优先用它补全名称/描述/版本
    const local = extractLocalMeta(target)
    const meta: SkillMeta = {
      slug,
      name: local.name || opts.name || slug,
      desc: local.desc || opts.desc || '',
      version: local.version || opts.version || '',
      iconUrl: opts.iconUrl || '',
      owner: opts.owner || '',
      category: opts.category || '',
      installedAt: Date.now(),
      enabled: true,
      files: unzipped.files.slice(0, 200),
    }
    writeInstalled(dir, meta)
    // 有条目被安全策略跳过时告知用户，否则会以为技能包完整安装
    let notice = g.notice || ''
    if (unzipped.skipped > 0) {
      notice = notice ? `${notice}；另有 ${unzipped.skipped} 个条目因越界/加密/超限被跳过` : `另有 ${unzipped.skipped} 个条目因越界/加密/超限被跳过`
    }
    return { ok: true, meta, notice }
  } catch (e: any) {
    return { ok: false, error: e?.message || '安装失败' }
  } finally {
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
}
