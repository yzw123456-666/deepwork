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
}

const MAX_ITERATIONS = 50

// Hermes / Claude Code 风格工具协议：结构化、带示例、强调工具强制调用与代码必须落盘
const TOOLS_PROMPT = `你可以使用以下工具完成任务。每次回复只能做一件事：调用一个工具，或宣布完成。

1. 调用工具（严格按此格式）：
TOOL: <工具名>
ARGS: <JSON参数>

可用工具：
- list_files: 列出目录内容。ARGS: {"path": "子目录，留空为根目录"}
- find_files: 按模式查找文件（支持 glob）。ARGS: {"pattern": "**/*.js 或 *.py 或 src/*.html"}
- read_file: 读文件。ARGS: {"path": "相对路径"}
- write_file: 创建新文件或完全重写文件。ARGS: {"path": "相对路径", "content": "完整内容"}
- edit_file: 精准编辑文件中的一段文本（推荐！比重写整个文件更安全高效）。ARGS: {"path": "相对路径", "old_str": "要替换的精确原文（必须唯一，含缩进）", "new_str": "替换后的新文本"}
- append_file: 在文件末尾追加内容。ARGS: {"path": "相对路径", "content": "追加内容"}
- delete_file: 删除文件或目录。ARGS: {"path": "相对路径"}
- search_files: 在文件内容中搜索文本（grep）。ARGS: {"pattern": "搜索词", "path": "目录，留空为根", "regex": false}
- run_command: 执行命令（如 python/node/npm）。ARGS: {"command": "命令"}

2. 任务完成时：
DONE: <简要总结：做了什么、保存了哪些文件。不要在总结中粘贴完整代码>

⚠️ 强制规则（违反即任务失败）：
- 【代码必须落盘】绝对禁止直接在回复中输出代码块（\`\`\`包裹的内容）。所有代码、网页、文档内容必须通过 write_file 或 edit_file 工具保存到文件。直接输出代码 = 没有完成任务。
- 【行动即调用工具】需要读写文件、执行命令时，只能通过工具完成，不能用文字"假装"完成
- 【反问格式】仅在任务有严重歧义、无法根据历史推断时才反问，且必须用单选题格式：一句话问题 + 2-4 个具体选项（A/B/C/D，基于对话历史推断，禁止开放式提问如"请描述你的任务"）。能推断就不要问。
- 【简洁】回复只包含工具调用或 DONE 总结，不要解释你在做什么、不要复述任务。DONE 总结控制在 3 句话以内。
- 【验证后再完成】输出 DONE 前，确认所有成果都已通过工具保存；DONE 总结中只描述结果，不粘贴大段代码
- 【修改已有文件】优先用 edit_file（提供唯一的 old_str），避免用 write_file 重写整个大文件；old_str 必须与文件内容完全一致（含缩进）且唯一
- 【路径】一律用相对路径（相对于工作目录）
- 【完整内容】write_file 的 content 必须是完整文件内容，禁止省略号或"参考之前"等占位符

示例：
TOOL: edit_file
ARGS: {"path": "index.html", "old_str": "<title>旧标题</title>", "new_str": "<title>新标题</title>"}

TOOL: search_files
ARGS: {"pattern": "function handleClick", "path": ""}

🧭 编程/修改代码类任务，按此流程执行（资深工程师工作法）：
1. 理解：读任务描述，明确要做什么
2. 探索：list_files / find_files 查看项目结构，read_file 阅读相关文件
3. 定位：search_files 找到要修改的具体代码位置
4. 实施：用 edit_file 做最小化精准修改（新文件用 write_file）
5. 验证：read_file 复查修改结果（可用 run_command 运行测试，若已开启）
6. 完成：DONE 总结改了什么、保存在哪`

// ---------- 能力自动询问（添加 API 时自动评估 AI 擅长领域） ----------

