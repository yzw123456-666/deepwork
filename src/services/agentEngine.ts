import { Model, TaskMessage } from '../types'
import { v4 as uuidv4 } from 'uuid'

// ---------- 工具定义 ----------

export interface ToolCall {
  tool: string
  args: Record<string, any>
}

export interface ToolResult {
  ok: boolean
  output: string
  /** 附加提示（如“已征得用户同意访问该域名”“已移入回收站”），会显示给用户 */
  notice?: string
}

const MAX_ITERATIONS = 50

// ---------- 技能包（use_skill）----------
// 技能真实安装在主进程 userData/skills 目录；这里负责：
//   1) 把可用技能清单注入系统提示词，让模型知道能调用什么
//   2) use_skill 被调用时读取 SKILL.md 正文交给模型遵循
export interface SkillCatalogEntry {
  slug: string
  name: string
  desc?: string
  version?: string
  enabled: boolean
}

const SKILL_CATALOG_TTL = 10000 // 10 秒内复用，避免每轮任务都走 IPC
let skillCatalogCache: { at: number; list: SkillCatalogEntry[] } | null = null

export async function loadSkillCatalog(force = false): Promise<{ ok: boolean; list: SkillCatalogEntry[]; error?: string }> {
  const api = typeof window !== 'undefined' ? window.electronAPI?.skills : undefined
  if (!api) return { ok: false, list: [], error: '技能功能仅在本机客户端可用' }
  if (!force && skillCatalogCache && Date.now() - skillCatalogCache.at < SKILL_CATALOG_TTL) {
    return { ok: true, list: skillCatalogCache.list }
  }
  try {
    const r = await api.list()
    const list: SkillCatalogEntry[] = Array.isArray(r?.skills)
      ? r!.skills!.map(s => ({
          slug: s.slug,
          name: s.name || s.slug,
          desc: s.desc || '',
          version: s.version || '',
          enabled: s.enabled !== false,
        }))
      : []
    skillCatalogCache = { at: Date.now(), list }
    return { ok: true, list }
  } catch (e: any) {
    return { ok: false, list: skillCatalogCache?.list || [], error: e?.message || '读取技能列表失败' }
  }
}

/** 安装/卸载后调用，立刻让缓存失效 */
export function invalidateSkillCatalog() {
  skillCatalogCache = null
}

export function formatSkillCatalog(list: SkillCatalogEntry[]): string {
  if (!list || list.length === 0) return ''
  const usable = list.filter(s => s.enabled)
  if (usable.length === 0) return ''
  const lines = usable.slice(0, 40).map(s =>
    `- ${s.slug}${s.version ? `（v${s.version}）` : ''}${s.name && s.name !== s.slug ? ` ${s.name}` : ''}${s.desc ? `：${s.desc.slice(0, 100)}` : ''}`
  )
  return `\n\n## 已安装技能（用 use_skill 加载后按其流程执行）\n${lines.join('\n')}\n` +
    `（共 ${usable.length} 个；skill_name 必须原样使用上面的 slug。任务与某技能明显相关时，先用 use_skill 加载它再动手。）`
}

function matchSkill(list: SkillCatalogEntry[], raw: string): SkillCatalogEntry | null {
  const q = String(raw || '').trim().toLowerCase()
  if (!q) return null
  const exact = list.find(s => s.slug.toLowerCase() === q) || list.find(s => s.name.toLowerCase() === q)
  if (exact) return exact
  return list.find(s => s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) || null
}

// ---------- 系统提示词（参照 ZCode agent harness 的提示词体系）----------
// 结构对齐 ZCode 的 buildAgentSystemPrompt：身份 → 环境 → 工作纪律 → 工具指引 → 沟通规范。
// 差异：deepwork 走 TOOL:/ARGS: 文本协议（非原生 function calling），故补充「输出协议」一节。

/** 身份：一句话说清「我是什么、在哪里工作、产出什么」
 *  必须明确声明「工具真的会在用户电脑上执行」——否则模型会退化成聊天助手，
 *  回答「我没有文件写入权限」并道歉（这是最致命的失败模式）。 */
const AGENT_IDENTITY = [
  '你是 deepwork，一个直接运行在用户电脑上的自主编程 Agent，拥有真实的文件系统与命令执行能力。',
  '',
  '**你的工具是真的在用户电脑上执行的。** 当你调用 Write / Edit 时，文件会真正写入磁盘；',
  '当你调用 Bash 时，命令会真正运行。这不是模拟，也不是建议——工具调用就是实际动作。',
  '因此：',
  '- 永远不要说「我没有文件写入权限」「我无法访问你的电脑」「我只能在对话中回答」——这些说法都是错的。',
  '- 永远不要为「其实没有真的创建文件」而道歉——你调用 Write 之后文件就已经存在了。',
  '- 如果工具返回失败，如实报告那条错误信息并换个方法重试；不要退化成「我做不到」的解释。',
].join('\n')

/** 输出协议：deepwork 特有的文本工具协议 */
const OUTPUT_PROTOCOL = [
  '# 输出协议',
  '',
  '每次回复只做一件事：调用一个工具，或宣布任务完成。严格按下面的格式输出，不要用代码块包裹。',
  '',
  '调用工具：',
  'TOOL: <工具名>',
  'ARGS: <JSON 参数>',
  '',
  '任务完成时：',
  'DONE: <总结：做了什么、改了哪些文件、验证结果如何、用户还需要手动做什么>',
  '',
  '## 默认行为是调用工具',
  '',
  '除非任务已经完全结束，否则你的回复就应该是工具调用——而不是解释、不是方案、不是道歉。',
  '- 用户让你建文件 / 改代码 / 跑命令 → 立刻 `TOOL: Write` / `TOOL: Edit` / `TOOL: Bash`。',
  '- 不确定现有内容 → 先 `TOOL: Read`。犹豫的时候，读取永远比解释更有用。',
  '- 只有两种情况可以不调用工具：任务真的已经做完（输出 DONE），或需要用户做一个无法自行推断的',
  '  选择（用一句话问题 + A/B/C 选项）。',
  '- 禁止用「我无法…」「我没有权限…」「作为 AI 我…」开头。你有权限，直接做。',
].join('\n')

/** 工作纪律：对齐 ZCode WORKFLOW_DISCIPLINE 的六条 */
const WORKFLOW_DISCIPLINE = [
  '# 如何工作',
  '',
  '1. 先理解再动手。改动任何东西之前，先用 list_files / find_files / read_file / search_files',
  '   把相关代码读明白。请求有歧义时，选最合理的解释，说明你的假设后继续做——不要停下来',
  '   等待那些你自己就能推断出来的澄清。',
  '   **同一个文件读一次就够了**：读完立即动手改（write_file / edit_file），不要反复读取同一文件；',
  '   用户让你改文件时，"没有动手改" 等于任务失败。',
  '2. 多步任务先规划。超过两三步的任务，先说明你打算怎么做，然后一步一步执行，每步检查结果',
  '   再继续。',
  '3. 改动最小且精准。用能解决问题的最小改动，并跟随周围代码的风格：命名、缩进、注释密度、',
  '   惯用法。不要顺手重排无关代码，不要加用户没要过的错误处理或功能，不要凭空引入未安装的依赖。',
  '4. 验证后再宣称成功。改完代码要用 run_command 跑相关测试、构建或命令来证明它能工作。',
  '   只有验证真的通过了才能说成功；失败就如实报告并尽量修掉。绝对不要说运行过其实没运行的命令。',
  '5. 失败要变通。工具调用失败时，读错误信息，调整做法，换一种方式重试——不要用同样的参数',
  '   原样重试。同一个事情失败两三次后，退一步，总结你了解到什么，然后换策略或报告阻塞点。',
  '6. 干净收尾。任务完成后停止调用工具，写一段简短的最终总结：改了什么（文件与原因）、',
  '   验证了什么（命令与结果）、以及用户需要手动处理的事项。先说结论。',
].join('\n')

