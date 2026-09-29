import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Plus,
  Sparkles,
  Code,
  Palette,
  FileText,
  BarChart3,
  Layout,
  Presentation,
  Search,
  Video,
  StopCircle,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  User,
  Bot,
  X,
  Clock,
  Cpu,
  ArrowUp,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Message, Model, MessageAttachment, ToolDetail } from '../types'
import AppLogo from './AppLogo'
import { buildMemoryBlock, autoSummarizeMemory } from '../services/memory'
import { parseThinkingUnits, type ThinkingUnit } from '../services/codeFold'
import { buildPersonaBlock } from '../services/persona'
import { v4 as uuidv4 } from 'uuid'
import AddModelDialog from './AddModelDialog'
import { MediaPreview, ImageThumb, VideoThumb, PreviewableAttachment } from './MediaPreview'

// 从内容中解析思考过程
// tokens 显示格式化：≥1万 用「x.x万」（2026-09-22 用户要求：16827 → 1.7万 tokens）
function formatTokens(n: number): string {
  if (n >= 10000) {
    const s = (n / 10000).toFixed(1).replace(/\.0$/, '')
    return `${s}万`
  }
  return String(n)
}

// 消息完成时间（HH:mm）：2026-09-22 用户指定完成后只显示复制/模型/时间
function formatMsgTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function parseThinkingContent(content: string): { thinking: string; mainContent: string } {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/)
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim()
    const mainContent = content.replace(/<think>[\s\S]*?<\/think>/, '').trim()
    return { thinking, mainContent }
  }
  // 未闭合的 <think>（流式生成中）
  const openMatch = content.match(/<think>([\s\S]*)$/)
  if (openMatch) {
    return { thinking: openMatch[1].trim(), mainContent: '' }
  }
  return { thinking: '', mainContent: content }
}

/**
 * 能力误报清洗（兜底，正常路径不应命中）。
 *
 * deepwork 的对话页已挂载真实工具链（Read / Write / Edit / Bash …），文件会**真的写到磁盘**。
 * 若模型仍然自称「没有写入权限」「无法访问您的电脑」，那是错误表述，会把用户误导为软件坏了。
 * 这里在落盘前把这种纯否认式回复替换为准确说明（仅在整条回复都很短、无实质内容时替换）。
 */
function stripCapabilityDenial(content: string): string {
  if (!content) return content
  // 命中标志：否认文件/电脑访问能力 + 道歉
  const denial =
    /(?:没有|不(?:具?备|拥有))[^。\n]{0,12}(?:写入权限|文件权限|读写权限|权限|能力)|我(?:无法|不能)(?:直接)?[^。\n]{0,16}(?:您的|你的)(?:电脑|计算机|系统)|我(?:无法|不能)(?:直接)?(?:创建|写入|修改|删除|执行)[^。\n]{0,10}文件|作为(?:一个)?(?:AI|人工智能|语言模型)[^。\n]{0,20}我(?:无法|不能|没有)/
  if (!denial.test(content)) return content
  // 长回复说明有实质内容（可能只是顺带一句措辞不当），不整体替换
  const plain = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (plain.length > 260) return content

  return [
    '我这边刚才没能把文件写出来，已经停下了。',
    '',
    '请再发一次具体要求（例如「在 work 目录建一个 index.html，内容是…」），',
    '我会直接调用写入工具把文件真正落到磁盘上。',
  ].join('\n')
}

/**
 * 对话输出的代码清洗：用户明确要求「对话里不要出现代码」（2026-09-22 再次重申并给出期望样式）。
 *
 * 关键：不是「折叠」而是**彻底不要**。代码块一律在原位置替换为一行「📄 代码草稿（未写入文件）」。
 * 行内 `code`（如 `useMemo`）保留——那不是代码块，不影响观感。
 */
const CODE_NOTE = '📄 代码草稿（未写入文件）'

function dropCodeBlocks(content: string, writtenFiles: string[] = []): string {
  if (!content) return content
  // 围栏代码块和裸 HTML 文档都要处理——只查 ``` 会漏掉不带围栏的 HTML（曾有测试抓到这个漏洞）
  const hasFence = content.includes('```')
  const hasHtmlDoc = /<!DOCTYPE[^>]*>|<html[\s>]/i.test(content)
  // 裸代码墙（2026-09-23 用户截图实证：模型贴「255. function draw() {...」行号式代码，无围栏）
  const hasNumberedCode = /(?:^[ \t]*\d{1,4}[.、)][ \t]+[^\n]*\n){3,}/m.test(content)
  if (!hasFence && !hasHtmlDoc && !hasNumberedCode) return content
  void writtenFiles // 文件名信息由工具回显的 system 消息提供，这里统一用「📄 代码草稿（未写入文件）」

  // 整块删除围栏代码块，替换为一行提示
  let out = content.replace(/```[^\n]*\n[\s\S]*?```/g, CODE_NOTE).replace(/```[^\n]*\n[\s\S]*$/, CODE_NOTE)
  // 模型不听话时可能输出不带围栏的裸 HTML 文档，同样整段删除。
  // 必须是「完整文档」（有闭合 </html>）或「整行开头开始直到结尾」才删，
  // 避免误伤普通句子里对 <html> 标签的提及。
  out = out
    .replace(/<!DOCTYPE[^>]*>[\s\S]*?<\/html\s*>/gi, CODE_NOTE)
    .replace(/<html[^>]*>[\s\S]*?<\/html\s*>/gi, CODE_NOTE)
    .replace(/(^|\n)\s*<!DOCTYPE[^>]*>[\s\S]*$/i, CODE_NOTE)
    .replace(/(^|\n)\s*<html[^>]*>[\s\S]*$/i, CODE_NOTE)
  // 行号式裸代码墙：连续 ≥4 行「数字. 内容」且含代码符号（{ } ; = ( )）→ 整段替换。
  // 普通编号步骤列表（「1. 打开设置」）不含代码符号，不会误伤。
  out = out.replace(/(?:^[ \t]*\d{1,4}[.、)][ \t]+[^\n]*\n?){4,}/gm, (m) =>
    /[{};=]|=>|\(/.test(m) ? CODE_NOTE : m)
  // 清掉替换后可能出现的重复提示与多余空行
  out = out.replace(new RegExp(`(?:${escapeRegExp(CODE_NOTE)}\\s*){2,}`, 'g'), CODE_NOTE)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 思考区（ThinkingBlock 显示层）：2026-09-24 起改为单元化渲染——
 * parseThinkingUnits 把思考内容解析成 text / code 单元，code 单元（代码草稿）
 * 渲染为可展开的 CodeDraftBlock：默认折叠成一行「📄 代码草稿（未写入文件）」，
 * 点击展开看草稿原文（用户要求「代码草稿也可以展开看看草稿内容是什么」）。
 * 折叠边界与 codeFold.sanitizeThinkingDisplay 同一套规则，只是不再丢内容；
 * 落盘仍保留思考原文（polishMessageContent 已保证）。
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 落盘前统一清洗：先处理能力误报，再去掉代码块 */
function polishAssistantText(content: string, writtenFiles: string[] = []): string {
  return dropCodeBlocks(stripCapabilityDenial(content), writtenFiles)
}

/**
 * 带思考区保护的清洗：`<think>`…`</think>` 思考区里的代码草稿**原样保留**
 * （那正是用户要看的完整推理过程），dropCodeBlocks / 能力误报替换只作用于正文。
 * 曾有真实案例：思考区 5.2 万字符里 22 个代码草稿块被整体删光，只剩零星残句——用户看到的
 * 思考过程「只有一行、显示不全」。未闭合的 <think>（流式中途被停）也会补上闭合标签。
 */
function polishMessageContent(content: string, writtenFiles: string[] = []): string {
  if (!content) return content
  const start = content.indexOf('<think>')
  if (start === -1) return polishAssistantText(content, writtenFiles)
  const head = content.slice(0, start)                       // 思考区前的正文（罕见但兼容）
  const end = content.indexOf('</think>', start)
  const think = end !== -1 ? content.slice(start, end + 8) : content.slice(start) + '</think>'
  const tail = end !== -1 ? content.slice(end + 8) : ''      // 思考区后的正文
  return polishAssistantText(head, writtenFiles) + think + polishAssistantText(tail, writtenFiles)
}

// 已发送消息里的图片/视频缩略图：点击打开全屏预览；文件已移动/删除时回退为文件名标签
const MessageMedia: React.FC<{ att: MessageAttachment; onOpen: () => void }> = ({ att, onOpen }) => {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white/15 rounded-lg text-xs"
        title={att.path}
      >
        <FileIcon size={13} />
        <span className="max-w-[160px] truncate">{att.name}</span>
      </span>
    )
  }
  return (
    <div
      className="rounded-xl overflow-hidden border border-white/25 cursor-pointer hover:opacity-90 transition-opacity"
      onClick={onOpen}
      title="点击预览"
    >
      {att.icon === 'image' ? (
        <ImageThumb
          path={att.path}
          alt={att.name}
          className="max-w-[220px] max-h-[220px] w-auto h-auto object-cover block"
          onFail={() => setBroken(true)}
        />
      ) : (
        <VideoThumb path={att.path} className="w-[220px] h-[124px]" onFail={() => setBroken(true)} />
      )}
    </div>
  )
}

// 思考区里的代码草稿块：默认折叠成一行「📄 代码草稿（未写入文件）」，点击展开看草稿原文
// （2026-09-24 用户要求「代码草稿也可以展开看看草稿内容是什么」——占位不再吞掉内容）
const CodeDraftBlock: React.FC<{ code: string }> = ({ code }) => {
  const [open, setOpen] = useState(false)
  // 展示时剥掉围栏标注行（```js / ```）与块前空行；裸代码、HTML 文档原样展示
  const shown = useMemo(() => {
    let s = code.replace(/^[ \t]*\n/, '')
    s = s.replace(/^```[^\n]*\n?/, '')
    s = s.replace(/\n?```[ \t]*$/, '')
    return s
  }, [code])
  const lineCount = useMemo(() => shown.split('\n').length, [shown])
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span>{CODE_NOTE}</span>
        <span className="text-gray-400">· {lineCount} 行</span>
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-600 whitespace-pre-wrap break-words">
          {shown}
        </pre>
      )}
    </div>
  )
}

// 思考过程组件
// 2026-09-23 用户视频结构：工具行（已读取/编辑/运行命令…）**嵌在深度思考区内**，
// 与思考内容按时间顺序交错混排（思考段 → 触发它的工具行 → 下一段思考），
// 不是消息底部的独立行。tools 为该 assistant 消息之后紧随的 system 工具行。
// 2026-09-24：显示层单元化——parseThinkingUnits 解析 text/code 单元，
// code 单元渲染为可展开的 CodeDraftBlock（默认仍只显示占位行，点击展开看草稿原文）。
const ThinkingBlock: React.FC<{ content: string; isGenerating: boolean; tools?: Message[] }> = ({ content, isGenerating, tools = [] }) => {
  const [expanded, setExpanded] = useState(isGenerating)
  const { t } = useTranslation()
  // 思考内容 → 文本/代码草稿单元（折叠边界与 sanitizeThinkingDisplay 同一套规则，只是不再丢内容）
  const units = useMemo(() => parseThinkingUnits(content), [content])

  useEffect(() => {
    if (!isGenerating && expanded) {
      // 思考完成后自动折叠
      setExpanded(false)
    }
  }, [isGenerating])

  // 思考分段：文本按空行切段（工具调用前 onStatus 会插入空行封段——段边界正好对应工具行位置），
  // 代码草稿单元挂在当前段内（前后贴着思考文字时与文字同段，独占空行时自成一段）
  const segments = useMemo(() => {
    const gs: Array<Array<ThinkingUnit>> = [[]]
    for (const u of units) {
      if (u.kind === 'text') {
        u.text.split(/\n{2,}/).forEach((part, i) => {
          if (i > 0) gs.push([])
          const trimmed = part.trim()
          if (trimmed) gs[gs.length - 1].push({ kind: 'text', text: trimmed })
        })
      } else {
        gs[gs.length - 1].push(u)
      }
    }
    return gs.filter(g => g.length > 0)
  }, [units])

  if (!content) return null

  return (
    // 2026-09-23 严格按照用户视频：无边框「深度思考 ›」纯文字标签 + 内容平铺（不套彩色卡片）
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isGenerating ? 'bg-gray-400 animate-pulse' : 'bg-gray-300'}`} />
        <span>深度思考</span>
        {isGenerating && <span className="animate-pulse">…</span>}
        <ChevronRight
          size={12}
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-1">
          {segments.map((seg, si) => (
            <div key={si}>
              {seg.map((u, ui) =>
                u.kind === 'text'
                  ? u.text.split('\n').map((line, i) => (
                      <p key={`${ui}-${i}`} className="text-sm text-gray-700 leading-relaxed mb-1">{line || '\u00A0'}</p>
                    ))
                  : <CodeDraftBlock key={ui} code={u.code} />
              )}
              {/* 工具行紧跟触发它的思考段（视频结构：工具行在深度思考区内） */}
              {tools[si] && <ToolActionLine content={tools[si].content || ''} detail={tools[si].toolDetail} />}
            </div>
          ))}
          {/* 工具行多于思考段时（如最后一次工具调用后思考未再续）全部追加在末尾 */}
          {tools.slice(segments.length).map(tool => (
            <ToolActionLine key={tool.id} content={tool.content || ''} detail={tool.toolDetail} />
          ))}
        </div>
      )}
    </div>
  )
}