export async function probeCapability(model: Model): Promise<{ strengths: string[]; weaknesses: string[]; rating: number } | null> {
  try {
    const response = await callModel(model, [
      {
        role: 'system',
        content: '你是一个 AI 模型自我评估器。请客观评估你自己的能力，严格按以下 JSON 格式输出，不要输出其他任何内容：\n{"strengths": ["擅长领域1", "擅长领域2"], "weaknesses": ["不擅长领域1"], "rating": <1-10综合评分>}',
      },
      { role: 'user', content: '请评估你自己的擅长能力。' },
    ], 0.3)
    const jsonStart = response.indexOf('{')
    const jsonEnd = response.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return null
    const parsed = JSON.parse(response.slice(jsonStart, jsonEnd + 1))
    if (!Array.isArray(parsed.strengths)) return null
    return {
      strengths: parsed.strengths.slice(0, 8).map(String),
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.slice(0, 5).map(String) : [],
      rating: Math.min(10, Math.max(1, Number(parsed.rating) || 5)),
    }
  } catch {
    return null
  }
}

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
  const baseUrl = model.baseUrl || 'https://api.openai.com/v1'
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey || ''}`,
    },
    body: JSON.stringify({
      model: model.name,
      messages,
      stream: true,
      temperature,
      max_tokens: model.contextWindow || 32768,
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`)
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

  // reasoning_content 为空且无 <think> 时，尝试把 content 里疑似思考的前段传给 onThinking（保底）
  if (!thinkContent && !thinkMatch && !openThink && !content) {
    // 无输出
  }

  return content
}

// ---------- 工具解析与执行 ----------

export function parseToolCall(text: string): ToolCall | null {
  const match = text.match(/TOOL:\s*(\w+)[\s\n]+ARGS:\s*([\s\S]+)/)
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
    return { tool: match[1].trim(), args }
  } catch {
    return null
  }
}

export async function executeTool(
  tool: string,
  args: Record<string, any>,
  root: string,
  allowExec: boolean
): Promise<ToolResult> {
  const api = window.electronAPI
  if (!api) return { ok: false, output: '无 Electron 环境' }

  const relPath = String(args.path ?? '')

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
        const r = await api.agent.readFile(root, relPath)
        if (!r.ok) return { ok: false, output: r.error || '读文件失败' }
        return { ok: true, output: r.content || '' }
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
        const r = await api.agent.editFile(root, relPath, oldStr, newStr)
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
        const r = await api.agent.execCommand(root, String(args.command ?? ''), 60000)
        const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, `exit: ${r.exitCode}`]
          .filter(Boolean).join('\n')
        return { ok: r.ok, output: out || '(无输出)' }
      }
      case 'use_skill': {
        const skillName = String(args.skill_name ?? '')
        const skillDesc = String(args.description ?? '')
        return { ok: true, output: `已调用技能「${skillName}」${skillDesc ? ': ' + skillDesc : ''}` }
      }
      default:
        return { ok: false, output: `未知工具: ${tool}。可用工具: list_files, find_files, read_file, write_file, edit_file, append_file, delete_file, search_files, run_command, use_skill` }
    }
  } catch (e: any) {
    return { ok: false, output: e.message }
  }
}

// ---------- 历史消息格式化（供所有模型调用复用） ----------
// 过滤执行状态噪音（🧠⚙️🔧📋🫡 等状态行），保留工具结果与实质内容，合并连续同角色消息
export function formatHistoryForModel(
  history: Array<{ role: string; content: string }> | undefined
): Array<{ role: string; content: string }> {
  if (!history || history.length === 0) return []

  const cleaned: Array<{ role: string; content: string }> = []
  for (const m of history) {
    const content = (m.content || '').trim()
    if (!content) continue

    if (m.role === 'system') {
      // 仅保留工具结果消息（✅/❌ 开头），跳过瞬态状态消息（🧠⚙️🔧 等）
      if (/^[✅❌]/.test(content)) {
        cleaned.push({ role: 'user', content: `[历史工具操作] ${content}` })
      }
      continue
    }
    if (m.role === 'user') {
      cleaned.push({ role: 'user', content })
      continue
    }
    // main → assistant
    // 跳过纯状态播报，保留完成结果
    cleaned.push({ role: 'assistant', content })
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
  onStatus: (content: string) => Promise<void>   // 更新状态消息
  onToolUse: (tool: string, args: Record<string, any>, result: ToolResult) => Promise<void>
  onContextUsage?: (usedTokens: number, maxTokens: number) => void  // 上下文用量回调
  onModelContextUsage?: (modelId: string, usedTokens: number, maxTokens: number) => void  // 按模型上报上下文用量
  onThinking?: (text: string) => void  // 思考过程回调
}

// 默认上下文窗口（tokens）
export const DEFAULT_CONTEXT_WINDOW = 32768

// 上下文压缩阈值：达到 80% 自动压缩历史（LLM 摘要）
const COMPACT_THRESHOLD = 0.8

// 粗略估算 tokens（中英混合约 3 字符/token）
function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  return Math.ceil(messages.reduce((s, m) => s + m.content.length, 0) / 3)
}