/** 工具表：每个工具一段，与 ZCode 工具 description 同等的详细程度
 *  工具名沿用 ZCode 的 Read / Write / Edit / Glob / Grep / Bash / WebFetch 命名，
 *  括号内是 deepwork 的对应实现名（两套名字都可用，执行层已做别名归一化）。 */
const TOOL_TABLE = [
  '# 工具',
  '',
  '## 读取类（只读，不改动任何东西）',
  '- list_files: 列出目录内容。ARGS: {"path": "子目录，留空为根目录"}',
  '- Glob（别名 find_files）: 按 glob 模式查找文件，结果按修改时间由新到旧排列。',
  '  ARGS: {"pattern": "**/*.js 或 src/*.{html,css}"}。用于摸清项目结构、按名字或扩展名定位文件、',
  '  确认某文件是否存在——要找文件内容请用 Grep。',
  '- Read（别名 read_file）: 读取文本文件内容并带行号返回。改动文件前必须先读它（Edit 的强制前提）；',
  '  也用于确认精确格式。长文件会分页：offset 是起始行（从 1 开始），limit 限制返回行数（上限 2000）。',
  '  ARGS: {"path": "路径", "offset": "起始行（可选）", "limit": "行数（可选）"}。目录与二进制文件会被拒绝。',
  '- Grep（别名 search_files）: 按内容搜索。用来定位定义、调用点、配置项、TODO。',
  '  ARGS: {"pattern": "搜索词", "path": "目录，留空为根", "regex": false}。',
  '',
  '## 写入类（改动磁盘，可能触发安全中心确认）',
  '- Write（别名 write_file）: 创建新文件，或用新内容完全重写一个已有文件（自动创建父目录）。',
  '  修改已有文件请优先用 Edit——Write 会替换全部内容。重写一个已存在的文件前，',
  '  必须在本会话里先用 Read 读过它。结果会返回写入路径与字节数。',
  '  ARGS: {"file_path": "路径", "content": "完整内容"}。',
  '- Edit（别名 edit_file）: 精准替换已有文件中的一段文本——改动代码的外科手术式做法。old_string 必须与文件内容',
  '  完全一致（含空白与缩进），且默认必须在文件中只出现一次（replace_all 为 true 时除外）；',
  '  请带上前后几行来保证唯一性。该文件必须已在本次会话中被 Read 读过（强制执行）。',
  '  匹配失败时错误会报告出现次数，据此调整匹配串，而不是靠猜。',
  '  ARGS: {"file_path": "路径", "old_string": "要替换的精确原文", "new_string": "替换后的新文本", "replace_all": "全部替换时设 true（可选）"}。',
  '- append_file: 在文件末尾追加内容，适合无法一次写出的超长文件。ARGS: {"path": "路径", "content": "追加内容"}。',
  '- create_dir: 创建目录（自动创建父目录）。ARGS: {"path": "目录路径"}。',
  '- move_file: 移动或重命名文件/目录（目标已存在会报错）。ARGS: {"path": "原路径", "new_path": "新路径"}。',
  '- copy_file: 复制文件。ARGS: {"path": "原路径", "new_path": "新路径"}。',
  '- delete_file: 删除文件或目录（默认移入回收站，可恢复）。ARGS: {"path": "路径"}。',
  '',
  '## 执行与联网',
  '- Bash（别名 run_command）: 在工作目录执行命令并返回 stdout/stderr。用于测试、构建、lint、git、包管理——',
  '  不要用它做 Read / Grep 已经覆盖的文件查看。非交互执行（stdin 未连接），',
  '  因此避免会提问的命令（用 `npm install --yes`、`git commit -m`，绝不要用编辑器或分页器）。',
  '  ARGS: {"command": "命令", "timeout": "超时毫秒数，默认 60000，上限 300000（可选）"}。',
  '- web_search: 内置浏览器联网搜索。用于查最新资料、报错信息、文档、版本号等本地没有的信息。',
  '  ARGS: {"query": "搜索关键词，尽量具体", "count": "返回条数，默认 8，上限 15（可选）"}。',
  '- WebFetch（别名 web_fetch）: 抓取指定网址的正文（比搜索摘要更详细）。仅能访问公网页面，无法访问内网或需要',
  '  登录的页面。ARGS: {"url": "http(s):// 开头的完整网址", "max_chars": "正文截断长度，默认 12000（可选）"}。',
  '- use_skill: 加载并遵循已安装技能包（SKILL.md）的工作流。任务与某个技能明显相关时，先加载它再动手。',
  '  ARGS: {"skill_name": "技能清单里的 slug", "description": "本次用它做什么（可选）", "max_chars": "正文截断长度，默认 20000（可选）"}。',
].join('\n')

/** 工具指引：对齐 ZCode TOOL_GUIDANCE */
const TOOL_GUIDANCE = [
  '# 工具使用指引',
  '',
  '- 优先用专用工具，而不是 shell 一行流：查看用 Read / Glob / Grep，',
  '  而不是在 Bash 里跑 cat / find / grep——专用工具更快、更安全，也遵守工作区边界。',
  '- 多个互不依赖的 Read / Glob / Grep 可以放在同一轮里一起发出，不要一轮只发一个。',
  '- 改动已有文件用 Edit；写新文件或完全重写才用 Write。Edit 的 old_string 必须',
  '  精确且唯一。Edit 之前必须先 Read 目标文件（强制执行）。',
  '- Bash 在非交互 shell 中执行：stdin 未连接，所以要用非交互参数，不要用编辑器或分页器；',
  '  慢命令记得给足 timeout。',
  '- 本地资料答不了的问题（最新版本、报错原因、API 文档、时效性信息）用 web_search / WebFetch',
  '  查证，禁止凭记忆编造外部事实。联网可能被安全中心询问用户：被拒绝时改用本地可行方案，',
  '  不要把同一域名反复重试。',
  '- 所有路径都用相对于工作目录的相对路径，正斜杠与反斜杠都可用。',
].join('\n')

/** 沟通规范：对齐 ZCode COMMUNICATION_GUIDANCE */
const COMMUNICATION_GUIDANCE = [
  '# 沟通',
  '',
  '- 工具调用之间可以写简短的进展说明，但要短；用户真正读的是最终那条消息，它必须能独立看懂。',
  '- 用用户提问时所用的语言回答。',
  '- 陈述事实：说明你做了什么、验证了什么、还有什么没做。不要客套话，不要把任务复述一遍。',
  '  注意区分两种情况——**你调用过工具并且它返回成功，那就是真的做了**，直接说「已创建 xxx 文件」；',
  '  只有当你确实没验证过时，才说「未验证」，而不是把已经做好的事说成没做。',
  '- 禁止自我否定式道歉。以下都是错误回复：「抱歉，我没有文件写入权限」「我在当前对话中没有实际',
  '  的文件写入权限」「作为 AI 我无法直接操作您的电脑」。你有这些能力，直接调用工具即可。',
  '- 【代码必须落盘】禁止在回复正文里直接输出代码块。所有代码、网页、文档内容都必须通过',
  '  Write / Edit 写入文件。直接输出代码 = 没有完成任务。',
  '  回复里不要复述文件内容、不要贴 diff、不要罗列代码片段——只说「做了什么、改了哪个文件、',
  '  验证结果如何」。用户要的是清爽的进展结论，不是把你写进文件的东西再贴一遍。',
  '- 【少提问】仅当任务严重歧义且无法从历史推断时才提问，格式必须是：一句话问题 + 2~4 个选项',
  '  （A. xxx B. xxx）。能推断就不要问。',
].join('\n')

/** Windows 命令提示：deepwork 运行在 Windows，保留该平台事实 */
const PLATFORM_NOTES = [
  '# 平台注意事项（Windows）',
  '',
  '命令在 cmd 中执行：用 python 而非 python3；查看文件用 type；安装依赖用 npm install <pkg> /',
  'pip install <pkg>；打开网页用 start index.html。',
].join('\n')