// 对话页权限档位（输入框左下下拉，2026-09-22 用户指定 2 种）：
// default=按安全中心执行；full=完全访问（绕过安全中心文件/命令/域名策略与删除保护，命令执行强制开启）
const PERM_OPTIONS: Array<{ value: 'default' | 'full'; label: string; desc: string }> = [
  { value: 'default', label: '默认权限', desc: '按安全中心策略执行（黑名单、确认弹窗、删除保护均生效）' },
  { value: 'full', label: '完全访问', desc: '绕过安全中心与删除保护，命令直接执行（谨慎使用）' },
]

/**
 * 对话页（工具模式）的任务前缀。工具协议与工作流由 agentEngine 的 TOOLS_PROMPT 统一提供，
 * 这里只补充「这是对话页」这一层上下文，避免模型把用户当成任务描述来复述。
 */
const CHAT_AGENT_PREFIX = [
  '你是 deepwork 的对话助手，运行在用户本机上，并且**拥有真实的文件读写与命令执行工具**。',
  '用户就在对话界面里跟你说话——文件请求要直接动手做，不要建议他「切到任务视图」，也不要声称自己没有权限。',
  '',
  '默认工作目录已经给出（见 <环境> 块）。用户没有指定路径时，文件就建在这个目录下；',
  '用户给了相对路径（如 "a/b.txt"）就按相对工作目录处理。',
  '',
  '行为准则：',
  '- 要建/改文件 → 直接调用写入工具，不要先把完整内容贴到对话里。',
  '- **对话里永远不要出现代码。** 不要贴代码块、不要贴整个文件、不要贴 diff。',
  '  用户要的是结果不是代码——文件已经写到磁盘了，用一句话说明做了什么、文件在哪就够。',
  '- 任务完成后用一句话说明做了什么、文件落在哪；不要在回复里重复文件内容。',
  '- 纯聊天/咨询类问题不必调用工具，直接回答即可。',
].join('\n')

/** 纯聊天模式（工具关闭）的默认系统提示词 */
const DEFAULT_CHAT_PROMPT = [
  '你是 deepwork，一个运行在用户电脑上的 AI 助手。',
  '',
  '# 沟通',
  '- 用用户提问时所用的语言回答。',
  '- 陈述事实：说明你确定什么、不确定什么。不要客套话，不要给未经证实的结论。',
  '- **回复保持简洁，不要贴大段代码。** 用户明确要代码时才给，且只给关键片段（几行即可），',
  '  不要整文件、整函数地粘贴。说明思路和结论比贴代码更有用。',
  '- 用 Markdown 组织结构；确有必要的小段代码用行内 `code` 或极短代码块标注语言。',
  '- 用户真正读的是你的回答本身，所以它必须能独立看懂，不要依赖上文才能理解。',
].join('\n')

/** 把工具调用翻译成一句人类可读的状态提示（作为 system 消息插进对话） */
function describeToolUse(tool: string, args: Record<string, any>): { title: string; file: string } {
  tool = normalizeToolName(tool)
  const p = String(args?.file_path ?? args?.path ?? args?.pattern ?? args?.command ?? '')
  const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
  const short = name.length > 40 ? name.slice(0, 37) + '…' : name
  switch (tool) {
    case 'write_file': return { title: `正在写入文件 ${short}`, file: p }
    case 'append_file': return { title: `正在追加内容到 ${short}`, file: p }
    case 'edit_file': return { title: `正在修改文件 ${short}`, file: p }
    case 'read_file': return { title: `正在读取文件 ${short}`, file: '' }
    case 'list_files': return { title: `正在浏览目录 ${short || '.'}`, file: '' }
    case 'find_files': return { title: `正在查找文件 ${short}`, file: '' }
    case 'search_files': return { title: `正在搜索内容 ${short}`, file: '' }
    case 'run_command': return { title: `正在执行命令`, file: '' }
    case 'web_search': return { title: `正在联网搜索`, file: '' }
    case 'web_fetch': return { title: `正在抓取网页 ${short}`, file: '' }
    default: return { title: `正在处理${short ? ' ' + short : ''}`, file: '' }
  }
}

/**
 * 引擎侧工具名是 ZCode 风格别名（Write / Edit / Bash…），统一归一成规范名。
 * 2026-09-23 用户截图反馈「已处理 围棋.html」+🔧——describeToolDone/buildToolDetail
 * 此前没做归一，别名直接落 default 分支（文案错、图标错、详情面板类型错）。
 */
const TOOL_ALIAS: Record<string, string> = {
  write: 'write_file', read: 'read_file', edit: 'edit_file', bash: 'run_command',
  glob: 'find_files', grep: 'search_files', webfetch: 'web_fetch',
  websearch: 'web_search', ls: 'list_files', list: 'list_files',
}
export function normalizeToolName(tool: string): string {
  const t = String(tool || '').trim()
  return TOOL_ALIAS[t.toLowerCase()] || t.toLowerCase()
}

/**
 * 把引擎层的状态消息（如「🔧 模型名 正在调用 Write...」）翻译成对话页风格的一句话提示。
 * 对话页不出现英文工具名、不出现 emoji——用户只关心「正在干什么」。
 */
export function translateStatus(status: string): string {
  if (!status) return status
  const m = status.match(/正在调用\s+(\w+)/)
  if (m) {
    const t = normalizeToolName(m[1])
    const mapped = describeToolUse(t, {})
    return mapped.title.replace(/ $/, '') + '…'
  }
  return status
}

