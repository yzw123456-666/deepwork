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

const MAX_ITERATIONS = 15

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
      max_tokens: 4096,
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
  // 容忍 TOOL 与 ARGS 之间的任意空白/换行，以及行首多余符号
  const match = text.match(/TOOL:\s*(\w+)[\s\n]+ARGS:\s*([\s\S]+)/)
  if (!match) return null
  try {
    // 提取 JSON（容忍模型在 JSON 后附加文字）
    const argsStr = match[2].trim()
    const jsonStart = argsStr.indexOf('{')
    const jsonEnd = argsStr.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) return null
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
    // main / sub → assistant
    // 跳过纯状态播报（如 "⚙️ XXX 开始执行：..."），保留完成结果
    if (m.role === 'sub' && /^⚙️/.test(content)) continue
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
    const usedNow = estimateTokens(messages)
    try { callbacks.onContextUsage?.(usedNow, DEFAULT_CONTEXT_WINDOW) } catch {}
    try { callbacks.onModelContextUsage?.(model.id, usedNow, DEFAULT_CONTEXT_WINDOW) } catch {}

    // 上下文达到阈值：自动压缩历史（LLM 摘要），防止溢出
    // 防抖动：距上次压缩至少新增 4 条消息才允许再次压缩
    if (usedNow >= DEFAULT_CONTEXT_WINDOW * COMPACT_THRESHOLD && messages.length > 6 && messages.length - lastCompactLen >= 4) {
      lastCompactLen = messages.length
      try {
        await callbacks.onStatus(`📦 ${model.name} 上下文已达 ${Math.round(COMPACT_THRESHOLD * 100)}%，自动压缩历史...`)
      } catch {}
      const compacted = await compactContext(model, messages, signal)
      messages.length = 0
      messages.push(...compacted)
      try { callbacks.onContextUsage?.(estimateTokens(messages), DEFAULT_CONTEXT_WINDOW) } catch {}
      try { callbacks.onModelContextUsage?.(model.id, estimateTokens(messages), DEFAULT_CONTEXT_WINDOW) } catch {}
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

// ---------- 多AI协作编排 ----------

export interface Assignment {
  modelId: string
  taskDesc: string
}

export function parsePlan(text: string): { direct?: string; assignments: Assignment[] } {
  const trimmed = text.trim()
  if (trimmed.startsWith('DIRECT:')) {
    return { direct: trimmed.replace(/^DIRECT:\s*/, '').trim(), assignments: [] }
  }
  if (trimmed.startsWith('ASSIGN:')) {
    const assignments = trimmed
      .replace(/^ASSIGN:/, '')
      .split(/\n---\n|---/)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => {
        const modelMatch = block.match(/MODEL:\s*(.+)/)
        const taskMatch = block.match(/TASK:\s*([\s\S]+)/)
        return {
          modelId: modelMatch?.[1]?.trim() || '',
          taskDesc: taskMatch?.[1]?.trim() || '',
        }
      })
      .filter(a => a.modelId && a.taskDesc)
    if (assignments.length > 0) return { assignments }
  }
  return { direct: trimmed, assignments: [] }
}

export interface OrchestrationResult {
  success: boolean
  finalAnswer: string
  failures: Array<{ modelId: string; taskDesc: string; error: string }>
}