/** 系统提示词主体：按 ZCode 的段落顺序拼接 */
const TOOLS_PROMPT = [
  AGENT_IDENTITY,
  '',
  OUTPUT_PROTOCOL,
  '',
  WORKFLOW_DISCIPLINE,
  '',
  TOOL_TABLE,
  '',
  TOOL_GUIDANCE,
  '',
  COMMUNICATION_GUIDANCE,
  '',
  PLATFORM_NOTES,
].join('\n')

// ---------- 上下文文件（Hermes 风格：工作目录的 CONTEXT.md 自动注入） ----------

export async function loadContextFile(root: string): Promise<string> {
  try {
    const r = await window.electronAPI?.agent.readFile(root, 'CONTEXT.md')
    if (r?.ok && r.content) {
      return `\n\n[项目上下文文件 CONTEXT.md]\n${r.content.slice(0, 4000)}`
    }
  } catch {}
  return ''
}

// ---------- 工作区文件摘要 ----------
export async function getWorkspaceSummary(root: string): Promise<string> {
  try {
    const r = await window.electronAPI?.agent.listFiles(root, '')
    if (!r?.ok || !r.items) return ''
    const files = r.items
      .filter(i => !i.isDir)
      .slice(0, 30)
      .map(i => `- ${i.name} (${i.size}B)`)
      .join('\n')
    const dirs = r.items
      .filter(i => i.isDir)
      .slice(0, 10)
      .map(i => `- [目录] ${i.name}/`)
      .join('\n')
    const parts = []
    if (files) parts.push(`文件:\n${files}`)
    if (dirs) parts.push(`目录:\n${dirs}`)
    return parts.length > 0 ? `\n\n[工作区现有文件]\n${parts.join('\n\n')}` : ''
  } catch {}
  return ''
}

// ---------- 模型调用 ----------