/** 相对路径 → 完整路径（行上直接显示「改的是哪个文件」，用户不必点开才知道，2026-09-23） */
function joinWorkPath(workDir: string, p: string): string {
  const rel = String(p || '').trim()
  if (!rel || !workDir) return rel
  if (/^[A-Za-z]:[\\/]|^\\\\|^\//.test(rel)) return rel
  const sep = workDir.includes('\\') ? '\\' : '/'
  return workDir.replace(/[\\/]+$/, '') + sep + rel.replace(/^[\\/]+/, '')
}

/**
 * 工具调用的完成文案（2026-09-23 对齐 WorkBuddy 视频）：
 * 无冒号、空格分隔——「编辑 <完整路径>」「读取 <路径>」「搜索 <路径> <关键词>」，
 * 路径完整显示（行超宽时截断、悬停可见全文）。
 */
function describeToolDone(tool: string, args: Record<string, any>, workDir = ''): string {
  tool = normalizeToolName(tool)
  const p = joinWorkPath(workDir, String(args?.file_path ?? args?.path ?? '').trim())
  switch (tool) {
    case 'write_file': return `写入 ${p}`
    case 'append_file': return `追加 ${p}`
    case 'edit_file': return `编辑 ${p}`
    case 'read_file': return `读取 ${p}`
    case 'list_files': return `浏览目录 ${p}`.trim()
    case 'find_files': return `查找 ${p}`.trim()
    case 'search_files': return `搜索 ${p} ${String(args?.pattern ?? '')}`.trim()
    case 'run_command': return `运行命令`
    case 'web_search': return `搜索 ${String(args?.query ?? '').trim()}`.trim()
    case 'web_fetch': return `抓取网页 ${p}`
    default: return `处理${p ? ' ' + p : ''}`
  }
}

// system 消息内容约定（工具动作行，2026-09-22 轮 I）：
//   ⏳ 前缀 = 进行中（两行样式：图标+状态词 / 灰色说明）
//   ❌ 前缀 = 失败（红色行）
//   其余 = 完成式单行（灰色图标行）
function parseToolLine(content: string): { state: 'running' | 'failed' | 'done'; text: string } {
  const c = content || ''
  if (c.startsWith('⏳')) return { state: 'running', text: c.replace(/^⏳\s*/, '') }
  if (c.startsWith('❌')) return { state: 'failed', text: c.replace(/^❌\s*/, '') }
  return { state: 'done', text: c }
}

/** 截断面板文本：太长的详情只显示前段（防止大文件把会话 JSON 撑爆） */
function cutDetailText(s: string, max = 2000): string {
  const t = String(s || '')
  return t.length > max ? t.slice(0, max) + `\n(...已截断，共 ${t.length} 字符)` : t
}

/**
 * 行级 LCS diff（编辑展开面板用，2026-09-23 严格按照用户视频：红删绿增）。
 * 规模保护：old/new 行数乘积超阈值时退化为「全删+全增」，避免 O(m*n) 卡死渲染。
 */
function computeLineDiff(oldText: string, newText: string): Array<{ t: '+' | '-' | ' '; s: string }> {
  const a = String(oldText ?? '').split('\n')
  const b = String(newText ?? '').split('\n')
  if (a.length * b.length > 90000) {
    return [
      ...a.map(s => ({ t: '-' as const, s })),
      ...b.map(s => ({ t: '+' as const, s })),
    ]
  }
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Array<{ t: '+' | '-' | ' '; s: string }> = []
  let i = 0, j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: a[i] }); i++ }
    else { out.push({ t: '+', s: b[j] }); j++ }
  }
  while (i < m) out.push({ t: '-', s: a[i++] })
  while (j < n) out.push({ t: '+', s: b[j++] })
  return out
}

/**
 * 工具调用完成时构造可展开详情（ToolDetail）：
 * 编辑类 → 行级 diff + 增删统计；命令类 → 命令本体 + 输出；其余 → 结果文本。
 * 全部在渲染层从 args + result 构造，engine 无需改动。
 */
function buildToolDetail(tool: string, args: Record<string, any>, result: { ok: boolean; output?: string }): ToolDetail {
  tool = normalizeToolName(tool)
  const out = String(result.output || '')
  if (tool === 'edit_file') {
    const oldStr = String(args?.old_str ?? args?.old_string ?? '')
    const newStr = String(args?.new_str ?? args?.new_string ?? '')
    if (oldStr || newStr) {
      const diff = computeLineDiff(oldStr, newStr)
      return {
        kind: 'edit',
        stat: { added: diff.filter(d => d.t === '+').length, removed: diff.filter(d => d.t === '-').length },
        diff: diff.slice(0, 400),
      }
    }
    return { kind: 'text', text: cutDetailText(out) }
  }
  if (tool === 'write_file' || tool === 'append_file') {
    const content = String(args?.content ?? '')
    const lines = content ? content.split('\n') : []
    return {
      kind: 'edit',
      stat: { added: lines.length, removed: 0 },
      diff: lines.slice(0, 400).map(s => ({ t: '+' as const, s })),
    }
  }
  if (tool === 'run_command') {
    return { kind: 'command', text: String(args?.command ?? ''), output: cutDetailText(out, 3000) }
  }
  return { kind: 'text', text: cutDetailText(out) }
}

/** diff 行渲染：红删绿增（2026-09-23 严格按照用户视频样例） */
const DiffLine: React.FC<{ t: '+' | '-' | ' '; s: string }> = ({ t, s }) => (
  <div
    className={`px-2 py-px font-mono text-[11px] leading-5 whitespace-pre-wrap break-all ${
      t === '-' ? 'bg-red-50 text-red-600' : t === '+' ? 'bg-green-50 text-green-700' : 'text-gray-600'
    }`}
  >
    <span className="select-none opacity-60 mr-1">{t === ' ' ? ' ' : t}</span>
    {s || '\u00A0'}
  </div>
)

/** 工具详情展开面板：编辑=diff / 命令=命令本体+状态 / 其他=结果文本（浅绿底，视频样式） */
const ToolDetailPanel: React.FC<{ detail: ToolDetail }> = ({ detail }) => {
  if (detail.kind === 'edit' && detail.diff) {
    return (
      <div className="mt-1 ml-[22px] mr-1 max-h-64 overflow-y-auto bg-emerald-50/50 border border-emerald-100 rounded-lg py-1">
        {detail.diff.map((d, i) => <DiffLine key={i} t={d.t} s={d.s} />)}
        {(detail.diff?.length || 0) >= 400 && (
          <div className="px-2 py-1 text-[11px] text-gray-400">(diff 过长，已截断)</div>
        )}
      </div>
    )
  }
  if (detail.kind === 'command') {
    return (
      <div className="mt-1 ml-[22px] mr-1 bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
        <div className="text-[10px] text-gray-500 mb-1">bash</div>
        <pre className="font-mono text-xs text-gray-800 whitespace-pre-wrap break-all m-0">{detail.text || '(空命令)'}</pre>
        {detail.output && detail.output !== '(无输出)' && (
          <pre className="font-mono text-[11px] text-gray-500 whitespace-pre-wrap break-all mt-2 pt-2 border-t border-emerald-100 max-h-40 overflow-y-auto m-0">{detail.output}</pre>
        )}
      </div>
    )
  }
  return (
    <div className="mt-1 ml-[22px] mr-1 bg-emerald-50/40 border border-emerald-100 rounded-lg p-3 max-h-60 overflow-y-auto">
      <pre className="font-mono text-[11px] text-gray-700 whitespace-pre-wrap break-all m-0">{detail.text || '(无输出)'}</pre>
    </div>
  )
}

/**
 * 工具动作行（2026-09-23 12:11 用户视频严格对齐）：
 * 线性图标——成功=绿色 CheckCircle2 / 失败=红色 XCircle / 进行中=灰色 spinner，
 * 浅灰文字 + 单行超宽截断（悬停显示完整内容）；有详情可点击展开面板，编辑行带 +N -M。
 * （不再使用彩色 emoji 图标——12:11 视频里是线性圆圈图标）
 */
