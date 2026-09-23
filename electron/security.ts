// ---------- 安全中心策略（纯函数，无 Electron 依赖，便于单元测试） ----------
// 供主进程调用：文件黑/白名单、命令放行/询问名单、网络域名规则、删除保护与备份配额

import path from 'path'
import fs from 'fs'

export interface SecurityConfig {
  sandboxEnabled?: boolean          // 总开关：关闭时跳过所有沙箱策略检查
  fileWhitelist?: string            // 每行一个路径：黑名单命中的例外（豁免）
  fileBlacklist?: string            // 每行一个路径：禁止访问
  cmdAllowList?: string             // 每行一个前缀：直接执行
  cmdAskList?: string               // 每行一个前缀：执行前询问用户
  netAllowedDomains?: string        // 每行一个域名：仅这些域名可直接访问（为空表示不限制）
  netBlockedDomains?: string        // 每行一个域名：禁止访问
  deleteProtection?: boolean        // 删除时优先移入回收站
  batchDeleteThreshold?: number     // 一次删除条目数达到该值时需审批
  autoBackup?: boolean              // 修改文件前自动备份
  backupMaxSize?: number            // 备份总上限（MB）
}

export type Decision = 'allow' | 'ask' | 'deny'

export interface PolicyResult {
  decision: Decision
  reason?: string
  matched?: string
}

// 每行一条，忽略空行、去掉首尾空白与行内注释
export function splitLines(text?: string): string[] {
  if (!text) return []
  return String(text)
    .split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
}

// 统一路径写法：正斜杠、去尾部斜杠、Windows 下不区分大小写
export function normalizePath(p: string): string {
  let s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-zA-Z]:$/.test(s)) s += '/'
  return process.platform === 'win32' ? s.toLowerCase() : s
}

// 判断 child 是否位于 parent 之内（或等于 parent）
// 注意：不能直接用 startsWith，否则 C:/root2 会被误判为在 C:/root 内
export function isSubPath(parent: string, child: string): boolean {
  const p = normalizePath(parent)
  const c = normalizePath(child)
  if (!p) return false
  return c === p || c.startsWith(p.endsWith('/') ? p : p + '/')
}

// 路径必须位于授权根目录内，否则抛出（防路径穿越）
// 尽力解析真实路径：目标不存在（新建文件）时向上找到存在的祖先再拼接
function realPathBestEffort(p: string): string {
  const resolved = path.resolve(p)
  try { return fs.realpathSync(resolved) } catch { /* 不存在，继续向上找 */ }
  const tail: string[] = []
  let cur = resolved
  let parent = path.dirname(cur)
  while (parent !== cur) {
    tail.unshift(path.basename(cur))
    try {
      return path.join(fs.realpathSync(parent), ...tail)
    } catch {
      cur = parent
      parent = path.dirname(cur)
    }
  }
  return resolved
}

/**
 * 工具路径归一化（2026-09-22 轮 J：修复「无法创建/写入文件」）。
 * 模型经常无视「相对路径」规则直接给绝对路径——path.join(root, 'D:\x') 会拼出
 * 「root\D:\x」这种含中间冒号的非法路径，写盘必然 ENOENT。这里统一归一：
 *   - 盘符/UNC 绝对路径：在工作目录内 → 直接用（转 resolve 后的绝对路径）；
 *     在工作目录外 → 抛错（越界语义，由 assertInsideRoot 的报错文案保持一致）。
 *   - '/xxx' POSIX 风格：视为工作目录下的相对路径（模型在 Windows 上常这么写）。
 *   - 其余：相对路径，原样 join。
 * 返回值交给 assertInsideRoot 做边界+symlink 校验，安全语义不变。
 */
export function resolveInsideRoot(root: string, relPath: string): string {
  const p = String(relPath || '').trim()
  const resolvedRoot = path.resolve(root)
  // Windows 盘符绝对路径（C:\ / C:/）或 UNC（\\server\share）
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) {
    const abs = path.resolve(p)
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
    const inside = abs === resolvedRoot || abs.startsWith(rootWithSep)
    if (!inside) {
      throw new Error(`路径越界: ${abs} 不在 ${resolvedRoot} 内（请使用相对路径）`)
    }
    return abs
  }
  // POSIX 风格绝对路径 '/xxx'：模型意图几乎总是工作目录下，去掉开头斜杠当相对路径
  const rel = p.startsWith('/') ? p.replace(/^\/+/, '') : p
  return path.join(resolvedRoot, rel)
}

export function assertInsideRoot(root: string, target: string): string {  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (!isSubPath(resolvedRoot, resolvedTarget)) {
    throw new Error(`路径越界: ${resolvedTarget} 不在 ${resolvedRoot} 内`)
  }
  // 符号链接防护：工作目录内的 symlink/junction 可以指向目录之外，
  // 仅做 path.resolve 无法发现，必须解析真实路径再判断一次
  try {
    const realRoot = realPathBestEffort(resolvedRoot)
    const realTarget = realPathBestEffort(resolvedTarget)
    if (!isSubPath(realRoot, realTarget)) {
      throw new Error(`路径越界（符号链接指向目录外部）: ${realTarget} 不在 ${realRoot} 内`)
    }
    return realTarget
  } catch (e: any) {
    // 上面主动抛出的越界错误继续上抛；realpath 自身失败（权限等）时退回解析结果，不阻断操作
    if (String(e?.message || '').includes('路径越界')) throw e
    return resolvedTarget
  }
}