// 上下文压缩（OpenClaw Compaction 风格）：
// 保留 system 提示 + 最近几条消息，中间历史用 LLM 压缩为摘要
// 摘要强制保留：任务目标、文件路径、关键数字、代码要点、未完成事项
async function compactContext(
  model: Model,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal
): Promise<Array<{ role: string; content: string }>> {
  const KEEP_RECENT = 4
  if (messages.length <= KEEP_RECENT + 2) return messages
  const system = messages[0]
  const middle = messages.slice(1, messages.length - KEEP_RECENT)
  const recent = messages.slice(messages.length - KEEP_RECENT)
  const compactPrompt = `请将以下 AI Agent 对话历史压缩为简洁摘要（不超过 800 字），必须严格保留：
1. 任务目标与用户原始需求
2. 所有文件路径、文件名
3. 关键数字、命令、配置项
4. 已完成的操作与工具调用结果要点
5. 未完成事项与注意事项
直接输出摘要正文，不要任何开场白。

对话历史：
${middle.map(m => `[${m.role}] ${m.content.slice(0, 2000)}`).join('\n\n')}`
  try {
    const summary = await callModel(model, [{ role: 'user', content: compactPrompt }], 0.2, signal)
    return [{ role: 'system', content: system.content }, { role: 'user', content: `[历史摘要 - 由系统自动压缩生成]\n${summary}` }, ...recent]
  } catch {
    // 压缩失败则降级：截断保留每条开头
    const fallback = middle.map(m => ({ role: m.role, content: m.content.slice(0, 300) }))
    return [{ role: 'system', content: system.content }, ...fallback, ...recent]
  }
}

// 检测回复中是否包含未保存的大段代码块（>200 字符的围栏代码块）
function hasUnsavedCodeBlock(text: string): boolean {
  const blocks = text.match(/```[\s\S]*?```/g) || []
  if (blocks.some(b => b.length > 200)) return true
  if (/<!DOCTYPE|<html[\s>]/i.test(text) && text.length > 200) return true
  return false
}

