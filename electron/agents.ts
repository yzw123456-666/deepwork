// ---------- Agent 包管理（在线市场，双线路）----------
// 【概念统一 2026-09-29】原「插件包」统一更名为 Agent。
// 一个 Agent 包 = agent（专属人格提示词）+ skills（安装后成为可 use_skill 的技能），
// 未来可在此结构上扩展 tools（自定义工具）。
//
// 【真实在线下载】Agent 清单 agents.json 托管在两个公开源（与更新器同款线路）：
//   1) 文汇百川（主源，国内快）  2) GitHub Releases（兜底，latest/download/agents.json）
// 启动/刷新时并发拉取，先成功者采用；两个源都拉不到 → 离线状态，
// 此时只能查看/卸载本地已安装的 Agent，未安装的不可安装（无内置兜底）。
//
// 安装 = 从在线清单取该 Agent 完整定义 → 写 userData/agents/<id>/_installed.json
//        → 包内技能写入 userData/skills/<slug>/（复用技能机制，use_skill 立即可用）。
// 卸载 = 按记录的 skillSlugs 清理技能 + 删 Agent 目录。
//
// 如何编写新 Agent：见 文档/Agent包编写指南.md；发布 = scripts/make-agents-catalog.cjs --publish

import fs from 'fs'
import path from 'path'
import { skillsDir } from './skills'

export interface AgentSkillDef {
  slug: string
  name: string
  description: string
  /** SKILL.md 完整正文（含 frontmatter） */
  content: string
}

export interface AgentPackageDef {
  id: string
  name: string
  version: string
  description: string
  /** 展示用 emoji 图标 */
  icon: string
  /** 任务选用该 Agent 时注入 systemPrompt 的专属人格/工作方式 */
  agentPrompt: string
  skills: AgentSkillDef[]
}

export interface InstalledAgentMark {
  id: string
  installedAt: number
  /** 安装时固化的完整 Agent 定义（离线时 persona 注入与展示都读这里） */
  agent: AgentPackageDef
  /** 本 Agent 安装到技能目录的 slug 列表，卸载时按此清理 */
  skillSlugs: string[]
}

// Agent 清单地址（与 update.exe 的 sources.json 同源思路：文汇百川主源 + GitHub 兜底）
const CATALOG_URLS = [
  'https://s100636-weba.publicos.cn/deepwork-update/agents.json',
  'https://github.com/yzw123456-666/deepwork/releases/latest/download/agents.json',
]

const FETCH_TIMEOUT_MS = 8000

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(id || ''))
}

function validatePackage(p: any): p is AgentPackageDef {
  return !!p
    && typeof p.id === 'string' && isSafeId(p.id)
    && typeof p.name === 'string' && !!p.name
    && typeof p.agentPrompt === 'string'
    && Array.isArray(p.skills)
    && p.skills.every((s: any) => s && typeof s.slug === 'string' && isSafeId(s.slug) && typeof s.content === 'string')
}

// ---------- 在线清单拉取 ----------

let catalogCache: { agents: AgentPackageDef[]; fetchedAt: number } | null = null

async function fetchOne(url: string): Promise<AgentPackageDef[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'deepwork-agents' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: any = await res.json()
    const list = Array.isArray(data?.agents) ? data.agents : []
    const valid = list.filter(validatePackage)
    if (valid.length === 0) throw new Error('清单为空或格式非法')
    return valid
  } finally {
    clearTimeout(timer)
  }
}

/** 并发拉取双线路，任一成功即返回（先到先用）；全失败返回 null（离线） */
export async function fetchCatalog(): Promise<{ agents: AgentPackageDef[] } | null> {
  const jobs = CATALOG_URLS.map(u => fetchOne(u).catch(() => null))
  const results = await Promise.all(jobs)
  const ok = results.find(r => r !== null)
  if (ok) {
    catalogCache = { agents: ok, fetchedAt: Date.now() }
    return { agents: ok }
  }
  return null
}

// ---------- 本地安装状态 ----------

export function agentsDir(userData: string): string {
  return path.join(userData, 'agents')
}

function markPath(dir: string, id: string): string {
  return path.join(dir, id, '_installed.json')
}

function readMark(dir: string, id: string): InstalledAgentMark | null {
  try {
    const p = markPath(dir, id)
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8').trim()
    if (!raw) return null
    const j = JSON.parse(raw) as InstalledAgentMark
    return j?.agent?.id ? j : null
  } catch {
    return null
  }
}