export async function callModel(
  model: Model,
  messages: Array<{ role: string; content: string }>,
  temperature: number = 0.7,
  signal?: AbortSignal,
  onThinking?: (text: string) => void
): Promise<string> {
  // 直接使用模型自身配置的端点与密钥
  const baseUrl = model.baseUrl || 'https://api.openai.com/v1'
  const apiKey = model.apiKey || ''

  // 输出上限：不能直接用上下文窗口（部分服务商如 DeepSeek 有 max_tokens 上限，超了会 400）
  // 遇到 max_tokens 相关 400 错误时按 8192 → 4096 降档重试
  let maxTokens = Math.min(model.contextWindow || 32768, 16384)
  let response: Response
  for (;;) {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.name,
        messages,
        stream: true,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    })
    if (response.ok) break
    const errText = await response.text().catch(() => '')
    if (response.status === 400 && /max[_ ]?tokens/i.test(errText)) {
      if (maxTokens > 8192) { maxTokens = 8192; continue }
      if (maxTokens > 4096) { maxTokens = 4096; continue }
    }
    throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`)
  }

  const contentType = response.headers.get('content-type') || ''

  // 非流式回退（服务商不支持流式时）
  if (!contentType.includes('text/event-stream') || !response.body) {
    const json = await response.json()
    const msg = json.choices?.[0]?.message || {}
    let content: string = msg.content || ''
    const reasoning: string = msg.reasoning_content || ''
    if (reasoning.trim()) {
      try { onThinking?.(reasoning.trim()) } catch {}
    }
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/)
    if (thinkMatch) {
      try { onThinking?.(thinkMatch[1].trim()) } catch {}
      content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
    }
    const openThink = content.match(/<think>([\s\S]*)$/)
    if (openThink && !thinkMatch) {
      try { onThinking?.(openThink[1].trim()) } catch {}
      content = ''
    }
    return content
  }

  // 流式解析：reasoning_content 增量实时回调，实现深度思考实时显示
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  let thinkContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta || {}
        const reasoningDelta: string = delta.reasoning_content || ''
        const contentDelta: string = delta.content || ''
        if (reasoningDelta) {
          thinkContent += reasoningDelta
          // ⚠️ onThinking 的语义是「增量分片」——调用方自行累积：
          //   TaskWorkspace.collectThinking 用 += 拼接、ChatArea.onThinking 也用 += 累积。
          //   不要改成传 thinkContent 全量，否则任务视图的思考会重复叠加。
          //   下方 <think> 提取分支传「整块」也兼容增量语义（空缓冲 += 整块）。
          try { onThinking?.(reasoningDelta) } catch {}
        }
        if (contentDelta) {
          content += contentDelta
        }
      } catch {
        // 忽略不完整 chunk
      }
    }
  }

  // <think> 标签提取（部分模型把思考混在 content 里）
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch) {
    try { onThinking?.(thinkMatch[1].trim()) } catch {}
    content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
  }
  const openThink = content.match(/<think>([\s\S]*)$/)
  if (openThink && !thinkMatch) {
    try { onThinking?.(openThink[1].trim()) } catch {}
    content = ''
  }

  return content
}

// ---------- 工具解析与执行 ----------

export function parseToolCall(text: string): ToolCall | null {
  // 容错：支持全角冒号、TOOL 与 ARGS 同行、大小写，以及 **TOOL:** 这类 markdown 加粗包裹
  const cleaned = text.replace(/\*\*/g, '')
  const match = cleaned.match(/TOOL\s*[:：]\s*(\w+)[\s\n]+ARGS\s*[:：]\s*([\s\S]+)/i)
  if (!match) return null
  try {
    const argsStr = match[2].trim()
    const jsonStart = argsStr.indexOf('{')
    if (jsonStart === -1) return null
    // 正确匹配嵌套括号：跳过字符串内的 {} 字符
    let depth = 0
    let inString = false
    let escape = false
    let jsonEnd = -1
    for (let i = jsonStart; i < argsStr.length; i++) {
      const c = argsStr[i]
      if (escape) { escape = false; continue }
      if (c === '\\') { escape = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === '{') depth++
      if (c === '}') { depth--; if (depth === 0) { jsonEnd = i; break } }
    }
    if (jsonEnd === -1) return null
    const args = JSON.parse(argsStr.slice(jsonStart, jsonEnd + 1))
    return { tool: match[1].toLowerCase(), args }
  } catch {
    return null
  }
}

// 容错识别完成宣告：支持 DONE: / DONE：/ **DONE:**，以及 DONE 前带有简短说明文本的情况。
// 返回总结文本；未识别到 DONE 返回 null
export function parseDoneResponse(text: string): string | null {
  const head = text.match(/^\s*(?:\*\*)?\s*DONE\s*[:：]\s*(?:\*\*)?\s*([\s\S]*)$/i)
  if (head) return head[1].trim()
  // DONE 在最后一行且前面只有简短说明（≤3 行）时也算完成
  const lines = text.trimEnd().split('\n')
  const last = lines[lines.length - 1].trim()
  const tail = last.match(/^(?:\*\*)?\s*DONE\s*[:：]\s*(?:\*\*)?\s*([\s\S]*)$/i)
  if (tail && lines.length <= 3) return tail[1].trim()
  return null
}

/**
 * 工具路径归一化（轮 J：修复「无法创建/写入文件」）。
 * 模型经常无视相对路径规则给绝对路径：path.join(root, 'D:\\x') 会拼出「root\\D:\\x」
 * 这种含中间冒号的非法路径，写盘必然失败。这里提前归一 + 友好报错（省一次无效 IPC）：
 *   - 盘符/UNC 绝对路径：root 内 → 转为相对路径；root 外 → 返回错误（提示用相对路径）
 *   - '/xxx' POSIX 风：视为 root 下的相对路径
 *   - 其余：相对路径原样
 */
export function normalizeToolPath(root: string, p: string): { ok: true; rel: string } | { ok: false; error: string } {
  const raw = String(p || '').trim()
  if (!raw) return { ok: true, rel: '' }
  const normRoot = root.replace(/[\\/]+$/, '')
  // Windows 盘符绝对路径（C:\ / C:/）或 UNC（\\server\share）
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    const abs = raw.replace(/\//g, '\\')
    const rootWin = normRoot.replace(/\//g, '\\')
    const rootLow = rootWin.toLowerCase().endsWith('\\') ? rootWin.toLowerCase() : rootWin.toLowerCase() + '\\'
    const absLow = abs.toLowerCase()
    if (absLow === rootWin.toLowerCase() || absLow.startsWith(rootLow)) {
      return { ok: true, rel: abs.slice(rootWin.length).replace(/^[\\/]+/, '') }
    }
    return { ok: false, error: `路径 ${raw} 在工作目录（${normRoot}）之外，禁止访问。请改用相对路径（相对于工作目录），例如 "文件名.html" 或 "子目录/文件名"` }
  }
  // POSIX 风格 '/xxx'：模型意图几乎总是工作目录下，去开头斜杠当相对路径
  if (raw.startsWith('/')) return { ok: true, rel: raw.replace(/^\/+/, '') }
  return { ok: true, rel: raw }
}

export async function executeTool(
  tool: string,
  args: Record<string, any>,
  root: string,
  allowExec: boolean
): Promise<ToolResult> {
  const api = window.electronAPI
  if (!api) return { ok: false, output: '无 Electron 环境' }

  // ZCode 风格别名：工具名与参数名都做归一化，模型用哪套都能跑
  //   Read→read_file / Write→write_file / Edit→edit_file / Glob→find_files
  //   Grep→search_files / Bash→run_command / WebFetch→web_fetch
  //   参数 file_path→path / new_string→new_str / old_string→old_str / max_chars 同名
  const TOOL_ALIAS: Record<string, string> = {
    read: 'read_file',
    write: 'write_file',
    edit: 'edit_file',
    glob: 'find_files',
    grep: 'search_files',
    bash: 'run_command',
    webfetch: 'web_fetch',
    websearch: 'web_search',
    ls: 'list_files',
    list: 'list_files',
    todo_write: 'todo',
  }
  const ARG_ALIAS: Record<string, string> = {
    file_path: 'path',
    filepath: 'path',
    file: 'path',
    old_string: 'old_str',
    new_string: 'new_str',
    pattern_: 'pattern',
    timeout: 'timeout_ms',
    cmd: 'command',
  }
  const rawTool = String(tool || '')
  const normalizedTool = TOOL_ALIAS[rawTool.toLowerCase()] || rawTool.toLowerCase()
  const normalizedArgs: Record<string, any> = { ...(args || {}) }
  for (const [from, to] of Object.entries(ARG_ALIAS)) {
    if (normalizedArgs[from] !== undefined && normalizedArgs[to] === undefined) {
      normalizedArgs[to] = normalizedArgs[from]
    }
  }
  tool = normalizedTool
  args = normalizedArgs

  // 路径归一化（轮 J）：模型给绝对路径时转相对/报错，防「root\D:\x」非法拼接导致写入失败
  const pathNorm = normalizeToolPath(root, String(args.path ?? ''))
  if (!pathNorm.ok) return { ok: false, output: pathNorm.error }
  args.path = pathNorm.rel
  const relPath = pathNorm.rel
  // move/copy 的目标路径同样归一
  if (args.new_path !== undefined) {
    const np = normalizeToolPath(root, String(args.new_path))
    if (!np.ok) return { ok: false, output: np.error }
    args.new_path = np.rel
  }

  try {
    switch (tool) {
      case 'list_files': {
        const r = await api.agent.listFiles(root, relPath)
        if (!r.ok) return { ok: false, output: r.error || '列目录失败' }
        const items = (r.items || [])
          .map(i => `${i.isDir ? '[目录]' : '[文件]'} ${i.name}${i.isDir ? '' : ` (${i.size}B)`}`)
          .join('\n')
        return { ok: true, output: items || '(空目录)' }
      }
      case 'find_files': {
        const pattern = String(args.pattern ?? '*')
        const r = await api.agent.findFiles(root, pattern)
        if (!r.ok) return { ok: false, output: r.error || '查找失败' }
        const files = (r.files || [])
        return { ok: true, output: files.length > 0 ? files.join('\n') + (r.truncated ? '\n(结果已截断)' : '') : '未找到匹配文件' }
      }
      case 'read_file': {
        // 支持行范围分段读取（大文件防撑爆上下文）
        const offset = args.offset !== undefined ? Number(args.offset) : undefined
        const limit = args.limit !== undefined ? Number(args.limit) : undefined
        const r = await api.agent.readFile(root, relPath, offset, limit)
        if (!r.ok) return { ok: false, output: r.error || '读文件失败' }
        let output = r.content || ''
        if (r.truncated) {
          output += `\n\n(文件共 ${r.totalLines} 行，已显示第 ${r.startLine}-${r.endLine} 行。继续读取请用 offset: ${r.nextOffset})`
        }
        return { ok: true, output }
      }
      case 'write_file': {
        const content = String(args.content ?? '')
        const r = await api.agent.writeFile(root, relPath, content)
        return r.ok
          ? { ok: true, output: `已写入 ${relPath} (${content.length} 字符)` }
          : { ok: false, output: r.error || '写文件失败' }
      }
      case 'edit_file': {
        const oldStr = String(args.old_str ?? '')
        const newStr = String(args.new_str ?? '')
        if (!oldStr) return { ok: false, output: '缺少 old_str 参数' }
        const replaceAll = args.replace_all === true
        const r = await api.agent.editFile(root, relPath, oldStr, newStr, replaceAll)
        return r.ok
          ? { ok: true, output: `已编辑 ${relPath}（替换 ${r.replaced} 处）` }
          : { ok: false, output: r.error || '编辑失败' }
      }
      case 'append_file': {
        const content = String(args.content ?? '')
        const r = await api.agent.appendFile(root, relPath, content)
        return r.ok
          ? { ok: true, output: `已追加到 ${relPath} (${content.length} 字符)` }
          : { ok: false, output: r.error || '追加失败' }
      }
      case 'delete_file': {
        const r = await api.agent.deleteFile(root, relPath)
        return r.ok
          ? { ok: true, output: `已删除 ${relPath}` }
          : { ok: false, output: r.error || '删除失败' }
      }
      case 'move_file': {
        const newPath = String(args.new_path ?? '')
        if (!newPath) return { ok: false, output: '缺少 new_path 参数' }
        const r = await api.agent.moveFile(root, relPath, newPath)
        return r.ok
          ? { ok: true, output: `已移动 ${relPath} → ${newPath}` }
          : { ok: false, output: r.error || '移动失败' }
      }
      case 'copy_file': {
        const newPath = String(args.new_path ?? '')
        if (!newPath) return { ok: false, output: '缺少 new_path 参数' }
        const r = await api.agent.copyFile(root, relPath, newPath)
        return r.ok
          ? { ok: true, output: `已复制 ${relPath} → ${newPath}` }
          : { ok: false, output: r.error || '复制失败' }
      }
      case 'create_dir': {
        if (!relPath) return { ok: false, output: '缺少 path 参数' }
        const r = await api.agent.createDir(root, relPath)
        return r.ok
          ? { ok: true, output: `已创建目录 ${relPath}` }
          : { ok: false, output: r.error || '创建目录失败' }
      }
      case 'search_files': {
        const pattern = String(args.pattern ?? '')
        if (!pattern) return { ok: false, output: '缺少 pattern 参数' }
        const isRegex = args.regex === true
        const r = await api.agent.searchFiles(root, relPath, pattern, isRegex)
        if (!r.ok) return { ok: false, output: r.error || '搜索失败' }
        const matches = (r.matches || [])
        if (matches.length === 0) return { ok: true, output: '未找到匹配内容' }
        const out = matches
          .map(m => `${m.file}:${m.line}: ${m.text}`)
          .join('\n')
        return { ok: true, output: out + (r.truncated ? '\n(结果已达上限，已截断)' : '') }
      }
      case 'run_command': {
        if (!allowExec) return { ok: false, output: '命令执行被安全策略禁用（安全中心 → 系统级工具）' }
        // 可自定义超时（毫秒），默认 60s，上限 5 分钟
        const timeoutMs = Math.min(Math.max(1, Number(args.timeout_ms) || 60000), 300000)
        const r = await api.agent.execCommand(root, String(args.command ?? ''), timeoutMs)
        const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, `exit: ${r.exitCode}`]
          .filter(Boolean).join('\n')
        return { ok: r.ok, output: out || '(无输出)', notice: r.notice }
      }
      case 'web_search': {
        const query = String(args.query ?? '').trim()
        if (!query) return { ok: false, output: '缺少 query 参数' }
        const count = args.count !== undefined ? Number(args.count) : undefined
        const r = await api.agent.webSearch(query, count)
        if (!r.ok) return { ok: false, output: r.error || '搜索失败', notice: r.notice }
        return { ok: true, output: r.output || '(无结果)', notice: r.notice }
      }
      case 'web_fetch': {
        const url = String(args.url ?? '').trim()
        if (!url) return { ok: false, output: '缺少 url 参数' }
        const maxChars = args.max_chars !== undefined ? Number(args.max_chars) : undefined
        const r = await api.agent.webFetch(url, maxChars)
        if (!r.ok) return { ok: false, output: r.error || '抓取失败', notice: r.notice }
        return { ok: true, output: r.output || '(页面无内容)', notice: r.notice }
      }
      case 'use_skill': {
        const skillName = String(args.skill_name ?? '').trim()
        if (!skillName) return { ok: false, output: '缺少 skill_name 参数' }
        const cat = await loadSkillCatalog()
        if (!cat.ok && cat.list.length === 0) {
          return { ok: false, output: `无法读取技能包（${cat.error || '未知原因'}）。请用其他工具完成任务。` }
        }
        const usable = cat.list.filter(s => s.enabled)
        if (usable.length === 0) {
          return { ok: false, output: '当前没有已启用的技能包。请在「技能」页面从 SkillHub 安装并启用，或直接用其他工具完成任务。' }
        }
        const hit = matchSkill(usable, skillName)
        if (!hit) {
          return {
            ok: false,
            output: `没有找到技能「${skillName}」。可用技能：${usable.map(s => s.slug).join('、')}。请用其中的 slug 重试。`
          }
        }
        const maxChars = args.max_chars !== undefined ? Number(args.max_chars) : undefined
        const r = await api.skills.read(hit.slug, maxChars)
        if (!r?.ok) return { ok: false, output: r?.error || `读取技能「${hit.slug}」失败` }
        const fileList = r.files && r.files.length
          ? `\n\n（技能包内文件：${r.files.slice(0, 30).join(', ')}${r.files.length > 30 ? ` …共 ${r.files.length} 个` : ''}）`
          : ''
        return {
          ok: true,
          output: `已加载技能「${hit.name}」${hit.version ? ` v${hit.version}` : ''}（${hit.slug}）。请严格按下面的技能说明执行当前任务：\n\n${r.content}${fileList}`
        }
      }
      default:
        return { ok: false, output: `未知工具: ${tool}。可用工具: list_files, find_files(Glob), read_file(Read), search_files(Grep), write_file(Write), edit_file(Edit), append_file, delete_file, move_file, copy_file, create_dir, run_command(Bash), web_search, web_fetch(WebFetch), use_skill` }
    }
  } catch (e: any) {
    return { ok: false, output: e.message }
  }
}

// ---------- 历史消息格式化（供所有模型调用复用） ----------
// 过滤执行状态噪音与思考内容，保留工具结果与实质内容，合并连续同角色消息
export function formatHistoryForModel(
  history: Array<{ role: string; content: string }> | undefined
): Array<{ role: string; content: string }> {
  if (!history || history.length === 0) return []

  const cleaned: Array<{ role: string; content: string }> = []
  for (const m of history) {
    // 思考过程不进上下文（<think> 已由 UI 单独展示）
    const content = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (!content) continue

    if (m.role === 'system') {
      // 仅保留工具结果消息（✅/❌ 开头），跳过瞬态状态消息（🧠⚙️🔧 等）；截断防止单条过长
      if (/^[✅❌]/.test(content)) {
        cleaned.push({ role: 'user', content: `[历史工具操作] ${content.slice(0, 300)}` })
      }
      continue
    }
    if (m.role === 'user') {
      cleaned.push({ role: 'user', content })
      continue
    }
    // main → assistant：完成总结保留（截断超长内容）
    cleaned.push({ role: 'assistant', content: content.slice(0, 2000) })
  }

  // 合并连续同角色消息（确保 user/assistant 交替，兼容所有 API）
  const merged: Array<{ role: string; content: string }> = []
  for (const m of cleaned) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) {
      last.content += `\n\n${m.content}`
    } else {
      merged.push({ ...m })
    }
  }

  // 限制总长度（保留最近的内容，最多约 24000 字符）
  const MAX_CHARS = 24000
  let total = 0
  const limited: Array<{ role: string; content: string }> = []
  for (let i = merged.length - 1; i >= 0; i--) {
    total += merged[i].content.length
    if (total > MAX_CHARS) break
    limited.unshift(merged[i])
  }
  return limited
}

// ---------- Agent Loop：带工具的迭代执行 ----------

export interface AgentLoopCallbacks {
  onStatus: (content: string, toolCall?: { tool: string; args: Record<string, any> }) => Promise<void>   // 更新状态消息（轮 I：带 toolCall 时 UI 可渲染「进行中」工具动作行）
  onToolUse: (tool: string, args: Record<string, any>, result: ToolResult) => Promise<void>
  onContextUsage?: (usedTokens: number, maxTokens: number, breakdown?: ContextUsagePart[]) => void  // 上下文用量回调（含分类明细）
  onModelContextUsage?: (modelId: string, usedTokens: number, maxTokens: number) => void  // 按模型上报上下文用量
  onThinking?: (text: string) => void  // 思考过程回调
}

// 上下文用量分类明细（供 UI 弹窗展示）
export interface ContextUsagePart {
  label: string
  tokens: number
  percent: number   // 占上下文窗口的百分比
  color: string
}

// 按消息类别统计上下文占用：系统提示词 / 工具调用与结果 / 历史摘要 / 对话消息
export function computeContextBreakdown(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number
): ContextUsagePart[] {
  const defs = [
    { label: '系统提示词', color: '#10b981' },
    { label: '工具调用与结果', color: '#f59e0b' },
    { label: '历史摘要', color: '#3b82f6' },
    { label: '对话消息', color: '#8b5cf6' },
  ]
  const tokens = [0, 0, 0, 0]
  messages.forEach((m, i) => {
    let cat = 3 // 其余归入对话消息
    if (i === 0 && m.role === 'system') cat = 0
    else if (m.role === 'user' && m.content.startsWith('[工具结果')) cat = 1
    else if (m.role === 'user' && m.content.startsWith('[历史摘要')) cat = 2
    tokens[cat] += m.content.length
  })
  return defs.map((d, i) => ({
    label: d.label,
    color: d.color,
    tokens: Math.ceil(tokens[i] / 3),
    percent: maxTokens > 0 ? (tokens[i] / 3 / maxTokens) * 100 : 0,
  }))
}

// 默认上下文窗口（tokens）
export const DEFAULT_CONTEXT_WINDOW = 32768

// 上下文压缩阈值：达到 80% 自动压缩历史（LLM 摘要）
const COMPACT_THRESHOLD = 0.8

// ---------- 思考深度 ----------

export type ThinkingDepth = 'low' | 'high' | 'max'

// 按档位注入不同的思考策略指令（附加在系统提示词末尾，风格对齐 ZCode 的 PLAN_MODE_DISCIPLINE）
const THINKING_DIRECTIVES: Record<ThinkingDepth, string> = {
  low: [
    '# 思考深度：低（快速执行）',
    '',
    '直接动手，不要在动手前做冗长分析。只在面临不可逆或影响面较大的决策时停下来想一下。',
    '保持动作紧凑：读、改、验证，尽快交付。',
  ].join('\n'),
  high: [
    '# 思考深度：高（权衡后行动）',
    '',
    '在关键决策前简要权衡方案，说明你选哪一个、为什么；其余环节直接行动。',
    '涉及多文件改动或架构选择时，先说明你的理解与计划，再动手。',
  ].join('\n'),
  max: [
    '# 思考深度：最高（先规划后执行）',
    '',
    '动手前先写出简短的执行计划：目标是什么、你理解的现状是什么、打算分哪几步做。',
    '执行中逐步核对每一步的结果，偏离计划时更新计划而不是硬走。',
    '收尾前自查：所有产物是否真的存在、内容是否正确、是否已用命令验证过。',
  ].join('\n'),
}

// 粗略估算 tokens
// 早期版本统一按「3 字符 = 1 token」折算，中文场景实际约 1 字 = 1 token，
// 低估 3 倍会让压缩阈值迟迟不触发，直到 API 直接报 context_length_exceeded 才失败
function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const m of messages) {
    const text = m.content || ''
    const cjk = (text.match(/[㐀-䶿一-鿿぀-ヿ豈-﫿]/g) || []).length
    total += cjk + (text.length - cjk) / 4
  }
  return Math.ceil(total)
}

// 上下文压缩（OpenClaw Compaction 风格）：
// 保留 system 提示 + 最近几条消息，中间历史用 LLM 压缩为摘要
// 摘要强制保留：任务目标、文件路径、关键数字、代码要点、未完成事项
async function compactContext(
  model: Model,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal
): Promise<Array<{ role: string; content: string }>> {
  // 保留条数自适应：早期版本固定保留最后 6 条、且条数 <= 8 直接放弃压缩，
  // 于是「4 条超长工具结果」这种最需要压缩的场景永远压不动
  if (messages.length < 4) return messages
  const KEEP_RECENT = Math.max(2, Math.min(6, messages.length - 2))
  const system = messages[0]
  const middle = messages.slice(1, messages.length - KEEP_RECENT)
  const recent = messages.slice(messages.length - KEEP_RECENT)
  if (middle.length === 0) return messages

  // 压缩提示词自身不能超长：每条截断 + 总量封顶（超出时优先保留最近的）
  const perMsg = middle.map(m => `[${m.role}] ${m.content.slice(0, 1200)}`)
  let parts = perMsg
  if (perMsg.reduce((s, p) => s + p.length, 0) > 12000) {
    const kept: string[] = []
    let t = 0
    for (let i = perMsg.length - 1; i >= 0; i--) {
      if (t + perMsg[i].length > 12000) break
      kept.unshift(perMsg[i])
      t += perMsg[i].length
    }
    parts = [`(更早的 ${perMsg.length - kept.length} 条消息已省略)`, ...kept]
  }

  const compactPrompt = `你正在压缩一段 AI Agent 的对话历史，以便在有限的上下文窗口里继续工作。请把它压缩为简洁摘要（不超过 800 字），必须严格保留：