const ToolActionLine: React.FC<{ content: string; detail?: ToolDetail }> = ({ content, detail }) => {
  const { state, text } = parseToolLine(content)
  const [expanded, setExpanded] = useState(false)
  if (state === 'running') {
    return (
      <div className="flex items-center gap-2 py-1 w-full min-w-0">
        <Loader2 size={13} className="animate-spin text-gray-400 flex-shrink-0" />
        <span className="text-[13px] text-gray-500 truncate" title={text}>{text}</span>
      </div>
    )
  }
  // 完成/失败 + 有详情 → 可点击展开（视频规格：行尾 chevron，编辑行加 +N -M）
  const expandable = !!detail
  const LineIcon = state === 'failed' ? XCircle : CheckCircle2
  const iconCls = state === 'failed' ? 'text-red-500' : 'text-green-600'
  const textCls = state === 'failed' ? 'text-red-500' : 'text-gray-500'
  // 写入/编辑行：视频规格（f1992 帧）= 彩色铅笔 ✏️ 图标 + 动词灰字 + 路径**绿色**高亮
  const editMatch = text.match(/^((?:写入|编辑|追加|修改)\s+)(.+)$/)
  const rowIcon = editMatch
    ? <span className="text-[13px] leading-5 flex-shrink-0">✏️</span>
    : <LineIcon size={13} className={`${iconCls} flex-shrink-0`} />
  const rowText = editMatch
    ? (
      <span className="text-[13px] truncate flex-1 min-w-0" title={text}>
        <span className={textCls}>{editMatch[1]}</span>
        <span className={state === 'failed' ? 'text-red-500' : 'text-green-600'}>{editMatch[2]}</span>
      </span>
    )
    : <span className={`text-[13px] truncate flex-1 min-w-0 ${textCls}`} title={text}>{text}</span>
  if (!expandable) {
    // 无详情的纯行（旧历史消息）：同样按视频样式渲染；点击展开说明面板——
    // 用户点旧行没反馈会以为「没法展开」（2026-09-23 用户反馈），明确告知是历史数据限制
    return (
      <div className="w-full">
        <div
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 py-1 w-full min-w-0 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
          title={text}
        >
          {rowIcon}
          {rowText}
        </div>
        {expanded && (
          <div className="mt-1 ml-[22px] mr-1 bg-gray-50 border border-gray-100 rounded-lg p-3 text-[11px] text-gray-400 leading-relaxed">
            这是旧版本产生的历史记录，当时没有保存执行详情（改动 diff、命令输出），所以展开看不到更改内容。
            新版本执行的操作行（行尾有 › 箭头）点击即可查看完整详情。
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="w-full">
      <div
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 py-1 w-full min-w-0 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
      >
        {rowIcon}
        {rowText}
        {detail?.stat && (
          <span className="text-[11px] font-mono flex-shrink-0">
            <span className="text-green-600">+{detail.stat.added}</span>{' '}
            <span className="text-red-500">-{detail.stat.removed}</span>
          </span>
        )}
        <ChevronRight
          size={12}
          className={`flex-shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </div>
      {expanded && <ToolDetailPanel detail={detail} />}
    </div>
  )
}

const ChatArea: React.FC = () => {
  const { t } = useTranslation()
  const {
    models,
    currentModel,
    setCurrentModel,
    currentConversation,
    addMessage,
    updateMessage,
    isGenerating,
    setIsGenerating,
    setCurrentConversation,
    addConversation,
    config,
    setConfig,
    addTokenUsage,
    pendingTaskMessage,
  } = useAppStore()

  // 对话页权限档位（输入框左下下拉）：default=按安全中心；full=完全访问
  const chatPerm = config.chatPermission ?? 'default'

  const [input, setInput] = useState('')
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showAddModelDialog, setShowAddModelDialog] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  // 当前正在流式生成的 assistant 消息 id：元信息行/思考卡片用「id 精确匹配」区分生成中与已完成。
  // 不能用「是否最后一条消息」判断——生成中每插一条工具行，最后一条就变成 system 行，
  // assistant 消息失去「最后」身份 → 元信息行假显示「已完成」（2026-09-23 用户截图反馈）
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Array<{ path: string; name: string; size: number; kind: string; icon: 'image' | 'video' | 'text' | 'file'; content: string; dataUrl?: string }>>([])
  // 全屏媒体预览（图片查看 / 视频播放）：点击输入框附件或已发送消息里的媒体时打开
  const [previewItem, setPreviewItem] = useState<PreviewableAttachment | null>(null)
  // 生成等待秒数：让「生成中…」的时间可见——模型服务响应慢（曾出现 300s 零字节）时，
  // 用户能看出还在等待而非界面卡死
  const [genElapsed, setGenElapsed] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // 生成等待计时：isGenerating 期间每秒刷新 genElapsed
  useEffect(() => {
    if (!isGenerating) { setGenElapsed(0); return }
    const start = Date.now()
    const timer = setInterval(() => setGenElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [isGenerating])
  // 完全访问档位 → 主进程会话级策略旁路（内存态，不写配置）。
  // 卸载时关闭：切到任务视图时由 TaskWorkspace 再次显式关闭，双保险防泄漏。
  useEffect(() => {
    try { window.electronAPI?.agent.setPolicyBypass(config.chatPermission === 'full') } catch {}
    return () => { try { window.electronAPI?.agent.setPolicyBypass(false) } catch {} }
  }, [config.chatPermission])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  // 流式落盘定时器：异常/打断路径也要清掉，否则会每秒全量重写对话文件
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 无数据超时定时器：只靠 fetch 自身的话，网络挂起时请求永不 settle
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 停止原因：abort 后底层 fetch 可能抛内部包装错误（如「BodyStreamBuffer was aborted」），
  // 丢失我们设置的原因——触发 abort 前先在这里记下人类可读的原因，catch 里优先使用
  const stallReasonRef = useRef('')
  // Agent 工具执行中（如 run_command/pyinstaller 可能跑几分钟）： stall 检测应暂停，
  // 因为工具执行期间模型不流式输出数据，否则会误把正常的长工具运行掐断。
  const toolInProgressRef = useRef(false)
  // 工具模式下：本轮的思考过程 + 已落盘的文件（用于最终消息的折叠提示）
  const fullThinkingRef = useRef('')
  const writtenFilesRef = useRef<string[]>([])
  // 对话页工作目录（首次取到后缓存，避免每次发送都走 IPC）
  const workDirRef = useRef<string>('')
  // 下拉菜单容器（点击外部自动关闭）
  const permMenuRef = useRef<HTMLDivElement>(null)
  const modelSelectorRef = useRef<HTMLDivElement>(null)

  // 附件类型推断：图标 + 类型标签（图片/视频/文本/其他）
  const TEXT_EXTS = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'csv', 'log', 'yml', 'yaml', 'xml', 'sh', 'bat', 'sql', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'ini', 'toml']
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']
  const VIDEO_EXTS = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'flv', 'wmv', 'm4v']

  const fileKindOf = (name: string): { kind: string; icon: 'image' | 'video' | 'text' | 'file'; ext: string } => {
    const ext = (name.split('.').pop() || '').toLowerCase()
    if (IMAGE_EXTS.includes(ext)) return { kind: ext.toUpperCase(), icon: 'image', ext }
    if (VIDEO_EXTS.includes(ext)) return { kind: ext.toUpperCase(), icon: 'video', ext }
    if (TEXT_EXTS.includes(ext)) return { kind: ext.toUpperCase(), icon: 'text', ext }
    return { kind: ext ? ext.toUpperCase() : '文件', icon: 'file', ext }
  }

  const fmtSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  // 把图片（File 或 data URL）缩放后转成 data URL，控制发给模型的图片体积
  // PNG 保留透明通道（转成 JPEG 会把透明变黑色），其余转 JPEG 压缩；过小/不支持的格式直接回退原图
  const downscaleImage = async (source: string | File, maxDim = 1600, quality = 0.9): Promise<string> => {
    try {
      let src: string
      let mime = 'image/png'
      if (typeof source !== 'string') {
        src = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = () => reject(r.error)
          r.readAsDataURL(source)
        })
        mime = source.type || 'image/png'
      } else {
        src = source
        const m = src.match(/^data:([^;]+)/)
        if (m) mime = m[1]
      }
      // gif/svg/ico/bmp 等 canvas 处理差，直接回退原图
      if (!/^image\/(png|jpeg|webp)$/.test(mime)) return src
      const img = new Image()
      img.src = src
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image decode failed'))
      })
      const w0 = img.naturalWidth || img.width
      const h0 = img.naturalHeight || img.height
      if (!w0 || !h0) return src
      // 已足够小则不重编码，避免无谓损失
      if (w0 <= maxDim && h0 <= maxDim) return src
      const scale = Math.min(1, maxDim / Math.max(w0, h0))
      const w = Math.max(1, Math.round(w0 * scale))
      const h = Math.max(1, Math.round(h0 * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return src
      ctx.drawImage(img, 0, 0, w, h)
      const outFormat = mime === 'image/png' ? 'image/png' : 'image/jpeg'
      const out = canvas.toDataURL(outFormat, quality)
      return out || src
    } catch {
      return typeof source === 'string' ? source : ''
    }
  }

  const addAttachmentByPath = async (p: string, size = 0, nameOverride?: string, dataUrl?: string) => {
    const name = nameOverride || p.split('\\').pop() || p.split('/').pop() || p
    const { kind, icon, ext } = fileKindOf(name)
    let content = ''
    let imgDataUrl = dataUrl
    if (icon === 'text') {
      try {
        const r = await window.electronAPI?.dialog.readFileContent(p)
        if (r?.ok && r.content !== undefined) content = r.content
      } catch { /* 读取失败则仅引用路径 */ }
    } else if (icon === 'image' && !imgDataUrl) {
      // 图片：从磁盘读成 base64（受安全中心 + 大小限制），供多模态 image_url 发送；失败则仅引用路径
      try {
        const r = await window.electronAPI?.dialog.readImageAsBase64(p)
        if (r?.ok && r.dataUrl) imgDataUrl = await downscaleImage(r.dataUrl)
      } catch { /* 失败仅引用路径 */ }
    }
    setAttachments(prev => [...prev, { path: p, name, size, kind, icon, content, dataUrl: imgDataUrl }])
  }

  // 添加文件
  const handleAddFiles = async () => {
    try {
      const paths = await window.electronAPI?.dialog.selectFiles()
      if (!paths || paths.length === 0) return
      for (const p of paths) {
        await addAttachmentByPath(p)
      }
    } catch (e: any) {
      console.error('添加附件失败:', e)
      window.alert(`添加附件失败：${e?.message || e}`)
    }
  }

  // 粘贴文件（图片/视频/文档）：转成附件卡片；纯文本走默认粘贴行为
  const handlePasteFiles = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || [])
    const files = items
      .filter(i => i.kind === 'file')
      .map(i => i.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length === 0) return
    e.preventDefault()
    for (const f of files) {
      let p = ''
      let dataUrl = ''
      try { p = window.electronAPI?.dialog.getPathForFile(f) || '' } catch { p = '' }
      // 无磁盘路径（如截图直接粘贴）：图片先缩放转 data URL，再落盘为临时文件作为引用
      if (!p && f.type.startsWith('image/')) {
        try {
          let full = await downscaleImage(f)
          if (!full) {
            // 缩放失败退回原始 data URL
            full = await new Promise<string>((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(r.result as string)
              r.onerror = () => reject(r.error)
              r.readAsDataURL(f)
            })
          }
          if (full) {
            const base64 = full.split(',')[1] || ''
            const saved = await window.electronAPI?.dialog.savePasteFile(f.name || 'image.png', base64)
            if (saved?.ok && saved.path) { p = saved.path; dataUrl = full }
          }
        } catch { /* 落盘失败走下方提示 */ }
      }
      if (!p) {
        window.alert(`「${f.name}」暂不支持作为附件粘贴（请从文件管理器复制后再试）`)
        continue
      }
      // 磁盘图片由 addAttachmentByPath 自行读盘转 base64；这里只在已有 dataUrl 时透传
      await addAttachmentByPath(p, f.size, f.name || undefined, dataUrl)
    }
  }

  const categories = [
    { icon: FileText, label: t('categories.document'), color: 'text-blue-500' },
    { icon: BarChart3, label: t('categories.finance'), color: 'text-green-500' },
    { icon: BarChart3, label: t('categories.data'), color: 'text-purple-500' },
    { icon: Layout, label: t('categories.workspace'), color: 'text-orange-500' },
    { icon: Presentation, label: t('categories.slides'), color: 'text-pink-500' },
    { icon: Search, label: t('categories.research'), color: 'text-cyan-500' },
    { icon: Video, label: t('categories.video'), color: 'text-red-500' },
  ]

  useEffect(() => {
    if ((config.agentAutoScroll ?? true) === false) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentConversation?.messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`
    }
  }, [input])

  // 点击空白处关闭「默认权限 / 选择模型」下拉
  useEffect(() => {
    if (!showPermMenu && !showModelSelector) return
    const onDown = (e: MouseEvent) => {
      if (showPermMenu && permMenuRef.current && !permMenuRef.current.contains(e.target as Node)) {
        setShowPermMenu(false)
      }
      if (showModelSelector && modelSelectorRef.current && !modelSelectorRef.current.contains(e.target as Node)) {
        setShowModelSelector(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPermMenu, showModelSelector])

  // 卸载清理：只停定时器，不中断请求（切到别的页面时让生成在后台继续跑完）
  useEffect(() => () => {
    if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null }
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null }
  }, [])

  // 无数据超时：N 秒内一个字节都没收到就判定为卡死并中止，
  // 否则 fetch 永不 settle → isGenerating 永远 true → 输入框被永久禁用且无任何提示
  const armStallTimer = (controller: AbortController, seconds: number) => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current)
    stallTimerRef.current = setTimeout(() => {
      // 先记下人类可读的原因：abort 后底层抛的错误消息（BodyStreamBuffer was aborted）对用户没有意义
      stallReasonRef.current = `${seconds} 秒内没有收到任何数据，已自动停止`
      controller.abort(new Error(stallReasonRef.current))
    }, seconds * 1000)
  }

  // 对话页工作目录：任务会话优先用任务的工作目录；否则优先用户配置的 chatWorkDir，未配置时向主进程要系统「文档」目录
  const resolveChatWorkDir = async (): Promise<string> => {
    // 会话挂在任务下（conversation.taskId）→ 以任务 folderPath 为根，任务内所有对话共享同一工作目录
    const taskId = currentConversation?.taskId
    if (taskId) {
      const task = useAppStore.getState().tasks.find(t => t.id === taskId)
      if (task?.folderPath) return task.folderPath
    }
    const configured = (config.chatWorkDir || '').trim()
    if (configured) return configured
    if (workDirRef.current) return workDirRef.current
    try {
      const p = await window.electronAPI?.app.getDefaultWorkDir()
      if (p) { workDirRef.current = p; return p }
    } catch { /* IPC 不可用时回退到当前目录 */ }
    return workDirRef.current || '.'
  }

  // 把思考过程包进 <think> 标签（与任务视图的展示方式一致，ThinkingBlock 会解析渲染）
  const withThinking = (main: string): string => {
    const t = fullThinkingRef.current.trim()
    return t ? `<think>${t}</think>\n${main}` : main
  }

  // 新建任务欢迎页带来的首条消息：任务已无独立界面，进入对话页后自动执行。
  // sendRef 持有最新 handleSend（effect 依赖里不放函数，避免闭包过期/重复触发）
  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null)
  useEffect(() => {
    // 无依赖数组：每次渲染后更新，保证 effect 里拿到的是最新 handleSend 实例
    sendRef.current = handleSend
  })
  const autoRanConvRef = useRef<string | null>(null)
  useEffect(() => {
    const pm = pendingTaskMessage
    if (!pm) return
    const conv = useAppStore.getState().currentConversation
    // 只对任务会话生效，且只在空会话首条时触发（有消息说明已发过，防重入）
    if (!conv || !conv.taskId || conv.messages.length > 0) return
    if (autoRanConvRef.current === conv.id) return
    autoRanConvRef.current = conv.id
    useAppStore.getState().setPendingTaskMessage(null)
    void sendRef.current?.(pm)
  }, [pendingTaskMessage, currentConversation?.id])

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isGenerating) return

    const model = currentModel || models[0]
    if (!model) return

    let conversation = currentConversation
    if (!conversation) {
      conversation = {
        id: uuidv4(),
        title: input.slice(0, 30) + (input.length > 30 ? '...' : ''),
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        modelId: model.id,
      }
      addConversation(conversation)
      setCurrentConversation(conversation)
    }

    // 附件内容拼进用户消息（展示/存储用，纯文本）
    let displayContent = input.trim()
    if (attachments.length > 0) {
      const attachDisplay = attachments.map(a => `[附件: ${a.name}]`).join(' ')
      displayContent = displayContent ? `${displayContent}\n${attachDisplay}` : attachDisplay
    }

    // 发送给模型的消息内容：图片走多模态 image_url，文本/其他走内联或路径
    const textPart = input.trim()
    const hasImage = attachments.some(a => a.icon === 'image' && a.dataUrl)
    let userApiContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
    if (hasImage) {
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
      if (textPart) parts.push({ type: 'text', text: textPart })
      for (const a of attachments) {
        if (a.icon === 'image' && a.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
        } else if (a.content) {
          parts.push({ type: 'text', text: `\n\n--- 文件: ${a.name} ---\n${a.content}` })
        } else {
          const sizePart = a.size ? ` ${fmtSize(a.size)}` : ''
          parts.push({ type: 'text', text: `\n\n--- 附件: ${a.name}（${a.kind}${sizePart}）---\n文件路径: ${a.path}` })
        }
      }
      userApiContent = parts
    } else {
      let apiContent = textPart
      if (attachments.length > 0) {
        const attachApi = attachments
          .map(a => {
            if (a.content) return `\n\n--- 文件: ${a.name} ---\n${a.content}`
            const sizePart = a.size ? ` ${fmtSize(a.size)}` : ''
            return `\n\n--- 附件: ${a.name}（${a.kind}${sizePart}）---\n文件路径: ${a.path}`
          })
          .join('')
        apiContent = apiContent + attachApi
      }
      userApiContent = apiContent
    }

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
      // 附件元数据随消息持久化，用于气泡内回显缩略图、点击预览（旧对话无此字段，渲染时兼容）
      attachments: attachments.length > 0
        ? attachments.map<MessageAttachment>(a => ({ path: a.path, name: a.name, kind: a.kind, size: a.size, icon: a.icon }))
        : undefined,
    }

    addMessage(conversation.id, userMessage)
    setInput('')
    setIsGenerating(true)

    const assistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelId: model.id,
    }
    addMessage(conversation.id, assistantMessage)
    setStreamingMsgId(assistantMessage.id)
    // 生成耗时起点：成功/失败路径结束时写入 message.duration（元信息行不再显示错误的 0s）
    const genStart = Date.now()
    // 已生成内容快照：中断（abort/异常）时保留已流式输出的部分（含思考过程），而不是整个覆盖掉
    let generatedSoFar = ''
    // 工具动作行（轮 I）：进行中 system 消息的固定 id——同一工具从「进行中」到「完成」
    // 原地更新同一行（WorkBuddy 视频样式），而不是每步追加一条新消息
    let runningToolMsgId: string | null = null

    const controller = new AbortController()
    abortControllerRef.current = controller
    // 深度思考模型在思考阶段可能长时间不吐流式增量（SSE 被代理缓冲时更明显），
    // 120s 太激进会把正常思考掐断——默认放宽到 300s，仍可在设置里调（30~900）
    const stallSeconds = Math.min(Math.max(Number((config as any).chatStallTimeout ?? 300), 30), 900)
    armStallTimer(controller, stallSeconds)

    try {
      const baseUrl = model.baseUrl || 'https://api.openai.com/v1'
      const apiKey = model.apiKey || ''

      // 自动记忆：根据模型上下文窗口自动决定携带多少历史消息
      // 预留 40% 空间给回复，其余按字符预算从最新往回装填（约3字符≈1 token）
      const CONTEXT_WINDOW = model.contextWindow || 32768
      const charBudget = Math.floor(CONTEXT_WINDOW * 0.6) * 3
      const historyMessages: typeof conversation.messages = []
      let usedChars = 0
      for (let i = conversation.messages.length - 1; i >= 0; i--) {
        const len = conversation.messages[i].content?.length || 0
        if (usedChars + len > charBudget && historyMessages.length >= 2) break
        usedChars += len
        historyMessages.unshift(conversation.messages[i])
      }

      let allMessages = [...historyMessages, { ...userMessage, content: userApiContent }].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      // 长期记忆：把与本次输入相关的历史记忆附在上下文前缀后面（功能关闭时为空串）
      const memoryBlock = buildMemoryBlock(textPart || displayContent || '')

      // 工具模式：对话页挂着和「任务」视图同一套工具链，文件会真正写到磁盘。
      // 用户此前多次遇到「AI 说无法创建文件」——根因就是这个页面原本只做单轮 chat，
      // 模型据此如实回答「我没有写入权限」。现在改为直连 runAgentLoop，能力与任务视图一致。
      const toolsOn = config.chatToolsEnabled !== false
      // 完全访问档位：命令执行强制开启（安全中心策略由主进程 policyBypass 旁路）
      const allowExec = chatPerm === 'full' || config.chatAllowExec === true || (config as any).systemTools === 'enabled'

      if (toolsOn) {
        const workDir = await resolveChatWorkDir()
        const { runAgentLoop } = await import('../services/agentEngine')

        // 本轮状态重置：思考过程与落盘文件都从空开始
        fullThinkingRef.current = ''
        let lastThinkFlush = 0
        const writtenFiles: string[] = writtenFilesRef.current = []

        // 用户已附带的文件：把路径写进上下文，模型可以直接读它们
        const attachedPaths = attachments
          .filter(a => a.path)
          .map(a => `- ${a.name} → ${a.path}`)
        const chatFileContext = attachedPaths.length > 0
          ? `\n\n用户附带文件的磁盘路径（需要时用 read_file 读取）：\n${attachedPaths.join('\n')}`
          : ''

        // 工具调用过程：以 system 消息（工具动作行）插进对话，让用户看到 AI 真的在动文件。
        // 轮 I：onStatus 先 upsert 一条「⏳ 进行中」行，onToolUse 完成时原地转成完成式——
        // 同一个工具调用始终占一行（WorkBuddy 视频样式），不再每步追加新消息。
        const upsertToolLine = async (id: string, content: string) => {
          const conv = useAppStore.getState().conversations.find(c => c.id === conversation!.id)
          const exists = conv?.messages.some(m => m.id === id)
          if (exists) updateMessage(conversation.id, id, content)
          else await addMessage(conversation.id, { id, role: 'system', content, timestamp: Date.now() })
        }

        const onToolUse = async (tool: string, args: Record<string, any>, result: { ok: boolean; output?: string; notice?: string }) => {
          // 工具执行完毕，恢复无数据超时检测；本轮仍在继续，模型接下来还会输出
          toolInProgressRef.current = false
          armStallTimer(controller, stallSeconds)
          const doneTitle = describeToolDone(tool, args, workDir)
          if (result.ok) writtenFiles.push(String(args?.file_path ?? args?.path ?? ''))
          const content = result.ok
            ? `${doneTitle}${result.notice ? ` · ${result.notice}` : ''}`
            : `❌ ${doneTitle} 失败：${(result.output || '').slice(0, 200)}`
          // 可展开详情（2026-09-23 严格按照用户视频）：编辑=diff+统计 / 命令=命令+输出 / 其他=结果文本
          const toolDetail = buildToolDetail(tool, args, result)
          if (runningToolMsgId) {
            const conv = useAppStore.getState().conversations.find(c => c.id === conversation!.id)
            const exists = conv?.messages.some(m => m.id === runningToolMsgId)
            if (exists) {
              await updateMessage(conversation.id, runningToolMsgId, content, { toolDetail })
              runningToolMsgId = null
              return
            }
          }
          await addMessage(conversation.id, {
            id: uuidv4(),
            role: 'system',
            content,
            timestamp: Date.now(),
            toolDetail,
          })
        }

        const onStatus = async (status: string, toolCall?: { tool: string; args: Record<string, any> }) => {
          // 结构化 toolCall：工具即将执行，暂停 stall 检测（长命令/联网可能被误掐断）
          if (toolCall) {
            toolInProgressRef.current = true
            if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null }
          } else {
            // 普通状态更新（如「正在调用模型」）说明 Agent 还活着，重置 stall 计时
            armStallTimer(controller, stallSeconds)
          }
          // 结构化 toolCall：upsert 固定 id 的「进行中」工具动作行（两行样式）
          if (toolCall) {
            // 工具动作打断思考流：先把当前思考段封段（空行分隔），下一段思考从新行开始，
            // ThinkingBlock 按空行分段渲染成多张卡片
            if (fullThinkingRef.current && !/\n\s*$/.test(fullThinkingRef.current)) {
              fullThinkingRef.current += '\n\n'
            }
            const label = describeToolUse(toolCall.tool, toolCall.args)
            if (!runningToolMsgId) runningToolMsgId = uuidv4()
            await upsertToolLine(runningToolMsgId, `⏳ ${label.title}`)
            return
          }
          // 兜底（无结构化信息的状态，如「正在调用模型」）：沿用旧逻辑写进 assistant 正文，
          // 保留已写入的思考区（<think>…</think>）——整体替换会把思考过程覆盖掉
          const cur = useAppStore.getState().conversations
            .find(c => c.id === conversation!.id)?.messages
            .find(m => m.id === assistantMessage.id)?.content || ''
          const think = cur.match(/<think>[\s\S]*?(?:<\/think>|$)/)?.[0] || ''
          updateMessage(conversation.id, assistantMessage.id, (think ? think + '\n' : '') + translateStatus(status))
        }

        const rawResult = await runAgentLoop(
          model,
          workDir,
          textPart || displayContent || '',
          `${CHAT_AGENT_PREFIX}${memoryBlock}${chatFileContext}`,
          allowExec,
          {
            onStatus,
            onToolUse,
            // engine 的 onThinking 传「增量分片」（与任务视图 collectThinking 同语义）：
            // 必须自己累积成全量——直接覆盖只会剩最后一个分片，这就是思考卡片
            // 只显示一两个字的根因（"now"/"do"/"(i" 全是最后一个 reasoning 分片）
            onThinking: (delta) => {
              if (!delta) return
              // 思考流持续产出，说明模型没有卡死：重置 stall 计时（工具执行期间 onThinking 不会触发）
              if (!toolInProgressRef.current) armStallTimer(controller, stallSeconds)
              fullThinkingRef.current += delta
              // 节流：每个分片都 updateMessage 会触发全量对话写盘，300ms 批量刷新
              const now = Date.now()
              if (now - lastThinkFlush < 300) return
              lastThinkFlush = now
              const full = fullThinkingRef.current
              const cur = useAppStore.getState().conversations
                .find(c => c.id === conversation!.id)?.messages
                .find(m => m.id === assistantMessage.id)?.content || ''
              const clean = cur.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '')
              updateMessage(conversation!.id, assistantMessage.id, `${clean}<think>${full}</think>`)
            },
          },
          historyMessages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
            .filter(m => m.content.trim()),
          controller.signal,
          {
            thinkingDepth: (config as any).chatThinkingDepth ?? 'high',
            persona: await (async () => {
              // 人格块 = 基础人格设置 + 任务所选 Agent 包的专属人格（新建任务时可选）
              let personaBlock = buildPersonaBlock(config)
              try {
                const boundTask = conversation.taskId
                  ? useAppStore.getState().tasks.find(t => t.id === conversation.taskId)
                  : null
                if (boundTask?.agentId) {
                  const ar = await window.electronAPI?.agents?.get?.(boundTask.agentId)
                  if (ar?.ok && ar.agent?.agentPrompt) {
                    personaBlock = personaBlock ? `${personaBlock}\n\n${ar.agent.agentPrompt}` : ar.agent.agentPrompt
                  }
                }
              } catch { /* Agent 人格获取失败不阻断对话 */ }
              return personaBlock
            })(),
          }
        )

        const finalText = polishAssistantText(rawResult, writtenFiles.filter(Boolean))
        updateMessage(conversation.id, assistantMessage.id, withThinking(finalText), { duration: Date.now() - genStart })
        // 任务会话完成：自动沉淀长期记忆（fire-and-forget，失败不影响对话结果）
        try {
          autoSummarizeMemory(
            model,
            conversation.title || '对话任务',
            textPart || displayContent || '',
            finalText,
            conversation.taskId || conversation.id,
            'success',
            controller.signal
          )
            .then(entry => { if (entry) useAppStore.getState().addMemory(entry) })
            .catch(() => { /* 静默：记忆失败不提示 */ })
        } catch { /* 忽略 */ }
        return
      }

      const systemPrompt = ((config as any).agentSystemPrompt as string | undefined)?.trim() || DEFAULT_CHAT_PROMPT
      allMessages = [{ role: 'system', content: `${systemPrompt}${memoryBlock}${buildPersonaBlock(config)}` }, ...allMessages]

      const useStreaming = (config as any).agentStreaming ?? true

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.name,
          messages: allMessages,
          stream: useStreaming,
          temperature: (config as any).agentTemperature ?? 0.7,
          // max_tokens 是「输出上限」而非上下文长度：直接用 contextWindow 会被多数服务商拒绝（400）
          // 与 agentEngine 保持一致，夹到 16384
          max_tokens: Math.min(model.contextWindow || 32768, 16384),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const contentType = response.headers.get('content-type') || ''

      if (useStreaming && contentType.includes('text/event-stream')) {
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()
        let fullContent = ''
        let buffer = ''
        let lastUsage: any = null

        let lastFlush = 0
        // 流式节流落盘：每个 chunk 都 updateMessage 会把整份对话重写一遍文件，
        // 长回复会产生上百次全量写盘（磁盘抖动）。界面每 300ms 更新一次，观感无损。
        const flush = (force = false) => {
          const now = Date.now()
          if (!force && now - lastFlush < 300) return
          lastFlush = now
          generatedSoFar = fullContent
          // 流式显示也清洗：生成过程中正文里的代码块就要被「📄 代码草稿（未写入文件）」取代，
          // 不能等流结束才处理（用户会在生成中看到整面代码墙）。
          // fullContent 本体保持原文（落盘/快照用），这里传清洗副本；未闭合 <think> 由
          // polishMessageContent 自动补闭合，ThinkingBlock 才能正常解析。
          updateMessage(conversation.id, assistantMessage.id, polishMessageContent(fullContent))
        }
        const flushTimer = setInterval(() => flush(), 1000)
        flushTimerRef.current = flushTimer

        if (reader) {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            // 收到数据就重新计时，长回复不会被中途掐断
            armStallTimer(controller, stallSeconds)

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue

              try {
                const json = JSON.parse(data)
                const delta = json.choices?.[0]?.delta?.content || ''
                const reasoningDelta = json.choices?.[0]?.delta?.reasoning_content || ''
                if (reasoningDelta) {
                  if (!fullContent.includes('<think>')) {
                    fullContent += '<think>'
                  }
                  fullContent += reasoningDelta
                }
                if (delta) {
                  if (fullContent.includes('<think>') && !fullContent.includes('</think>')) {
                    fullContent += '</think>'
                  }
                  fullContent += delta
                }
                // Capture usage from streaming chunks (some providers include it)
                if (json.usage) {
                  lastUsage = json.usage
                }
                flush()
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
        clearInterval(flushTimer)
        flushTimerRef.current = null
        generatedSoFar = fullContent
        // 结束时强制落盘：清洗只作用于正文，思考区（<think> 内）的代码草稿原样保留
        fullContent = polishMessageContent(fullContent)
        updateMessage(conversation.id, assistantMessage.id, fullContent, { duration: Date.now() - genStart })

        // Save token usage from streaming response
        if (lastUsage) {
          addTokenUsage({
            id: uuidv4(),
            modelId: model.id,
            modelName: model.name,
            timestamp: Date.now(),
            inputTokens: lastUsage.prompt_tokens || 0,
            outputTokens: lastUsage.completion_tokens || 0,
            totalTokens: lastUsage.total_tokens || 0,
          })
        }
      } else {
        // 非流式响应
        const json = await response.json()
        const content = json.choices?.[0]?.message?.content || ''
        updateMessage(conversation.id, assistantMessage.id, polishMessageContent(content), { duration: Date.now() - genStart })

        // Save token usage from non-streaming response
        if (json.usage) {
          addTokenUsage({
            id: uuidv4(),
            modelId: model.id,
            modelName: model.name,
            timestamp: Date.now(),
            inputTokens: json.usage.prompt_tokens || 0,
            outputTokens: json.usage.completion_tokens || 0,
            totalTokens: json.usage.total_tokens || 0,
          })
        }
      }
    } catch (error: any) {
      // abort(reason) 抛出的是自定义 Error，name 不一定是 AbortError，两种都要认
      const aborted = error?.name === 'AbortError' || controller.signal.aborted
      // 工具动作行收尾：中断/异常时还挂着「⏳ 进行中」的话，转成中断态（避免界面永远转圈）
      if (runningToolMsgId) {
        try {
          const conv = useAppStore.getState().conversations.find(c => c.id === conversation!.id)
          const pending = conv?.messages.find(m => m.id === runningToolMsgId)
          if (pending && (pending.content || '').startsWith('⏳')) {
            const text = pending.content.replace(/^⏳\s*/, '')
            updateMessage(conversation.id, runningToolMsgId, `${text}${aborted ? '（已停止）' : '（已中断）'}`)
          }
        } catch {}
        runningToolMsgId = null
      }
      if (aborted) {
        // 优先用我们自己在 abort 前记录的原因（底层 fetch 抛的「BodyStreamBuffer was aborted」
        // 是内部包装错误，对用户没有意义）
        const rawReason = stallReasonRef.current || (typeof error?.message === 'string' ? error.message : '')
        const reason = /BodyStreamBuffer/i.test(rawReason) ? '连接中断' : rawReason
        const tag = reason ? `(已停止：${reason})` : '(生成已停止)'
        // 保留已流式输出的部分内容（含思考过程）——不能把用户已经看到的思考整体覆盖掉；
        // 未闭合的 <think> 由 polishMessageContent 补闭合
        const base = generatedSoFar ? polishMessageContent(generatedSoFar) : ''
        updateMessage(conversation.id, assistantMessage.id, base ? `${base}\n\n${tag}` : tag)
      } else {
        console.error('API Error:', error)
        updateMessage(
          conversation.id,
          assistantMessage.id,
          `Error: ${error.message || 'Failed to get response from API'}`
        )
      }
    } finally {
      // 兜底清理：中止/异常时上面那行 clearInterval 不会执行到
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current)
        stallTimerRef.current = null
      }
      stallReasonRef.current = ''
      toolInProgressRef.current = false
      setIsGenerating(false)
      setStreamingMsgId(null)
      abortControllerRef.current = null
      setAttachments([])
      setInput('')
    }
  }

  const handleStop = () => {
    // 记录停止原因供 catch 使用（abort 后底层错误消息会变成无意义的内部包装）
    stallReasonRef.current = '已手动停止'
    abortControllerRef.current?.abort()
    setIsGenerating(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    const mode = (config as any).sendKey ?? 'enter'
    if (mode === 'ctrlEnter') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSend()
      }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }
  }

  const handleCopyMessage = (content: string, messageId: string) => {
    navigator.clipboard.writeText(content)
    setCopiedMessageId(messageId)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }

  const handleRegenerate = async () => {
    if (!currentConversation || currentConversation.messages.length === 0) return

    const lastUserMessage = [...currentConversation.messages]
      .reverse()
      .find((m) => m.role === 'user')

    if (lastUserMessage) {
      setInput(lastUserMessage.content)
    }
  }

  const messages = currentConversation?.messages || []
  // 该消息是否正在流式生成中（只有最后一条且全局在生成时才成立）。
  // 元信息行、思考卡片都以此区分「生成中」与「已完成」——此前元信息行硬编码「已完成」，
  // 导致模型还在思考时就显示"已完成 · 上一轮的 tokens · 0s"（用户截图反馈的假完成）。
  const isMsgGenerating = (id: string) => isGenerating && id === streamingMsgId

  // 渲染分组（2026-09-23 用户视频结构）：assistant 消息「吸收」其后紧随的连续 system 工具行，
  // 工具行随思考区一起渲染（嵌在深度思考区内），不再作为消息底部的独立行。
  // 前面没有 assistant 的孤儿工具行仍单独成组渲染。
  const messageGroups = useMemo(() => {
    const groups: Array<{ msg: Message; tools: Message[] }> = []
    for (const m of messages) {
      if (m.role === 'system' && groups.length > 0 && groups[groups.length - 1].msg.role === 'assistant') {
        groups[groups.length - 1].tools.push(m)
      } else {
        groups.push({ msg: m, tools: [] })
      }
    }
    return groups
  }, [messages])

  return (
    <>
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden app-content-root">
      {messages.length === 0 ? (
        /* Welcome Screen */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-8 animate-fade-in">
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <AppLogo size={64} />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {t('welcome.greeting')}
            </h1>
            <p className="text-lg text-gray-500 mb-1">{t('welcome.subtitle')}</p>
            <p className="text-sm text-gray-500 max-w-md mx-auto">{t('welcome.description')}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-3 mb-8 max-w-2xl animate-fade-in">
            {categories.map((cat, index) => (
              <button
                key={index}
                onClick={() => setInput(cat.label)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl hover:border-primary-300 hover:shadow-sm transition-all text-sm"
              >
                <cat.icon size={16} className={cat.color} />
                <span className="text-gray-700">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Message List */
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            {messageGroups.map(({ msg: message, tools }) => (
              <div
                key={message.id}
                className={`flex gap-3 animate-fade-in ${
                  message.role === 'user' ? 'justify-end mb-4' : 'justify-start'
                } ${message.role === 'system' ? '' : 'mb-4'}`}
                // 2026-09-23 严格按视频：连续工具动作行紧凑排列（无额外段距），普通消息保留段距
              >
                {(message.role === 'assistant' || message.role === 'system') && (
                  <div className="flex-shrink-0 mt-1 w-8">
                    {message.role === 'assistant' ? <AppLogo size={32} /> : null}
                  </div>
                )}
                <div className={`max-w-[85%] ${message.role === 'user' ? '' : 'w-full'}`}>
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-gray-800">deepwork</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl ${
                      message.role === 'user'
                        ? 'bg-primary-500 text-white px-4 py-2.5'
                        : ''
                    }`}
                  >
                    {message.role === 'system' ? (
                      /* 工具动作行（轮 I）：灰色小字图标行，进行中为两行样式——取代旧聊天气泡 */
                      <ToolActionLine content={message.content || ''} detail={message.toolDetail} />
                    ) : message.role === 'assistant' ? (
                      <div className="text-sm">
                        {(() => {
                          const { thinking, mainContent } = parseThinkingContent(message.content || '')
                          return (
                            <>
                              {thinking && (
                                <ThinkingBlock
                                  content={thinking}
                                  isGenerating={isMsgGenerating(message.id)}
                                  tools={tools}
                                />
                              )}
                              {!thinking && tools.length > 0 && (
                                /* 模型没输出 <think> 标签时无思考区可嵌：工具行降级为消息内独立行（不能丢） */
                                <div className="mb-1">
                                  {tools.map(t => (
                                    <ToolActionLine key={t.id} content={t.content || ''} detail={t.toolDetail} />
                                  ))}
                                </div>
                              )}
                              {mainContent && (
                                <div className="markdown-content text-gray-800 leading-relaxed">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      table: ({ children }) => (
                                        <div className="overflow-x-auto my-3 border border-gray-200 rounded-lg">
                                          <table className="w-full text-sm border-collapse">{children}</table>
                                        </div>
                                      ),
                                      thead: ({ children }) => (
                                        <thead className="bg-gray-50 border-b border-gray-200">{children}</thead>
                                      ),
                                      th: ({ children }) => (
                                        <th className="px-4 py-2.5 text-left font-medium text-gray-700">{children}</th>
                                      ),
                                      td: ({ children }) => (
                                        <td className="px-4 py-2.5 text-gray-600 border-b border-gray-100 last:border-b-0">{children}</td>
                                      ),
                                      h1: ({ children }) => (
                                        <h1 className="text-xl font-bold text-gray-800 mt-5 mb-3">{children}</h1>
                                      ),
                                      h2: ({ children }) => (
                                        <h2 className="text-lg font-bold text-gray-800 mt-4 mb-2">{children}</h2>
                                      ),
                                      h3: ({ children }) => (
                                        <h3 className="text-base font-semibold text-gray-800 mt-3 mb-2">{children}</h3>
                                      ),
                                      p: ({ children }) => (
                                        <p className="mb-2 text-gray-700 leading-relaxed">{children}</p>
                                      ),
                                      ul: ({ children }) => (
                                        <ul className="list-disc pl-5 mb-3 space-y-1 text-gray-700">{children}</ul>
                                      ),
                                      ol: ({ children }) => (
                                        <ol className="list-decimal pl-5 mb-3 space-y-1 text-gray-700">{children}</ol>
                                      ),
                                      li: ({ children }) => (
                                        <li className="leading-relaxed">{children}</li>
                                      ),
                                      code: ({ className, children }) => {
                                        const isInline = !className
                                        if (isInline) {
                                          return <code className="px-1.5 py-0.5 bg-gray-100 text-red-600 rounded text-xs font-mono">{children}</code>
                                        }
                                        return <code className={`${className} block`}>{children}</code>
                                      },
                                      pre: ({ children }) => (
                                        <div className="relative my-3 bg-gray-900 rounded-xl overflow-hidden">
                                          <div className="flex items-center justify-between px-4 py-2 bg-gray-800 text-xs text-gray-400">
                                            <span>code</span>
                                          </div>
                                          <pre className="p-4 overflow-x-auto text-sm text-gray-100 font-mono">{children}</pre>
                                        </div>
                                      ),
                                      blockquote: ({ children }) => (
                                        <blockquote className="pl-4 border-l-4 border-primary-300 text-gray-600 italic my-3">{children}</blockquote>
                                      ),
                                      a: ({ href, children }) => (
                                        <a href={href} className="text-primary-500 hover:text-primary-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
                                      ),
                                      hr: () => (
                                        <hr className="my-4 border-gray-200" />
                                      ),
                                      strong: ({ children }) => (
                                        <strong className="font-semibold text-gray-800">{children}</strong>
                                      ),
                                    }}
                                  >
                                    {mainContent}
                                  </ReactMarkdown>
                                </div>
                              )}
                              {!mainContent && !thinking && (
                                <div className="text-gray-500 italic">...</div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    ) : (
                      /* 用户消息：正文 + 附件（图片/视频内联缩略图，点击预览；其他类型仍以纯文本列出） */
                      <div className="flex flex-col gap-2">
                        {(() => {
                          const body = message.attachments?.length
                            ? (message.content || '').replace(/\n?\[附件: [^\]]+\]/g, '').trim()
                            : message.content
                          return body ? <p className="text-sm whitespace-pre-wrap">{body}</p> : null
                        })()}
                        {(() => {
                          const atts = message.attachments || []
                          if (atts.length === 0) return null
                          const media = atts.filter(a => a.icon === 'image' || a.icon === 'video')
                          const others = atts.filter(a => a.icon !== 'image' && a.icon !== 'video')
                          return (
                            <div className="flex flex-wrap gap-2">
                              {media.map((att, idx) => (
                                <MessageMedia
                                  key={`m-${idx}`}
                                  att={att}
                                  onOpen={() => setPreviewItem(att)}
                                />
                              ))}
                              {others.map((att, idx) => (
                                <span
                                  key={`f-${idx}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white/15 rounded-lg text-xs"
                                  title={att.path}
                                >
                                  <FileIcon size={13} />
                                  <span className="max-w-[160px] truncate">{att.name}</span>
                                </span>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                  {message.role === 'assistant' && isMsgGenerating(message.id) && (
                    <div className="flex items-center gap-1.5 mt-2 text-blue-600">
                      <Loader2 size={12} className="animate-spin" />
                      <span className="text-xs">生成回复中…{genElapsed > 0 ? ` ${genElapsed}s` : ''}</span>
                      {genElapsed >= 30 && (
                        <span className="text-xs text-gray-500">· 等待模型响应</span>
                      )}
                    </div>
                  )}
                  {message.role === 'assistant' && !isMsgGenerating(message.id) && (
                    <div className="flex items-center gap-1 mt-2 text-gray-500">
                      <Clock size={12} />
                      <span className="text-xs">已处理</span>
                      {(message as any).duration != null && (
                        <>
                          <span className="text-xs">{Math.round((message as any).duration / 1000)}s</span>
                          <span className="mx-1">·</span>
                        </>
                      )}
                      {(() => {
                        // tokens 记录写于生成完成时刻（> 消息创建时间戳），所以必须往「未来」方向找
                        // 本轮记录——旧逻辑用 <= 匹配到的永远是上一轮的 tokens
                        const records = useAppStore.getState().tokenUsage
                        let record = null
                        for (let i = records.length - 1; i >= 0; i--) {
                          const r = records[i]
                          if (r.modelId === message.modelId && r.timestamp >= message.timestamp) {
                            if (!record || r.timestamp < record.timestamp) record = r
                          }
                        }
                        if (record && record.totalTokens > 0) {
                          return (
                            <>
                              <span className="mx-1">·</span>
                              <span className="text-xs text-primary-500">{formatTokens(record.totalTokens)} tokens</span>
                            </>
                          )
                        }
                        return null
                      })()}
                    </div>
                  )}
                  {message.role === 'assistant' && message.content && !isMsgGenerating(message.id) && (
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        onClick={() => handleCopyMessage(message.content, message.id)}
                        className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
                        title={t('chat.copy')}
                      >
                        {copiedMessageId === message.id ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      {/* 执行模型 + 完成时间（2026-09-22 用户指定：完成后只保留复制/模型/时间） */}
                      <span className="flex items-center gap-1 text-xs text-gray-500 ml-1">
                        <Cpu size={12} />
                        {(() => {
                          const m = message.modelId ? models.find(x => x.id === message.modelId) : null
                          return m?.name || currentModel?.name || ''
                        })()}
                      </span>
                      <span className="text-xs text-gray-500">{formatMsgTime(message.timestamp)}</span>
                    </div>
                  )}
                </div>
                {message.role === 'user' && (
                  <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={16} className="text-white" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Input Area — 悬浮卡片：无分隔线，白卡 + 投影浮在页面背景上 */}
      <div className="px-4 pt-1 pb-5 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-3xl border border-gray-200 p-4 shadow-lg shadow-gray-400/25 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {attachments.map((att, i) => {
                  const hasThumb = att.icon === 'image' || att.icon === 'video'
                  const preview: PreviewableAttachment = {
                    path: att.path, name: att.name, kind: att.kind, size: att.size, icon: att.icon,
                  }
                  return (
                  <div
                    key={i}
                    className="group relative flex items-center gap-2.5 pl-2.5 pr-8 py-2 bg-gray-100 border border-gray-200 rounded-xl w-[210px]"
                    title={att.path}
                  >
                    {hasThumb ? (
                      /* 图片/视频：真实缩略图，点击打开全屏预览 */
                      <div
                        className="w-10 h-10 rounded-lg overflow-hidden bg-gray-900 border border-gray-200 flex-shrink-0 cursor-pointer"
                        onClick={() => setPreviewItem(preview)}
                        title="点击预览"
                      >
                        {att.icon === 'image' ? (
                          <ImageThumb path={att.path} alt={att.name} className="w-full h-full object-cover" />
                        ) : (
                          <VideoThumb path={att.path} className="w-full h-full" />
                        )}
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                        {att.icon === 'text' ? (
                          <FileText size={15} className="text-gray-500" />
                        ) : (
                          <FileIcon size={15} className="text-gray-500" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-800 truncate leading-tight">{att.name}</div>
                      <div className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">
                        {att.kind}{att.size ? ` · ${fmtSize(att.size)}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-white hover:bg-red-500 rounded-lg transition-colors shadow-sm"
                      title="移除附件"
                      aria-label="移除附件"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                  )
                })}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onPaste={handlePasteFiles}
              placeholder={t('chat.placeholder')}
              className="w-full resize-none bg-transparent border-0 focus:ring-0 text-gray-900 placeholder-gray-500 text-[15px] leading-relaxed"
              rows={2}
              disabled={isGenerating}
            />
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddFiles}
                  className="p-2 bg-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-xl transition-colors"
                  title="添加文件"
                >
                  <Plus size={18} />
                </button>

                {/* 权限选择（对话页权限档位） */}
                <div className="relative" ref={permMenuRef}>
                  <button
                    onClick={() => setShowPermMenu(!showPermMenu)}
                    className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                    title="对话页权限：默认权限按安全中心执行；完全访问绕过安全中心与删除保护"
                  >
                    <Shield size={15} className={chatPerm === 'full' ? 'text-amber-500' : 'text-gray-500'} />
                    <span>{chatPerm === 'full' ? '完全访问' : '默认权限'}</span>
                    <ChevronDown size={12} className="text-gray-500" />
                  </button>
                  {showPermMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1.5">
                      {PERM_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setConfig({ chatPermission: opt.value })
                            setShowPermMenu(false)
                          }}
                          className="w-full flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-800">{opt.label}</div>
                            <div className="text-[11px] text-gray-500">{opt.desc}</div>
                          </div>
                          {chatPerm === opt.value && <Check size={15} className="text-primary-500 mt-0.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Model Selector */}
                <div className="relative" ref={modelSelectorRef}>
                  <button
                    onClick={() => setShowModelSelector(!showModelSelector)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    <div className="w-[18px] h-[18px] rounded-md bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {(currentModel?.name || 'M').charAt(0).toUpperCase()}
                    </div>
                    <span className="max-w-[100px] truncate">{currentModel?.name || 'Select Model'}</span>
                    <ChevronDown size={12} />
                  </button>
                  {showModelSelector && (
                    <div className="absolute bottom-full right-0 mb-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                      <div className="p-2 border-b border-gray-100">
                        <div className="text-xs font-medium text-gray-500 px-2">选择模型</div>
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setCurrentModel(model)
                              setShowModelSelector(false)
                            }}
                            className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
                              currentModel?.id === model.id ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                            }`}
                          >
                            <div className="font-medium">{model.name}</div>
                          </button>
                        ))}
                      </div>
                      <div className="border-t border-gray-100">
                        <button
                          onClick={() => {
                            setShowModelSelector(false)
                            setEditingModel(null)
                            setShowAddModelDialog(true)
                          }}
                          className="w-full text-left px-3 py-2.5 text-sm text-primary-500 hover:bg-primary-50 transition-colors flex items-center gap-2"
                        >
                          <Plus size={14} />
                          添加模型
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Send/Stop Button */}
                {isGenerating ? (
                  <button
                    onClick={handleStop}
                    className="p-2.5 bg-gray-900 text-white rounded-full hover:bg-gray-700 active:scale-95 transition-all"
                    title="停止生成"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="3" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="p-2.5 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    title="发送"
                  >
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    {showAddModelDialog && (
      <AddModelDialog
        model={editingModel}
        onSave={(model) => {
          if (editingModel) {
            useAppStore.getState().updateModel(model.id, model)
          } else {
            useAppStore.getState().addModel(model)
            useAppStore.getState().setCurrentModel(model)
          }
          setShowAddModelDialog(false)
          setEditingModel(null)
        }}
        onClose={() => setShowAddModelDialog(false)}
      />
    )}
    {/* 全屏媒体预览：图片查看 / 视频播放 */}
    <MediaPreview item={previewItem} onClose={() => setPreviewItem(null)} />
  </>
  )
}

export default ChatArea