// 并行执行附属任务，失败时由主模型接管
export async function orchestrate(
  mainModel: Model,
  subModels: Model[],
  root: string,
  userRequest: string,
  subModelListDesc: string,
  allowExec: boolean,
  capabilityStats: Array<{ modelId: string; taskCount: number; successRate: number; failureCount: number }>,
  getCapabilityDesc: (modelId: string) => string,
  callbacks: {
    onStatus: (content: string) => Promise<void>
    onPlan: (assignments: Assignment[]) => Promise<void>
    onSubStart: (assignment: Assignment) => Promise<void>
    onSubDone: (assignment: Assignment, result: string) => Promise<void>
    onSubFail: (assignment: Assignment, error: string) => Promise<void>
    onSubRetry?: (failed: Assignment, retryModelName: string) => Promise<void>
    onMainTakeover: (assignment: Assignment) => Promise<void>
    onToolUse?: (tool: string, args: Record<string, any>, result: ToolResult) => Promise<void>
    onModelContextUsage?: (modelId: string, usedTokens: number, maxTokens: number) => void
    onContextUsage?: (usedTokens: number, maxTokens: number) => void
    onThinking?: (text: string) => void
  },
  taskHistory?: Array<{ role: string; content: string; modelId?: string }>,
  signal?: AbortSignal
): Promise<OrchestrationResult> {
  // 重复失败检测：失败次数 >= 2 的模型标记为"不可靠"，主模型优先亲自做
  const unreliableIds = new Set(
    capabilityStats.filter(s => s.failureCount >= 2).map(s => s.modelId)
  )
  const unreliableNames = subModels.filter(m => unreliableIds.has(m.id)).map(m => m.name)

  // 1. 主模型制定计划
  const warningText = unreliableNames.length > 0
    ? `\n\n⚠️ 注意：以下附属模型近期反复失败（${unreliableNames.join('、')}），不要分配任务给它们；如果任务属于它们的擅长领域，请考虑亲自执行（输出 DIRECT:）。`
    : ''

  await callbacks.onStatus(
    unreliableNames.length > 0
      ? `🧠 ${mainModel.name} 正在分析任务（⚠ ${unreliableNames.join('、')} 近期反复失败，主模型将重点关注）...`
      : `🧠 ${mainModel.name} 正在分析任务并分配工作...`
  )
  // 过滤历史中的旧式啰嗦反问（避免小模型模仿坏模式）
  const cleanedHistory = formatHistoryForModel(taskHistory).filter(m =>
    !(m.role === 'assistant' && /请提供具体任务描述|没有明确说明|我注意到您提到|请明确任务内容/.test(m.content))
  )

  // 计划阶段上下文用量上报（环立即显示）
  try {
    const planChars = subModelListDesc.length + userRequest.length + cleanedHistory.reduce((s, m) => s + m.content.length, 0)
    callbacks.onContextUsage?.(Math.ceil(planChars / 3), DEFAULT_CONTEXT_WINDOW)
  } catch {}

  const planResponse = await callModel(mainModel, [
    {
      role: 'system',
      content: `你是主模型（指挥官），负责协调多个附属AI完成任务。

你的附属模型：
${subModelListDesc}${warningText}

分析用户任务后决定：
1. 简单问答、只有你能做、或附属模型不可靠 → 直接回答，输出格式：DIRECT: 你的回答（注意：需要创建/修改文件的任务禁止用 DIRECT 粘贴代码，必须走 ASSIGN 分配执行，代码必须通过工具写入文件）
2. 需要分工 → 输出分配计划：
ASSIGN:
MODEL: <附属模型名称>
TASK: <具体任务描述，要具体明确可独立完成，写明目标文件名>
---
（可分配多个，用 --- 分隔）

规则：
- 【优先自行推断】能根据对话历史推断意图的，直接输出 DIRECT 或 ASSIGN，不要反问。对"继续"、"继续刚才的任务"等模糊指令：从历史中找出最近的任务及其完成状态，直接分配下一步工作。
- 【反问格式】只有任务有严重歧义、确实无法推断时才反问，且必须用单选题格式输出：
DIRECT: QUESTION: 一句话问题
A. 具体选项1
B. 具体选项2
C. 具体选项3
（2-4 个选项，基于对话历史推断得出，禁止开放式提问如"请描述任务内容"）
- 【简洁】输出只有 DIRECT 或 ASSIGN 格式内容，不要解释你的分析过程
- 【智能分配】根据模型参数量(B)和综合能力分分配任务：综合分高的模型处理复杂/核心任务，综合分低的模型处理简单任务。综合分低于5或成功率低于60%的模型尽量少用
- 每个附属模型只做它擅长的事
- 文件操作类任务必须写明目标文件名（如"创建 index.html"而非"写一个网页"）
- 任务之间尽量独立，便于并行执行
- 反复失败的模型不要分配任务，宁可自己做
- 如果对话历史中已有相关成果（如已创建的文件），新任务应基于现有成果继续，不要从零重做`,
    },
    // 完整对话历史（跨轮次记忆，已过滤啰嗦反问）
    ...cleanedHistory,
    { role: 'user', content: userRequest },
  ], 0.3, signal, callbacks.onThinking)

  let plan = parsePlan(planResponse)

  // DIRECT 啰嗦反问检测：含开放式措辞（"请提供具体任务描述"等）即重试，转为直接执行或精简单选题
  if (plan.direct && plan.assignments.length === 0) {
    const verboseQuestion = /请(提供|明确|告诉|说明|描述|补充)|没有明确说明|请明确任务内容|我注意到您提到/.test(plan.direct)
    if (verboseQuestion) {
      await callbacks.onStatus(`🧠 ${mainModel.name} 正在根据历史重新分析...`)
      const retryResponse = await callModel(mainModel, [
        {
          role: 'system',
          content: `你是主模型（指挥官），负责协调多个附属AI完成任务。

你的附属模型：
${subModelListDesc}

结合对话历史理解用户消息——历史记录了之前创建的文件（如 hello.html、围棋网站 index.html）和完成的任务，模糊指令（如"继续"、"改一下"）指的就是那些内容。

现在直接行动，三选一：
a) 简单问答 → DIRECT: 你的回答（一两句话）
b) 需要执行/分工 → ASSIGN:
MODEL: <附属模型名称>
TASK: <具体任务描述，写明目标文件名>
---
c) 确实无法推断 → DIRECT: QUESTION: 一句话问题
A. 选项1
B. 选项2
C. 选项3

只输出 a/b/c 之一的格式内容，禁止其他任何文字，禁止复述用户的话，禁止解释。`,
        },
        ...cleanedHistory,
        { role: 'user', content: userRequest },
      ], 0.3, signal, callbacks.onThinking)
      const retryPlan = parsePlan(retryResponse)
      // 重试结果有效且不再啰嗦即采纳
      const retryVerbose = retryPlan.direct && /请(提供|明确|告诉|说明|描述|补充)|没有明确说明|我注意到您提到|请明确任务内容/.test(retryPlan.direct)
      if ((retryPlan.direct || retryPlan.assignments.length > 0) && !retryVerbose) {
        plan = retryPlan
      }
    }
  }

  // 直接回答
  if (plan.direct && plan.assignments.length === 0) {
    // 直接回答中包含未保存的大段代码 → 主模型亲自进入工具循环保存（杜绝静默失败）
    if (hasUnsavedCodeBlock(plan.direct)) {
      await callbacks.onStatus(`🧠 ${mainModel.name} 正在亲自执行并通过工具保存文件...`)
      try {
        const directResult = await runAgentLoop(
          mainModel,
          root,
          userRequest,
          `你是主模型「${mainModel.name}」，决定亲自完成此任务。你的擅长领域：${getCapabilityDesc(mainModel.id)}。工作目录：${root}\n\n你之前的直接回答中包含了代码但尚未保存。请使用工具将所有成果保存到文件。任务完成时输出 DONE: 总结结果。`,
          allowExec,
          {
            onStatus: callbacks.onStatus,
            onToolUse: async (tool, args, result) => {
              await callbacks.onToolUse?.(tool, args, result)
            },
            onModelContextUsage: callbacks.onModelContextUsage,
            onContextUsage: callbacks.onContextUsage,
            onThinking: callbacks.onThinking,
          },
          cleanedHistory,
          signal
        )
        return { success: true, finalAnswer: directResult, failures: [] }
      } catch {
        // 工具执行失败则退回直接回答
        return { success: true, finalAnswer: plan.direct, failures: [] }
      }
    }
    return { success: true, finalAnswer: plan.direct, failures: [] }
  }

  await callbacks.onPlan(plan.assignments)

  // 2. 按模型名匹配，并行执行（不可靠模型的任务跳过，由主模型接管）
  const nameToModel = new Map(subModels.map(m => [m.name, m]))
  const executable = plan.assignments.filter(a => !unreliableIds.has(nameToModel.get(a.modelId)?.id || ''))
  const skippedByWarning = plan.assignments.filter(a => unreliableIds.has(nameToModel.get(a.modelId)?.id || ''))

  // 顺序执行，让后续 Agent 能看到前面 Agent 的结果（串行避免上下文冲突）
  const completedResults: Array<{ modelId: string; taskDesc: string; result: string }> = []
  
  for (const assignment of executable) {
    // 打断检查
    if (signal?.aborted) throw new DOMException('已打断', 'AbortError')
    const subModel = nameToModel.get(assignment.modelId)
    if (!subModel) {
      throw new Error(`找不到附属模型: ${assignment.modelId}`)
    }
    await callbacks.onSubStart(assignment)
    try {
      // Build context including completed sibling results
      const siblingResults = completedResults
        .map(r => `[${r.modelId} 已完成]\n任务: ${r.taskDesc}\n结果: ${r.result.slice(0, 3000)}`)
        .join('\n\n')
      
      const otherAssignments = plan.assignments
        .filter(a => a.modelId !== assignment.modelId)
        .map(a => `- ${a.modelId}: ${a.taskDesc}`)
        .join('\n')
      
      const contextPrefix = `你是附属AI模型「${subModel.name}」。你的擅长领域：${getCapabilityDesc(subModel.id)}。工作目录：${root}

[原始任务目标]
${userRequest}

[主模型制定的整体计划]
${plan.assignments.map(a => `- ${a.modelId}: ${a.taskDesc}`).join('\n')}

[你的具体任务]
${assignment.taskDesc}

${otherAssignments ? `[其他附属模型任务]\n${otherAssignments}` : ''}

${siblingResults ? `[已完成的同伴任务结果]\n${siblingResults}` : ''}

你是团队中的执行者，专注完成分配给你的具体任务。禁止向用户提问，不确定就按最合理理解直接执行。任务完成时输出 DONE: 简短总结（3 句话以内）。`

      const result = await runAgentLoop(
        subModel,
        root,
        assignment.taskDesc,
        contextPrefix,
        allowExec,
        {
          onStatus: callbacks.onStatus,
          onToolUse: async (tool, args, result) => {
            await callbacks.onToolUse?.(tool, args, result)
          },
          onModelContextUsage: callbacks.onModelContextUsage,
          onContextUsage: callbacks.onContextUsage,
          onThinking: callbacks.onThinking,
        },
        cleanedHistory,
        signal
      )
      await callbacks.onSubDone(assignment, result)
      completedResults.push({ modelId: assignment.modelId, taskDesc: assignment.taskDesc, result })
    } catch (err: any) {
      await callbacks.onSubFail(assignment, err.message)
      throw Object.assign(err, { assignment })
    }
  }

  const results: Array<PromiseSettledResult<{ modelId: string; taskDesc: string; result: string }>> = completedResults.map(r => ({ status: 'fulfilled' as const, value: r }))

  // 3. 收集结果，失败的由主模型接管重做
  const failures: Array<{ modelId: string; taskDesc: string; error: string }> = []
  const successResults: string[] = []
  const takeoverTasks: Assignment[] = [...skippedByWarning]

  results.forEach((r: any, idx) => {
    const assignment = executable[idx]
    if (r.status === 'fulfilled') {
      successResults.push(`[${assignment.modelId} ✅]\n${r.value.result}`)
    } else {
      const errMsg = r.reason?.message || r.value?.error || '未知错误'
      failures.push({ modelId: assignment.modelId, taskDesc: assignment.taskDesc, error: errMsg })
      takeoverTasks.push(assignment)
    }
  })

  // 4. 变通处理：附属模型失败 → 先换一个健康的附属模型重试 → 再失败主模型亲自上
  const statsByName = new Map<string, { taskCount: number; successRate: number; failureCount: number }>()
  for (const s of capabilityStats) {
    const m = subModels.find(sm => sm.id === s.modelId)
    if (m) statsByName.set(m.name, s)
  }

  // 选替补：排除失败模型与不可靠模型，按成功率降序
  const pickAlternate = (failedName: string): Model | null => {
    const candidates = subModels
      .filter(m => m.name !== failedName && !unreliableIds.has(m.id))
      .sort((a, b) => (statsByName.get(b.name)?.successRate ?? 100) - (statsByName.get(a.name)?.successRate ?? 100))
    return candidates[0] || null
  }

  for (const task of takeoverTasks) {
    let handled = false

    // 4.1 尝试换一个附属模型重试
    if (!signal?.aborted) {
      const alternate = pickAlternate(task.modelId)
      if (alternate) {
        await callbacks.onSubRetry?.(task, alternate.name)
        try {
          const retryContext = `你是附属模型「${alternate.name}」。你的擅长领域：${getCapabilityDesc(alternate.id)}。工作目录：${root}

[原始任务目标]
${userRequest}

[整体计划]
${plan.assignments.map(a => `- ${a.modelId}: ${a.taskDesc}`).join('\n')}

[你要完成的任务]
${task.taskDesc}

注意：附属模型「${task.modelId}」执行此任务失败了（请避免同样的错误）。请使用工具完成任务，任务完成时输出 DONE: 总结结果。`
          const result = await runAgentLoop(
            alternate,
            root,
            task.taskDesc,
            retryContext,
            allowExec,
            {
              onStatus: callbacks.onStatus,
              onToolUse: async (tool, args, result) => {
                await callbacks.onToolUse?.(tool, args, result)
              },
              onModelContextUsage: callbacks.onModelContextUsage,
              onContextUsage: callbacks.onContextUsage,
              onThinking: callbacks.onThinking,
            },
            cleanedHistory,
            signal
          )
          successResults.push(`[${alternate.name} (替补接管) ✅]\n${result}`)
          const fi = failures.findIndex(f => f.taskDesc === task.taskDesc)
          if (fi >= 0) failures.splice(fi, 1)
          handled = true
        } catch {
          // 替补也失败 → 主模型亲自上
        }
      }
    }

    // 4.2 主模型接管（替补失败或无可用替补）
    if (!handled && !signal?.aborted) {
      await callbacks.onMainTakeover(task)
      try {
        // Build full context for main model takeover
        const otherAssignments = plan.assignments
          .filter(a => a.modelId !== task.modelId)
          .map(a => `- ${a.modelId}: ${a.taskDesc}`)
          .join('\n')

        const takeoverContext = `你是主模型「${mainModel.name}」，正在接管失败的任务。你的擅长领域：${getCapabilityDesc(mainModel.id)}。工作目录：${root}

[原始任务目标]
${userRequest}

[主模型制定的整体计划]
${plan.assignments.map(a => `- ${a.modelId}: ${a.taskDesc}`).join('\n')}

[失败的任务]
附属模型「${task.modelId}」执行以下任务失败：\n${task.taskDesc}

${otherAssignments ? `[其他附属模型正在并行执行的任务]\n${otherAssignments}` : ''}

前一个附属模型执行失败了，你需要亲自完成这个任务。请结合原始任务目标和整体计划，利用你的能力和工具，确保任务完成。任务完成时输出 DONE: 总结结果。`

        const result = await runAgentLoop(
          mainModel,
          root,
          task.taskDesc,
          takeoverContext,
          allowExec,
          {
            onStatus: callbacks.onStatus,
            onToolUse: async (tool, args, result) => {
              await callbacks.onToolUse?.(tool, args, result)
            },
            onModelContextUsage: callbacks.onModelContextUsage,
            onContextUsage: callbacks.onContextUsage,
            onThinking: callbacks.onThinking,
          },
          cleanedHistory,
          signal
        )
        successResults.push(`[${mainModel.name} (主模型接管) ✅]\n${result}`)
        // 从失败列表移除
        const fi = failures.findIndex(f => f.taskDesc === task.taskDesc)
        if (fi >= 0) failures.splice(fi, 1)
      } catch (err: any) {
        // 接管也失败，保留失败记录
      }
    }
  }

  // 4.5 验收环节：主模型亲自用工具抽查成果是否落盘、是否符合需求、是否有问题
  let reviewNote = ''
  if (successResults.length > 0 && !signal?.aborted) {
    await callbacks.onStatus(`🔍 ${mainModel.name} 正在验收成果（用工具抽查文件与需求符合度）...`)
    const reviewInput = successResults.map(r => r.slice(0, 1200)).join('\n\n')
    const reviewDesc = `验收团队成果。用户需求与分工结果如下，请实际用工具核查（list_dir 确认文件真实存在，read_file 抽查内容是否匹配需求），不要轻信结果描述。

[用户需求]
${userRequest}

[分工与结果]
${reviewInput}

核查后输出验收结论，格式严格为每项一行：
[任务描述] PASS
[任务描述] FAIL: 具体问题
最后输出 DONE: 验收总结（一句话总体结论）。`
    try {
      const reviewOut = await runAgentLoop(
        mainModel,
        root,
        reviewDesc,
        `你是主模型「${mainModel.name}」，当前角色是严格的项目验收员。工作目录：${root}。只核查不修改文件（发现问题记录，不亲自修）。`,
        allowExec,
        {
          onStatus: callbacks.onStatus,
          onToolUse: async (tool, args, result) => {
            await callbacks.onToolUse?.(tool, args, result)
          },
          onModelContextUsage: callbacks.onModelContextUsage,
          onContextUsage: callbacks.onContextUsage,
          onThinking: callbacks.onThinking,
        },
        undefined,
        signal
      )
      const verdictLines = [...reviewOut.matchAll(/\[([^\]]+?)\]\s*(PASS|FAIL)\s*:?\s*([^\n]*)/g)]
      const failedItems = verdictLines.filter(m => m[2] === 'FAIL')
      if (failedItems.length === 0 && !/VERDICT:\s*FAIL/i.test(reviewOut)) {
        reviewNote = `✅ 验收通过（${verdictLines.length || successResults.length} 项核查）`
      } else {
        // 打回返工：把 FAIL 项交回原附属模型修正（最多一轮）
        reviewNote = `⚠️ 验收发现 ${failedItems.length} 项问题，已打回返工`
        for (const f of failedItems) {
          if (signal?.aborted) break
          const target = plan.assignments.find(a => a.taskDesc.includes(f[1].slice(0, 15)) || f[1].includes(a.taskDesc.slice(0, 15)))
          if (!target) continue
          const subModel = nameToModel.get(target.modelId)
          if (!subModel) continue
          await callbacks.onStatus(`🔄 ${target.modelId} 正在返工：${target.taskDesc}（问题：${(f[3] || '不符合要求').slice(0, 80)}）`)
          const reworkContext = `你是附属AI模型「${subModel.name}」。工作目录：${root}

[原始任务目标]
${userRequest}

[你的任务]
${target.taskDesc}

[验收反馈 - 上次执行未通过]
问题：${f[3] || '成果不符合要求或不完整'}
请修正以上问题，确保成果真实落盘（用工具写入文件），完成后输出 DONE: 修正说明。`
          try {
            const reworkResult = await runAgentLoop(
              subModel,
              root,
              target.taskDesc,
              reworkContext,
              allowExec,
              {
                onStatus: callbacks.onStatus,
                onToolUse: async (tool, args, result) => {
                  await callbacks.onToolUse?.(tool, args, result)
                },
                onModelContextUsage: callbacks.onModelContextUsage,
                onContextUsage: callbacks.onContextUsage,
                onThinking: callbacks.onThinking,
              },
              undefined,
              signal
            )
            await callbacks.onSubDone(target, reworkResult)
            // 替换原结果
            const ri = successResults.findIndex(r => r.includes(target.taskDesc.slice(0, 20)))
            if (ri >= 0) successResults[ri] = `[${target.modelId} ✅（已返工）]\n${reworkResult}`
            reviewNote = `✅ 验收发现 ${failedItems.length} 项问题，返工后已修正`
          } catch {
            reviewNote = `❌ 验收发现问题且返工失败：${target.taskDesc}`
          }
        }
      }
    } catch {
      // 验收环节失败不阻塞主流程
      reviewNote = ''
    }
  }

  // 5. 汇总
  await callbacks.onStatus(`🧠 ${mainModel.name} 正在汇总所有结果...`)
  let finalAnswer: string
  if (successResults.length > 0) {
    finalAnswer = await callModel(mainModel, [
      { role: 'system', content: `你是主模型「${mainModel.name}」，负责汇总团队工作结果。

汇总要求（严格精简）：
1. 用一句话说明任务目标
2. 逐条列出完成了什么、保存/修改了哪些文件
3. 如有失败，简要说明原因
4. 总长度控制在 200 字以内，禁止粘贴代码，禁止解释过程` },
      // 完整对话历史（跨轮次记忆，已过滤啰嗦反问）
      ...cleanedHistory,
      { role: 'user', content: `原始任务：${userRequest}\n\n各任务结果：\n${successResults.join('\n\n')}${failures.length > 0 ? `\n\n未完成：${failures.map(f => `${f.taskDesc}（原因：${f.error}）`).join('\n')}` : ''}${reviewNote ? `\n\n主模型验收结论：${reviewNote}` : ''}` },
    ], 0.5, signal, callbacks.onThinking)
  } else {
    finalAnswer = `所有子任务均失败。\n失败详情：\n${failures.map(f => `- ${f.taskDesc}: ${f.error}`).join('\n')}`
  }

  return { success: failures.length === 0, finalAnswer, failures }
}