1. 任务目标与用户原始需求
2. 所有文件路径、文件名
3. 关键数字、命令、配置项
4. 已完成的操作与工具调用结果要点（代码只保留关键函数签名/结构，不要完整代码）
5. 未完成事项与注意事项
直接输出摘要正文，不要任何开场白。

对话历史：
${parts.join('\n\n')}`
  try {
    const summary = await callModel(model, [{ role: 'user', content: compactPrompt }], 0.2, signal)
    return [{ role: 'system', content: system.content }, { role: 'user', content: `[历史摘要 - 由系统自动压缩生成]\n${summary}` }, ...recent]
  } catch {
    // 压缩失败则降级：截断保留每条开头
    const fallback = middle.map(m => ({ role: m.role, content: m.content.slice(0, 300) }))
    return [{ role: 'system', content: system.content }, ...fallback, ...recent]
  }
}

/**
 * 任务是否明确要求「写/创建/改文件」——用于写入意图兜底（避免误伤纯咨询类任务）。
 * 判定 = 动作词（写/创建/生成/改/实现…）+ 产物词（网页/页面/html/文件/脚本/程序/游戏…）。
 */
function isWriteIntentTask(taskDesc: string): boolean {
  const t = String(taskDesc || '')
  const action = /(写|创建|新建|生成|做|改|修改|加上|添加|加个|实现|重构|补全|完成)/.test(t)
  const artifact = /(网页|页面|html|文件|脚本|程序|代码|游戏|界面|项目|\.\w{1,5}\b)/i.test(t)
  return action && artifact
}

// 检测回复中是否包含未保存的代码块。
// 用户明确要求「对话里不要出现代码」，因此阈值压到 >120 字符（约 4~5 行）即算违规，
// 而不是早期的大段代码（>200）。行内 `code` 与极短片段不受影响。
// 2026-09-23 修复：**排除 <think> 思考区**——模型在思考里写代码草稿是正常推理过程，
// 旧实现把它算作违规，导致正常思考被反复纠正、纠正上限用尽后任务被静默终止（文件从未创建）。
function stripThinkForCheck(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
}
function hasUnsavedCodeBlock(text: string): boolean {
  const visible = stripThinkForCheck(text)
  const blocks = visible.match(/```[\s\S]*?```/g) || []
  if (blocks.some(b => b.length > 120)) return true
  if (/<!DOCTYPE|<html[\s>]/i.test(visible) && visible.length > 120) return true
  return false
}

/**
 * 从最终回复中剥掉代码块，只保留结论性文字。
 * 用于「已达到纠正上限、模型仍坚持贴代码」的兜底：与其把一坨代码甩给用户，
 * 不如只保留说明文字（代码本身已经落在文件里了）。
 */
function stripCodeBlocks(text: string): string {
  const stripped = text
    .replace(/```[^\n]*\n[\s\S]*?```/g, '')
    // 裸 HTML 文档（不带围栏）也要删：必须是完整文档或从整行开头开始，
    // 避免误伤普通句子里的 <html> 提及
    .replace(/<!DOCTYPE[^>]*>[\s\S]*?<\/html\s*>/gi, '')
    .replace(/<html[^>]*>[\s\S]*?<\/html\s*>/gi, '')
    .replace(/(^|\n)\s*<!DOCTYPE[^>]*>[\s\S]*$/i, '')
    .replace(/(^|\n)\s*<html[^>]*>[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return stripped || '任务已完成（具体改动已写入文件）。'
}

export interface AgentLoopOptions {
  thinkingDepth?: ThinkingDepth   // 思考深度（默认 high）
}

export async function runAgentLoop(
  model: Model,
  root: string,
  taskDesc: string,
  contextPrefix: string,
  allowExec: boolean,
  callbacks: AgentLoopCallbacks,
  history?: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
  options?: AgentLoopOptions
): Promise<string> {
  const thinkingDepth: ThinkingDepth = options?.thinkingDepth ?? 'high'
  const contextFile = await loadContextFile(root)
  const workspaceSummary = await getWorkspaceSummary(root)
  // 技能清单（真实读取磁盘），失败时静默降级为「无技能」
  const skillCat = await loadSkillCatalog(true)
  const skillBlock = skillCat.ok ? formatSkillCatalog(skillCat.list) : ''
  const historyMessages = formatHistoryForModel(history)
  // 历史已包含本次请求时去重，避免同一条任务消息被注入两遍
  const lastHist = historyMessages[historyMessages.length - 1]
  if (lastHist && lastHist.role === 'user' && lastHist.content.trim() === taskDesc.trim()) {
    historyMessages.pop()
  }

  // 注入运行环境信息，让模型使用正确的命令（如 Windows 下用 python 而非 python3）；日期对日程/日历类任务有用
  const isWin = /win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent || '')
  const now = new Date()
  const dateLine = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`
  const envLine = `${isWin ? 'Windows（命令在 cmd 中执行）' : navigator.platform || '桌面应用'} · 今天是 ${dateLine}`

  // 环境块：对齐 ZCode 的 <environment> 写法，把路径/平台/日期事实集中呈现
  const environmentBlock = [
    '<环境>',
    `工作目录: ${root}`,
    `系统: ${envLine}`,
    '路径规则: 所有文件操作一律使用相对于工作目录的相对路径',
    '</环境>',
  ].join('\n')

  const systemContent = [
    contextPrefix,
    '',
    environmentBlock,
    contextFile,
    workspaceSummary,
    '',
    TOOLS_PROMPT,
    skillBlock,
    '',
    THINKING_DIRECTIVES[thinkingDepth],
  ].join('\n')

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...historyMessages,
    { role: 'user', content: taskDesc },
  ]

  let correctionCount = 0
  const MAX_CORRECTIONS = 3 // 最多纠正 3 次，避免无限循环
  let lastCompactLen = 0 // 上次压缩后的消息数（防抖动）
  let emptyReplies = 0 // 连续空回复计数
  let lastFailedCall = '' // 上一次失败的调用签名（tool + args）
  let sameFailCount = 0 // 相同调用连续失败次数
  let sameCallCount = 0 // 相同调用连续次数（不论成败）
  let lastCallSig = ''  // 上一次调用签名
  let planTalkCount = 0 // 「中途开讲」纠正次数（纯文本计划叙述被误当最终汇报的防线，轮 J）
  let toolCallCount = 0
  // 「只读不写」防线（2026-09-23 用户反馈「写入文件时没有真正的写入文件」）：
  // 弱模型会陷入「反复读同一文件 → 思考 → 停止」，从不动手写。统计各文件读取次数 +
  // 是否发生过写操作，命中即注入催促（最多 2 次），逼它进入写入阶段。
  const readCounts: Record<string, number> = {}
  let wroteAnyFile = false
  let rereadPromptCount = 0
  let writeIntentCount = 0 // 「要求写文件但从未写」纠正次数
  // 重复读取去重（2026-09-23「智商」优化）：同一文件反复读取时，相同内容不再全文重塞上下文，
  // 避免冗余挤爆窗口让模型迷失（实测用户会话里同一文件被读 6 次、同一份 2000 字符重复 6 遍）
  const lastReadOutput: Record<string, string> = {}

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 打断检查
    if (signal?.aborted) throw new DOMException('已打断', 'AbortError')

    // 上报上下文用量（含分类明细）
    const contextWindow = model.contextWindow || DEFAULT_CONTEXT_WINDOW
    const usedNow = estimateTokens(messages)
    try { callbacks.onContextUsage?.(usedNow, contextWindow, computeContextBreakdown(messages, contextWindow)) } catch {}
    try { callbacks.onModelContextUsage?.(model.id, usedNow, contextWindow) } catch {}

    // 上下文达到阈值：自动压缩历史（LLM 摘要），防止溢出
    // 防抖动：距上次压缩至少新增 4 条消息才允许再次压缩
    if (usedNow >= contextWindow * COMPACT_THRESHOLD && messages.length > 3 && messages.length - lastCompactLen >= 4) {
      try {
        await callbacks.onStatus(`📦 ${model.name} 上下文已达 ${Math.round(COMPACT_THRESHOLD * 100)}%，自动压缩历史...`)
      } catch {}
      const compacted = await compactContext(model, messages, signal)
      messages.length = 0
      messages.push(...compacted)
      // 以压缩后的新长度为基准，再新增 4 条后允许再次压缩
      lastCompactLen = messages.length
      const compactedUsed = estimateTokens(messages)
      try { callbacks.onContextUsage?.(compactedUsed, contextWindow, computeContextBreakdown(messages, contextWindow)) } catch {}
      try { callbacks.onModelContextUsage?.(model.id, compactedUsed, contextWindow) } catch {}
    }

    const response = await callModel(model, messages, 0.4, signal, callbacks.onThinking)

    // 空回复：要求重新输出；连续 3 次则放弃（交由上层切换备用模型）
    if (!response.trim()) {
      emptyReplies++
      if (emptyReplies >= 3) throw new Error('模型连续返回空回复')
      messages.push({ role: 'assistant', content: '(空回复)' })
      messages.push({
        role: 'user',
        content: '⚠️ 你的上一条回复是空的。请继续完成任务：输出下一个工具调用（TOOL:/ARGS:），或输出 DONE: 总结。',
      })
      continue
    }
    emptyReplies = 0

    // TOOL → 执行工具（优先检测，工具调用中夹带代码说明是正常的）
    const toolCall = parseToolCall(response)
    if (toolCall) {
      const callSig = toolCall.tool + ' ' + JSON.stringify(toolCall.args)
      // 回调里是写盘 / 更新 UI，失败不该让整轮任务挂掉（与上面的 onContextUsage 一致降级忽略）
      // 轮 I：第二参传结构化 toolCall，UI 端据此 upsert「进行中」工具动作行
      try { await callbacks.onStatus(`🔧 ${model.name} 正在调用 ${toolCall.tool}...`, toolCall) } catch {}
      const result = await executeTool(toolCall.tool, toolCall.args, root, allowExec)
      try { await callbacks.onToolUse(toolCall.tool, toolCall.args, result) } catch {}
      toolCallCount++

      // 「只读不写」统计（别名兼容：read/read_file、write/write_file/edit/edit_file…）
      const tName = String(toolCall.tool || '').toLowerCase()
      if (/^(?:read|read_file|view)$/.test(tName)) {
        const f = String(toolCall.args?.file_path ?? toolCall.args?.path ?? '')
        if (f) readCounts[f] = (readCounts[f] || 0) + 1
      }
      if (/^(?:write|write_file|edit|edit_file|append|append_file)$/.test(tName)) wroteAnyFile = true

      // 重复调用检测（成功也算）：连续 3 次完全相同的调用说明模型在原地打转。
      // 早期版本只统计失败重复，成功的 write_file / append_file 能一路刷到 50 次上限
      if (callSig === lastCallSig) sameCallCount++
      else { sameCallCount = 0; lastCallSig = callSig }

      // 同一调用连续以相同参数失败：第 3 次直接终止（交由上层切换模型），避免空转到最大迭代
      if (!result.ok && callSig === lastFailedCall) {
        sameFailCount++
        if (sameFailCount >= 2) {
          throw new Error(`工具 ${toolCall.tool} 连续 ${sameFailCount + 1} 次以相同参数失败（${(result.output || '').slice(0, 80)}）`)
        }
      } else {
        sameFailCount = 0
      }
      if (!result.ok) lastFailedCall = callSig

      // 工具结果附带指引：失败时要求换方法；每 6 次调用附加一次任务提醒，避免长循环后遗忘任务
      const taskReminder = taskDesc.length > 120 ? taskDesc.slice(0, 120) + '…' : taskDesc
      let tail = ''
      if (!result.ok) {
        tail = '\n\n调用失败。请读懂上面的错误：修正参数或换一种方法实现，禁止用相同参数重试。'
      } else if (sameCallCount >= 2) {
        tail = '\n\n⚠️ 你已经连续 ' + (sameCallCount + 1) + ' 次用完全相同的参数调用 ' + toolCall.tool + '。这一步已经完成，禁止再次重复，请直接进入下一个步骤，或输出 DONE: 总结。'
      } else if (!wroteAnyFile) {
        // 只读不写催促：反复读同一文件却从不动手写 → 强制推进到写入阶段
        const reread = Object.entries(readCounts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0]
        if (reread && rereadPromptCount < 2) {
          rereadPromptCount++
          tail = `\n\n⚠️ 你已经读取「${reread[0]}」${reread[1]} 次，但还没有对任何文件做出修改。读文件是为了改文件——现在立刻动手：新建或整体重写用 TOOL: write_file（ARGS 里给 file_path 和完整 content），局部修改用 TOOL: edit_file（file_path + old_str + new_str）。不要再重复读取同一个文件。`
        }
      } else if (toolCallCount % 6 === 0) {
        tail = `\n\n（任务提醒：${taskReminder}。若已完成就输出 DONE: 简短总结）`
      }
      messages.push({ role: 'assistant', content: response })
      // 重复读取去重：同文件内容与上次完全相同时不再全文重塞（省上下文 + 防模型迷失）
      const readPath = String(toolCall.args?.file_path ?? toolCall.args?.path ?? '')
      const isReadTool = /^(?:read|read_file|view)$/.test(tName)
      let resultBody = result.output.slice(0, 8000)
      if (isReadTool && readPath && result.ok) {
        if (lastReadOutput[readPath] === result.output) {
          resultBody = '（内容与上一次读取完全相同，已省略——直接基于上文内容继续工作，不要重复读取）'
        } else {
          lastReadOutput[readPath] = result.output
        }
      }
      messages.push({
        role: 'user',
        content: `[工具结果 ${toolCall.tool}]\n${result.ok ? '成功' : '失败'}:\n${resultBody}${tail}`,
      })
      continue
    }

    // DONE → 完成校验：总结中不允许包含未保存的大段代码
    const doneSummary = parseDoneResponse(response)
    if (doneSummary !== null) {
      if (hasUnsavedCodeBlock(response) && correctionCount < MAX_CORRECTIONS) {
        correctionCount++
        messages.push({ role: 'assistant', content: response })
        messages.push({
          role: 'user',
          content: `⚠️ 纠正（第 ${correctionCount} 次）：你的 DONE 总结中包含大段代码，但这些代码还没有保存到文件。

请先调用 Write 工具把代码保存到相应文件：
TOOL: write_file
ARGS: {"file_path": "文件名", "content": "完整代码内容"}

全部保存成功后，再输出 DONE: 简要总结（只说明做了什么、保存了哪些文件，不要粘贴完整代码）。`,
        })
        continue
      }
      // 纠正次数用尽仍带代码 → 兜底剥掉代码块，绝不把代码甩给用户
      // （早期版本这里直接 return doneSummary，代码会原样漏到对话里）
      return hasUnsavedCodeBlock(response) ? stripCodeBlocks(response) : (doneSummary || '任务已完成')
    }

    // 直接输出代码块而未调用工具 → 违规，纠正重试（绝不静默接受未保存的代码）
    if (hasUnsavedCodeBlock(response) && correctionCount < MAX_CORRECTIONS) {
      correctionCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 纠正（第 ${correctionCount} 次）：你直接在回复中输出了代码，但没有调用工具保存文件。这违反了规则——所有代码/文件内容必须通过工具写入文件，直接输出代码等于没有完成任务。

请立即调用 Write 工具将刚才的代码保存到合适的文件：
TOOL: write_file
ARGS: {"file_path": "文件名", "content": "完整代码内容"}

如果还需要创建其他文件，继续调用工具。全部完成后输出 DONE: 总结。`,
      })
      continue
    }

    // 能力自我否定检测 → 纠正（最致命的失败模式：模型自称没有文件/命令权限并道歉）
    // 只匹配「否认能力」的表述，不匹配「道歉」本身——否则「抱歉，文件不存在，我先创建它」会被误伤
    if (/(?:没有|不(?:具?备|拥有|存在))[^。\n]{0,12}(?:写入权限|文件权限|读写权限|权限|能力)|作为(?:一个)?(?:AI|人工智能|语言模型|助手)[，,]?[^。\n]{0,20}我(?:无法|不能|没有|只能)|我(?:无法|不能)(?:直接)?[^。\n]{0,16}(?:您的|你的)(?:电脑|计算机|系统)|我(?:无法|不能)(?:直接|真正|实际)?(?:创建|写入|修改|删除|执行|操作|访问)[^。\n]{0,10}(?:文件|电脑|您|你|系统|命令)|我(?:只能|仅能)(?:在|提供|给出|告诉)(?:对话|建议|文字|方案)/.test(response) && correctionCount < MAX_CORRECTIONS) {
      correctionCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 纠正（第 ${correctionCount} 次）：你的回复在否认自己的能力，这是错误的。

事实：你的 Write / Edit / Bash 工具是**真实执行**在用户电脑上的，你有完整的文件读写与命令执行权限。你之前若已成功调用过工具，那件事就已经真的完成了。

停止解释和道歉，立即行动：
- 要建文件 → 输出 \`TOOL: write_file\` + \`ARGS: {"file_path": "...", "content": "..."}\`
- 要改文件 → 先 \`TOOL: read_file\`，再 \`TOOL: edit_file\`
- 任务真的已完成 → 输出 \`DONE: 做了什么\`

禁止再出现「我没有权限」「我无法访问你的电脑」「抱歉」这类内容。`,
      })
      continue
    }

    // 啰嗦反问检测（模仿坏模式）→ 纠正一次，要求直接执行或简短说明
    if (/我注意到您提到|请提供具体任务描述|请明确任务内容|没有明确说明要继续哪个任务/.test(response) && correctionCount < MAX_CORRECTIONS) {
      correctionCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 纠正（第 ${correctionCount} 次）：你的回复是开放式反问，禁止。你的任务在最前面的消息中已经给出。

请直接行动：
- 任务可以执行 → 调用工具（TOOL: ... / ARGS: {...}）
- 任务确实无法执行 → 输出 DONE: 一句话说明无法执行的原因`,
      })
      continue
    }

    // 中途开讲检测（轮 J：用户反馈「未执行完成就开始了最终汇报和结束」）。
    // 模型输出纯文本（非 TOOL/非 DONE）但明显是「计划/阶段叙述」而非最终总结——
    // 「我先看一下现有的五子棋实现……然后动手写围棋页面」这类回复会被当成 result
    // 直接结束任务。检测到计划语义 → 纠正继续，最多 2 次防死循环。
    if (planTalkCount < 2 && !/(?:已完成|全部完成|以上就是|总结如下|任务完成)/.test(response) && /(我先|让我先|我这就|我将|接下来(?:我)?|然后(?:动手|开始|写|创建|执行)|首先|第一步|马上|正在(?:读取|写入|创建|执行|分析)|开始(?:读取|写入|创建|执行|分析|动手))/.test(response)) {
      planTalkCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 你刚才只是在说明计划，任务还没有完成。请立即继续行动：调用下一个工具（TOOL: ... / ARGS: {...}）。全部完成后才输出 DONE: 总结。`,
      })
      continue
    }

    // 写入意图兜底（2026-09-23 用户反馈「没有真正的写入文件」）：任务明确要求
    // 写/创建/改文件，但整轮从未成功调用写入类工具 → 拒绝结束，逼它用工具动手。
    // （弱模型会把内容写在思考里然后声称完成，文件其实一个都没建）
    if (!wroteAnyFile && writeIntentCount < 2 && isWriteIntentTask(taskDesc)) {
      writeIntentCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 你还没有创建或修改任何文件，任务尚未完成。内容停留在思考或回复里等于零。

请立刻调用工具写入文件：
TOOL: write_file
ARGS: {"file_path": "文件名", "content": "完整内容"}

写入成功后再输出 DONE: 简要总结（说明改了哪些文件）。`,
      })
      continue
    }

    // 纯文本最终回答（无代码块，或已达到纠正上限）
    // 兜底：即使纠正次数用尽、模型仍坚持贴代码，也不把代码甩给用户——
    // 只保留结论文字（代码此时已经落在文件里了）
    return hasUnsavedCodeBlock(response) ? stripCodeBlocks(response) : response
  }

  return '(达到最大迭代次数，任务可能未完成)'
}