// ---------- 会话级策略旁路（对话页「完全访问」模式，2026-09-22） ----------
// 渲染层显式开关控制（agent:setPolicyBypass IPC），只在内存中生效、不写入 config.json。
// true 时跳过文件黑名单 / 命令询问 / 域名策略 / 批量删除审批 / 回收站删除保护。
// 工作目录边界（assertInsideRoot）不受影响——那是防 AI 跑出工作区乱写的基本盘。
let policyBypass = false
export function setPolicyBypass(v: boolean): void { policyBypass = !!v }
export function isPolicyBypass(): boolean { return policyBypass }

// ---------- 文件安全 ----------
export function evaluateFilePath(cfg: SecurityConfig, absPath: string): PolicyResult {
  if (policyBypass || cfg.sandboxEnabled === false) return { decision: 'allow' }

  const blocked = splitLines(cfg.fileBlacklist).find(entry => isSubPath(entry, absPath))
  if (blocked) {
    const exempt = splitLines(cfg.fileWhitelist).find(entry => isSubPath(entry, absPath))
    if (exempt) return { decision: 'allow', matched: exempt, reason: `黑名单命中但处于白名单例外: ${exempt}` }
    return { decision: 'deny', matched: blocked, reason: `路径命中文件黑名单: ${blocked}` }
  }
  return { decision: 'allow' }
}

// ---------- 命令安全 ----------
// 命中放行名单 → 直接执行；命中询问名单 → 询问用户；都未命中 → 按默认策略执行
export function evaluateCommand(cfg: SecurityConfig, command: string): PolicyResult {
  if (policyBypass || cfg.sandboxEnabled === false) return { decision: 'allow' }

  const cmd = String(command || '').trim()
  const lowered = cmd.toLowerCase()

  const allow = splitLines(cfg.cmdAllowList).find(entry => lowered.startsWith(entry.toLowerCase()))
  if (allow) return { decision: 'allow', matched: allow, reason: `命中命令放行名单: ${allow}` }

  const ask = splitLines(cfg.cmdAskList).find(entry => lowered.startsWith(entry.toLowerCase()))
  if (ask) return { decision: 'ask', matched: ask, reason: `命中命令询问名单: ${ask}` }

  return { decision: 'allow', reason: '未命中任何命令名单，按默认策略执行' }
}

// ---------- 网络安全 ----------
export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function domainMatches(host: string, entry: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^\./, '')
  const e = String(entry || '').toLowerCase().replace(/^\./, '').replace(/^https?:\/\//, '').split('/')[0]
  if (!h || !e) return false
  return h === e || h.endsWith('.' + e)
}

// 内网 / 本机地址判定：web_fetch 是模型可控的抓取入口，默认允许任意域名意味着
// 模型（或被抓网页里的注入指令）可以读 169.254.169.254 云元数据、127.0.0.1 调试端口
const PRIVATE_HOST_NAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata', 'instance-data',
])
function isPrivateHost(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (PRIVATE_HOST_NAMES.has(h)) return true
  // .localhost / .local / .internal 一律视为内网（mDNS 与 k8s 内部域名）
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true

  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
    if (a === 192 && b === 168) return true            // 192.168.0.0/16
    if (a === 169 && b === 254) return true            // 链路本地 / 云元数据
    if (a === 100 && b >= 64 && b <= 127) return true  // 运营商级 NAT
    if (a >= 224) return true                          // 组播与保留段
    return false
  }
  // IPv6：环回、唯一本地、链路本地
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true
  return false
}

// 禁止域名优先；配置了允许域名时，未列入的域名需要用户确认
export function evaluateUrl(cfg: SecurityConfig, url: string): PolicyResult {
  if (policyBypass || cfg.sandboxEnabled === false) return { decision: 'allow' }
  const host = urlHost(url)
  if (!host) return { decision: 'deny', reason: `无法解析的 URL: ${url}` }

  // SSRF 防护：内网 / 本机地址不可通过询问放行，直接拒绝
  if (isPrivateHost(host)) {
    return { decision: 'deny', reason: `禁止访问内网或本机地址: ${host}` }
  }

  const blocked = splitLines(cfg.netBlockedDomains).find(entry => domainMatches(host, entry))
  if (blocked) return { decision: 'deny', matched: blocked, reason: `域名命中禁止名单: ${blocked}` }

  const allowed = splitLines(cfg.netAllowedDomains)
  if (allowed.length > 0) {
    const hit = allowed.find(entry => domainMatches(host, entry))
    if (hit) return { decision: 'allow', matched: hit }
    return { decision: 'ask', reason: `域名 ${host} 不在允许名单内，需要用户确认` }
  }
  return { decision: 'allow' }
}

// ---------- 数据安全 ----------
export function shouldTrash(cfg: SecurityConfig): boolean {
  if (policyBypass) return false // 完全访问：绕过删除保护，直接删除
  return cfg.deleteProtection !== false
}

export function needsBatchApproval(cfg: SecurityConfig, entryCount: number): boolean {
  if (policyBypass) return false // 完全访问：不弹批量删除审批
  const threshold = Number(cfg.batchDeleteThreshold) || 0
  if (threshold <= 0) return false
  return entryCount >= threshold
}

export function shouldBackup(cfg: SecurityConfig): boolean {
  return cfg.autoBackup === true
}

export function backupQuotaBytes(cfg: SecurityConfig): number {
  const mb = Number(cfg.backupMaxSize) || 3000
  return Math.max(1, mb) * 1024 * 1024
}