export async function runAgentLoop(
  model: Model,
  root: string,
  taskDesc: string,
  contextPrefix: string,
  allowExec: boolean,
  callbacks: AgentLoopCallbacks,
  history?: Array<{ role: string; content: string }>,
  signal?: AbortSignal
): Promise<string> {
  const contextFile = await loadContextFile(root)
  const workspaceSummary = await getWorkspaceSummary(root)
  const historyMessages = formatHistoryForModel(history)
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: `${contextPrefix}${contextFile}${workspaceSummary}\n\n${TOOLS_PROMPT}` },
    ...historyMessages,
    { role: 'user', content: taskDesc },
  ]

  let correctionCount = 0
  const MAX_CORRECTIONS = 3 // 最多纠正 3 次，避免无限循环
  let lastCompactLen = 0 // 上次压缩时的消息数（防抖动）

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 打断检查
    if (signal?.aborted) throw new DOMException('已打断', 'AbortError')

    // 上报上下文用量
    const contextWindow = model.contextWindow || DEFAULT_CONTEXT_WINDOW
    const usedNow = estimateTokens(messages)
    try { callbacks.onContextUsage?.(usedNow, contextWindow) } catch {}
    try { callbacks.onModelContextUsage?.(model.id, usedNow, contextWindow) } catch {}

    // 上下文达到阈值：自动压缩历史（LLM 摘要），防止溢出
    // 防抖动：距上次压缩至少新增 4 条消息才允许再次压缩
    if (usedNow >= contextWindow * COMPACT_THRESHOLD && messages.length > 6 && messages.length - lastCompactLen >= 4) {
      lastCompactLen = messages.length
      try {
        await callbacks.onStatus(`📦 ${model.name} 上下文已达 ${Math.round(COMPACT_THRESHOLD * 100)}%，自动压缩历史...`)
      } catch {}
      const compacted = await compactContext(model, messages, signal)
      messages.length = 0
      messages.push(...compacted)
      try { callbacks.onContextUsage?.(estimateTokens(messages), contextWindow) } catch {}
      try { callbacks.onModelContextUsage?.(model.id, estimateTokens(messages), contextWindow) } catch {}
    }

    const response = await callModel(model, messages, 0.4, signal, callbacks.onThinking)

    // TOOL → 执行工具（优先检测，工具调用中夹带代码说明是正常的）
    const toolCall = parseToolCall(response)
    if (toolCall) {
      await callbacks.onStatus(`🔧 ${model.name} 正在调用 ${toolCall.tool}...`)
      const result = await executeTool(toolCall.tool, toolCall.args, root, allowExec)
      await callbacks.onToolUse(toolCall.tool, toolCall.args, result)
      // 工具结果附带任务提醒，避免长循环后模型遗忘自己的任务
      const taskReminder = taskDesc.length > 120 ? taskDesc.slice(0, 120) + '…' : taskDesc
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `[工具结果 ${toolCall.tool}]\n${result.ok ? '成功' : '失败'}:\n${result.output.slice(0, 8000)}\n\n（你的任务：${taskReminder}。若已完成就输出 DONE: 简短总结，否则继续下一个工具调用，不要提问）`,
      })
      continue
    }

    // DONE → 完成校验：总结中不允许包含未保存的大段代码
    if (response.trim().startsWith('DONE:')) {
      if (hasUnsavedCodeBlock(response) && correctionCount < MAX_CORRECTIONS) {
        correctionCount++
        messages.push({ role: 'assistant', content: response })
        messages.push({
          role: 'user',
          content: `⚠️ 纠正（第 ${correctionCount} 次）：你的 DONE 总结中包含大段代码，但这些代码还没有保存到文件。

请先调用 write_file 工具把代码保存到相应文件：
TOOL: write_file
ARGS: {"path": "文件名", "content": "完整代码内容"}


全部保存成功后，再输出 DONE: 简要总结（只说明做了什么、保存了哪些文件，不要粘贴完整代码）。`,
        })
        continue
      }
      return response.replace(/^DONE:\s*/, '').trim()
    }

    // 直接输出代码块而未调用工具 → 违规，纠正重试（OpenClaw: 绝不静默接受未保存的代码）
    if (hasUnsavedCodeBlock(response) && correctionCount < MAX_CORRECTIONS) {
      correctionCount++
      messages.push({ role: 'assistant', content: response })
      messages.push({
        role: 'user',
        content: `⚠️ 纠正（第 ${correctionCount} 次）：你直接在回复中输出了代码，但没有调用工具保存文件。这违反了规则——所有代码/文件内容必须通过工具写入文件，直接输出代码等于没有完成任务。

请立即调用 write_file 工具将刚才的代码保存到合适的文件：
TOOL: write_file
ARGS: {"path": "文件名", "content": "完整代码内容"}


如果还需要创建其他文件，继续调用工具。全部完成后输出 DONE: 总结。`,
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

    // 纯文本最终回答（无代码块，或已达到纠正上限）
    return response
  }

  return '(达到最大迭代次数，任务可能未完成)'
}