function listLocal(userData: string): InstalledAgentMark[] {
  const dir = agentsDir(userData)
  try {
    if (!fs.existsSync(dir)) return []
    const out: InstalledAgentMark[] = []
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.') || name.startsWith('_')) continue
      const m = readMark(dir, name)
      if (m) out.push(m)
    }
    return out.sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0))
  } catch {
    return []
  }
}

/** 渲染层列表：在线 → 清单全量 + installed 标志；离线 → 仅已安装 */
export async function listAgents(userData: string) {
  const local = listLocal(userData)
  const cat = await fetchCatalog()
  const toItem = (p: AgentPackageDef, installed: boolean, installedAt: number) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    icon: p.icon,
    agentCount: 1,
    skillCount: p.skills.length,
    skillNames: p.skills.map(s => s.name),
    installed,
    installedAt,
  })
  if (cat) {
    const installedIds = new Set(local.map(m => m.id))
    return {
      ok: true,
      online: true,
      agents: cat.agents.map(p => toItem(p, installedIds.has(p.id), local.find(m => m.id === p.id)?.installedAt || 0)),
      // 在线清单已不收录但本地仍安装的（可卸载）
      localOnly: local.filter(m => !cat.agents.some(p => p.id === m.id)).map(m => toItem(m.agent, true, m.installedAt)),
    }
  }
  // 离线
  return {
    ok: true,
    online: false,
    agents: [],
    localOnly: local.map(m => toItem(m.agent, true, m.installedAt)),
  }
}

/** 读取已安装 Agent 的完整定义（供对话运行时注入人格；离线可用） */
export function getAgent(userData: string, id: string) {
  const m = readMark(agentsDir(userData), id)
  if (!m) return { ok: false, error: `Agent 未安装: ${id}` }
  return { ok: true, agent: { ...m.agent, installed: true, installedAt: m.installedAt } }
}

/** 安装：从在线清单取定义（缓存优先，过期/缺失则现拉）→ 写盘 */
export async function installAgent(userData: string, id: string): Promise<{ ok: boolean; error?: string; installedSkills?: string[] }> {
  if (!isSafeId(id)) return { ok: false, error: `非法的 Agent 标识: ${id}` }
  // 缓存 5 分钟内直接用；否则重新拉
  let def: AgentPackageDef | undefined
  if (catalogCache && Date.now() - catalogCache.fetchedAt < 5 * 60 * 1000) {
    def = catalogCache.agents.find(p => p.id === id)
  }
  if (!def) {
    const cat = await fetchCatalog()
    def = cat?.agents.find(p => p.id === id)
  }
  if (!def) return { ok: false, error: '无法获取 Agent 包（请检查网络后重试）' }

  const dir = agentsDir(userData)
  try {
    fs.mkdirSync(path.join(dir, id), { recursive: true })
    // 技能落盘：userData/skills/<slug>/SKILL.md + _install.json
    const sDir = skillsDir(userData)
    fs.mkdirSync(sDir, { recursive: true })
    const installedSkills: string[] = []
    for (const s of def.skills) {
      const base = path.join(sDir, s.slug)
      fs.mkdirSync(base, { recursive: true })
      fs.writeFileSync(path.join(base, 'SKILL.md'), s.content, 'utf-8')
      const meta = {
        slug: s.slug,
        name: s.name,
        desc: s.description,
        version: def.version,
        iconUrl: '',
        owner: `agent:${def.id}`,
        category: 'Agent',
        installedAt: Date.now(),
        enabled: true,
      }
      fs.writeFileSync(path.join(base, '_install.json'), JSON.stringify(meta, null, 2), 'utf-8')
      installedSkills.push(s.slug)
    }
    const mark: InstalledAgentMark = {
      id,
      installedAt: Date.now(),
      agent: def,
      skillSlugs: installedSkills,
    }
    fs.writeFileSync(markPath(dir, id), JSON.stringify(mark, null, 2), 'utf-8')
    return { ok: true, installedSkills }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Agent 安装失败' }
  }
}

/** 卸载：清理本 Agent 装入的技能 + 删 Agent 目录 */
export function uninstallAgent(userData: string, id: string): { ok: boolean; error?: string } {
  if (!isSafeId(id)) return { ok: false, error: `非法的 Agent 标识: ${id}` }
  const dir = agentsDir(userData)
  try {
    const m = readMark(dir, id)
    if (!m) return { ok: false, error: `Agent 未安装: ${id}` }
    const sDir = skillsDir(userData)
    for (const slug of m.skillSlugs || []) {
      try { fs.rmSync(path.join(sDir, slug), { recursive: true, force: true }) } catch { /* 单个清理失败不阻断 */ }
    }
    fs.rmSync(path.join(dir, id), { recursive: true, force: true })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Agent 卸载失败' }
  }
}
