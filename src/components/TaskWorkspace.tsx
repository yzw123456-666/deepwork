import React, { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Bot,
  Zap,
  Send,
  Settings,
  FolderOpen,
  User,
  Loader2,
  ArrowLeft,
  Wrench,
  CheckCircle2,
  XCircle,
  Square,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  Check,
  CircleDot,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  Share2,
  MoreHorizontal,
  X,
  PenLine,
  Terminal,
  ChevronUp,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { TaskMessage, SubTask } from '../types'
import { v4 as uuidv4 } from 'uuid'
import TaskSettings from './TaskSettings'
import TaskChecklist from './TaskChecklist'
import ContextRing from './ContextRing'
import { orchestrate, callModel, Assignment, OrchestrationResult } from '../services/agentEngine'

// 从内容中解析思考过程
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

// 思考过程组件（极简风格：小字标题 + 左边线内容）
const ThinkingBlock: React.FC<{ content: string; isGenerating: boolean }> = ({ content, isGenerating }) => {
  const [expanded, setExpanded] = useState(isGenerating)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isGenerating && expanded) {
      setExpanded(false)
    }
  }, [isGenerating])

  // 生成中自动滚动到底部
  useEffect(() => {
    if (isGenerating && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [content, isGenerating, expanded])

  if (!content) return null

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>深度思考</span>
        {isGenerating && <Loader2 size={10} className="animate-spin text-gray-400" />}
      </button>
      {expanded && (
        <div
          ref={bodyRef}
          className={`mt-2 ml-1 pl-3 border-l-2 border-gray-200 text-[13px] text-gray-500 leading-relaxed whitespace-pre-wrap ${
            isGenerating ? 'max-h-60 overflow-y-auto' : ''
          }`}
        >
          {content}
        </div>
      )}
    </div>
  )
}

// 解析AI提问选项（行解析器：支持 A. / A、 / (A) / **A.** 及同行多选项）
interface ParsedOptions {
  question: string
  options: Array<{ label: string; text: string }>
}

function parseQuestionOptions(content: string): ParsedOptions | null {
  const stripMd = (s: string) => s.replace(/^[*>`\-\s]+/, '').replace(/[*>`\s]+$/, '')
  const cleanText = (s: string) => s.replace(/^[*>`\s]+/, '').replace(/[*>`\s]+$/, '')
  // 单行选项："A. 文本" / "A、文本" / "(A) 文本"
  const optionLineRegex = /^[（(]?\s*([A-Za-z])\s*[）)、.]\s*(.+)$/
  // 同行多选项："A. xx B. yy"
  const inlineMarkRegex = /(?:^|\s)[（(]?([A-Za-z])\s*[）)、.]\s*/g

  const lines = content.split('\n')
  const options: Array<{ label: string; text: string }> = []
  let firstIdx = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) {
      if (options.length >= 2) break
      continue
    }
    const cleaned = stripMd(raw)

    // 先尝试同行多选项拆分（优先级高于整行单选项）
    const marks = [...cleaned.matchAll(inlineMarkRegex)]
    if (marks.length >= 2) {
      const parts: Array<{ label: string; text: string }> = []
      for (let k = 0; k < marks.length; k++) {
        const start = marks[k].index + marks[k][0].length
        const end = k + 1 < marks.length ? marks[k + 1].index : cleaned.length
        const text = cleanText(cleaned.slice(start, end))
        if (text) parts.push({ label: marks[k][1].toUpperCase(), text })
      }
      if (parts.length >= 2) {
        if (options.length === 0) firstIdx = i
        options.push(...parts)
        continue
      }
    }

    // 整行单选项
    const lineMatch = cleaned.match(optionLineRegex)
    if (lineMatch) {
      const text = cleanText(lineMatch[2])
      if (text) {
        if (options.length === 0) firstIdx = i
        options.push({ label: lineMatch[1].toUpperCase(), text })
        continue
      }
    }

    // 已在收集选项却遇到普通文字 → 选项块结束
    if (options.length > 0) break
    // 尚未开始收集（还在问题正文里）→ 继续向下扫描
  }

  // 校验：>=2 个选项，且标签从 A 开始连续（A,B,C...），避免误伤普通正文
  if (options.length < 2) return null
  for (let i = 0; i < options.length; i++) {
    if (options[i].label.charCodeAt(0) !== 65 + i) return null
  }

  const question = lines.slice(0, firstIdx).join('\n').trim()
  return {
    question: question.replace(/^QUESTION[:：]\s*/i, '').replace(/^问题[:：]\s*/, '') || '请选择：',
    options,
  }
}

interface TaskWorkspaceProps {
  onBack: () => void
}

// Markdown 渲染器（Trae 风格：表格/代码块/列表）
const Markdown: React.FC<{ content: string }> = ({ content }) => (
  <div className="text-sm text-gray-700 leading-relaxed break-words
    [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-gray-800 [&_h1]:mt-4 [&_h1]:mb-2
    [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-800 [&_h2]:mt-4 [&_h2]:mb-2
    [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-gray-800 [&_h3]:mt-3 [&_h3]:mb-1.5
    [&_p]:my-2 [&_p]:first:mt-0 [&_p]:last:mb-0
    [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1
    [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1
    [&_li]:my-0.5
    [&_strong]:font-semibold [&_strong]:text-gray-800
    [&_code:not(pre_code)]:bg-gray-100 [&_code:not(pre_code)]:text-gray-700 [&_code:not(pre_code)]:px-1.5 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-[13px] [&_code:not(pre_code)]:font-mono
    [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:text-[13px]
    [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:p-0 [&_pre_code]:font-mono
    [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-3 [&_blockquote]:text-gray-500 [&_blockquote]:my-2
    [&_a]:text-primary-600 [&_a]:underline
    [&_hr]:border-gray-100 [&_hr]:my-3">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 border border-gray-200 rounded-xl">
            <table className="w-full text-sm border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        th: ({ children }) => (
          <th className="px-4 py-2.5 text-left font-medium text-gray-700 border-b border-gray-200">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2.5 text-gray-600 border-b border-gray-100 [&_strong]:text-gray-700">{children}</td>
        ),
        tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
)

const TaskWorkspace: React.FC<TaskWorkspaceProps> = ({ onBack }) => {
  const {
    currentTask,
    models,
    updateTask,
    addTaskMessage,
    aiCapabilities,
    updateAICapability,
    config,
    setSubtasks,
    toggleSubtask,
    setModelContextUsage,
  } = useAppStore()

  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [contextUsage, setContextUsage] = useState<{ used: number; max: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [collapsedProcess, setCollapsedProcess] = useState<Record<string, boolean>>({})
  const [expandedArtifacts, setExpandedArtifacts] = useState<Record<string, boolean>>({})
  const [expandedToolMsgs, setExpandedToolMsgs] = useState<Record<string, boolean>>({})
  const [dismissedQuestions, setDismissedQuestions] = useState<Record<string, boolean>>({})
  const [customAnswer, setCustomAnswer] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const statusMsgIdRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)

  // 执行计时器
  useEffect(() => {
    if (!isRunning) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  // 打断 AI 执行
  const handleStop = () => {
    abortControllerRef.current?.abort()
  }

  // 思考过程缓冲区（按阶段收集，注入对应消息）+ 实时显示
  const thinkingBufRef = useRef('')
  const [liveThinking, setLiveThinking] = useState('')
  const lastThinkRenderRef = useRef(0)
  const collectThinking = (t: string) => {
    if (!t) return
    thinkingBufRef.current += t
    // 节流：最多 150ms 更新一次实时思考显示
    const now = Date.now()
    if (now - lastThinkRenderRef.current > 150) {
      lastThinkRenderRef.current = now
      setLiveThinking(thinkingBufRef.current)
    }
  }
  const resetThinking = () => {
    thinkingBufRef.current = ''
    lastThinkRenderRef.current = 0
    setLiveThinking('')
  }
  const withThinking = (text: string) =>
    thinkingBufRef.current.trim() ? `<think>\n${thinkingBufRef.current.trim()}\n</think>\n\n${text}` : text

  const formatDuration = (sec: number) => {
    if (sec < 60) return `${sec}s`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}m${s}s`
  }

  const formatMsgTime = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const hm = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    if (d.toDateString() === now.toDateString()) return hm
    if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) return `昨天 ${hm}`
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentTask?.messages])

  if (!currentTask) return null

  const allowExec = (config as any).systemTools === 'enabled'
  const getModel = (id: string) => models.find(m => m.id === id)
  const mainModels = currentTask.mainModels.map(getModel).filter(Boolean) as NonNullable<ReturnType<typeof getModel>>[]
  const subModels = currentTask.subModels.map(getModel).filter(Boolean) as NonNullable<ReturnType<typeof getModel>>[]

  // AI 提问弹窗：最后一条 AI 消息含选项且未回答时弹出
  const lastAiMsg = [...currentTask.messages].reverse().find(m => m.role === 'main' || m.role === 'sub')
  let activeQuestion: ParsedOptions | null = null
  let activeQuestionMsgId = ''
  if (lastAiMsg) {
    const { mainContent: lc } = parseThinkingContent(lastAiMsg.content || '')
    activeQuestion = parseQuestionOptions(lc)
    activeQuestionMsgId = lastAiMsg.id
  }
  const showQuestionModal = !!(activeQuestion && !dismissedQuestions[activeQuestionMsgId] && !isRunning)
  const dismissQuestion = () => {
    setDismissedQuestions(prev => ({ ...prev, [activeQuestionMsgId]: true }))
    setCustomAnswer('')
  }
  const answerQuestion = (text: string) => {
    const t = text.trim()
    if (!t) return
    setDismissedQuestions(prev => ({ ...prev, [activeQuestionMsgId]: true }))
    setCustomAnswer('')
    handleSend(t)
  }

  const getCapabilityDesc = (modelId: string): string => {
    const model = getModel(modelId)
    const cap = aiCapabilities.find(c => c.modelId === modelId)
    if (model?.capability) return model.capability
    if (cap?.strengths?.length) return cap.strengths.join('、')
    return '通用助手'
  }

  // 更新或创建状态消息
  const updateStatusMsg = async (content: string, status: TaskMessage['status'] = 'running') => {
    const taskId = currentTask.id
    const existingId = statusMsgIdRef.current
    const tasks = useAppStore.getState().tasks
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    if (existingId) {
      const idx = task.messages.findIndex(m => m.id === existingId)
      if (idx >= 0) {
        const messages = [...task.messages]
        messages[idx] = { ...messages[idx], content, status }
        await updateTask(taskId, { messages })
        return
      }
    }
    const msg: TaskMessage = {
      id: uuidv4(),
      role: 'system',
      content,
      timestamp: Date.now(),
      status,
    }
    statusMsgIdRef.current = msg.id
    await addTaskMessage(taskId, msg)
  }

  // 结束当前状态消息
  const closeStatusMsg = async () => {
    if (!statusMsgIdRef.current) return
    const taskId = currentTask.id
    const task = useAppStore.getState().tasks.find(t => t.id === taskId)
    if (!task) return
    const messages = task.messages.map(m =>
      m.id === statusMsgIdRef.current ? { ...m, status: 'completed' as const } : m
    )
    await updateTask(taskId, { messages })
    statusMsgIdRef.current = null
  }

  const handleSend = async (overrideText?: string) => {
    const userRequest = (overrideText ?? input).trim()
    if (!userRequest || isRunning) return
    setInput('')
    setIsRunning(true)
    setElapsed(0)
    setContextUsage(null)
    statusMsgIdRef.current = null
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const signal = abortController.signal

    const task = useAppStore.getState().tasks.find(t => t.id === currentTask.id)
    if (!task) return

    await addTaskMessage(task.id, {
      id: uuidv4(),
      role: 'user',
      content: userRequest,
      timestamp: Date.now(),
      status: 'completed',
    })

    // 记录开始时间
    startTimeRef.current = Date.now()
    const allowExec = (config as any).systemTools === 'enabled'
    resetThinking()

    try {
      if (!task.multiAIMode || task.mainModels.length === 0) {
        // 单AI模式：Agent Loop
        const model = getModel(task.mainModels[0]) || models[0]
        if (!model) throw new Error('没有可用模型，请先在设置中添加模型')

        const { runAgentLoop } = await import('../services/agentEngine')
        // Prepare task history for single-agent mode - pass all messages, formatter will clean up
        const taskHistory = task.messages.map(m => ({ role: m.role, content: m.content }));

        const result = await runAgentLoop(
          model,
          task.folderPath,
          userRequest,
          `你是一个AI任务执行助手「${model.name}」。你的擅长领域：${getCapabilityDesc(model.id)}。工作目录：${task.folderPath}\n\n你可以使用文件读写、目录浏览、命令执行、技能调用等工具来完成任务。调用技能时使用 use_skill 工具，参数为 skill_name 和 description。请分析用户需求，合理使用工具，确保任务完成。任务完成时输出 DONE: 总结结果。`,
          allowExec,
          {
            onStatus: (c) => updateStatusMsg(c),
            onToolUse: async (tool, args, result) => {
              await closeStatusMsg()
              let summary = `${result.ok ? '✅' : '❌'} ${tool}`
              if (tool === 'use_skill') {
                summary = `${result.ok ? '⚡' : '❌'} 调用技能「${args.skill_name || ''}」${args.description ? ': ' + args.description : ''}`
              } else if (args.path) {
                summary += ` (${args.path})`
              } else if (args.command) {
                summary += ` (${args.command})`
              }
              await addTaskMessage(task.id, {
                id: uuidv4(),
                role: 'system',
                content: summary,
                timestamp: Date.now(),
                status: result.ok ? 'completed' : 'failed',
              })
            },
            onContextUsage: (used, max) => setContextUsage({ used, max }),
            onModelContextUsage: (modelId, used, max) => setModelContextUsage(modelId, used, max),
            onThinking: collectThinking,
          },
          taskHistory,
          signal
        )
        await closeStatusMsg()
        await addTaskMessage(task.id, {
          id: uuidv4(),
          role: 'main',
          content: withThinking(result),
          modelId: model.id,
          timestamp: Date.now(),
          status: 'completed',
        })
        await updateTask(task.id, { status: 'completed' })
        window.electronAPI?.app.notify('任务完成', `单AI任务「${task.name}」已成功完成`)
      } else {
        // 多AI合作模式
        const mainModel = getModel(task.mainModels[0])
        if (!mainModel) throw new Error('未选择主模型')

        const subModelListDesc = subModels
          .map(m => {
            const cap = aiCapabilities.find(c => c.modelId === m.id)
            const sizeInfo = m.parameterSize ? ` (${m.parameterSize})` : ''
            const scoreInfo = cap ? ` [综合:${cap.compositeScore}/10 评分:${cap.rating}/10 成功率:${cap.successRate}% 任务数:${cap.taskCount}]` : ''
            return `- ${m.name}${sizeInfo}: 擅长 ${getCapabilityDesc(m.id)}${scoreInfo}`
          })
          .join('\n')

        // 记录各模型执行情况用于能力评估
        const subStartTimes = new Map<string, number>()

        // Prepare task history for context - pass all messages, formatHistoryForModel will clean up
        const taskHistory = task.messages.map(m => ({ role: m.role, content: m.content }));

        const result: OrchestrationResult = await orchestrate(
          mainModel,
          subModels,
          task.folderPath,
          userRequest,
          subModelListDesc,
          allowExec,
          aiCapabilities.map(c => ({
            modelId: c.modelId,
            taskCount: c.taskCount,
            successRate: c.successRate,
            failureCount: c.failureCount || 0,
          })),
          getCapabilityDesc,
          {
            onStatus: (c: string) => updateStatusMsg(c),
            onThinking: collectThinking,
            onPlan: async (assignments: Assignment[]) => {
              await closeStatusMsg()
              const planText = assignments
                .map(a => `📋 ${a.modelId}: ${a.taskDesc}`)
                .join('\n')
              await addTaskMessage(task.id, {
                id: uuidv4(),
                role: 'main',
                content: withThinking(`任务分配（并行执行）：\n${planText}`),
                modelId: mainModel.id,
                timestamp: Date.now(),
                status: 'completed',
              })
              // 创建子任务清单
              const subtasks: SubTask[] = assignments.map(a => ({
                id: uuidv4(),
                text: `[${a.modelId}] ${a.taskDesc}`,
                completed: false,
              }))
              await setSubtasks(task.id, subtasks)
              resetThinking()
            },
            onSubStart: async (assignment: Assignment) => {
              await closeStatusMsg()
              resetThinking()
              subStartTimes.set(assignment.taskDesc, Date.now())
              await addTaskMessage(task.id, {
                id: uuidv4(),
                role: 'sub',
                content: `⚙️ ${assignment.modelId} 开始执行：${assignment.taskDesc}`,
                modelId: subModels.find(m => m.name === assignment.modelId)?.id,
                timestamp: Date.now(),
                status: 'running',
              })
            },
            onSubDone: async (assignment: Assignment, result: string) => {
              const modelId = subModels.find(m => m.name === assignment.modelId)?.id
              const dur = Date.now() - (subStartTimes.get(assignment.taskDesc) || Date.now())
              await addTaskMessage(task.id, {
                id: uuidv4(),
                role: 'sub',
                content: withThinking(`✅ ${assignment.modelId} 完成（${(dur / 1000).toFixed(1)}s）：${assignment.taskDesc}\n\n${result.slice(0, 500)}`),
                modelId,
                timestamp: Date.now(),
                status: 'completed',
              })
              resetThinking()
              // 标记子任务完成
              const currentSubtasks = useAppStore.getState().tasks.find(t => t.id === task.id)?.subtasks || []
              const matchSubtask = currentSubtasks.find(s => !s.completed && s.text.includes(assignment.modelId) && s.text.includes(assignment.taskDesc))
              if (matchSubtask) {
                await toggleSubtask(task.id, matchSubtask.id)
              }
              // 能力评估：成功（清零连续失败）
              if (modelId) {
                const cap = aiCapabilities.find(c => c.modelId === modelId)
                updateAICapability(modelId, {
                  taskCount: (cap?.taskCount || 0) + 1,
                  successRate: cap ? Math.round((cap.successRate * cap.taskCount + 100) / (cap.taskCount + 1)) : 100,
                  failureCount: 0,
                  lastError: undefined,
                })
              }
            },
            onSubFail: async (assignment: Assignment, error: string) => {
              const modelId = subModels.find(m => m.name === assignment.modelId)?.id
              await addTaskMessage(task.id, {
                id: uuidv4(),
                role: 'sub',
                content: `❌ ${assignment.modelId} 失败：${assignment.taskDesc}\n原因：${error}`,
                modelId,
                timestamp: Date.now(),
                status: 'failed',
              })
              // 能力评估：失败（累计失败，用于重复失败检测）
              if (modelId) {
                const cap = aiCapabilities.find(c => c.modelId === modelId)
                updateAICapability(modelId, {
                  taskCount: (cap?.taskCount || 0) + 1,
                  successRate: cap ? Math.round((cap.successRate * cap.taskCount) / (cap.taskCount + 1)) : 0,
                  failureCount: (cap?.failureCount || 0) + 1,
                  lastError: error.slice(0, 200),
                })
              }
            },
            onMainTakeover: async (assignment: Assignment) => {
              await updateStatusMsg(`🫡 ${mainModel.name} 正在接管失败的任务：${assignment.taskDesc}`)
              resetThinking()
            },
            onContextUsage: (used: number, max: number) => setContextUsage({ used, max }),
            onModelContextUsage: (modelId: string, used: number, max: number) => setModelContextUsage(modelId, used, max),
          },
          taskHistory,
          signal,
        )

        await closeStatusMsg()
        await addTaskMessage(task.id, {
          id: uuidv4(),
          role: 'main',
          content: withThinking(result.finalAnswer),
          modelId: mainModel.id,
          timestamp: Date.now(),
          status: 'completed',
        })
        await updateTask(task.id, { status: result.success ? 'completed' : 'failed' })
        window.electronAPI?.app.notify(
          result.success ? '任务完成' : '任务失败',
          `多AI合作任务「${task.name}」${result.success ? '已成功完成' : '执行失败'}`
        )
        // 任务成功时自动创建长期记忆
        if (result.success) {
          const { addMemory } = useAppStore.getState()
          // 提取关键文件（从工具消息中解析）
          const toolFiles = new Set<string>()
          task.messages.forEach(m => {
            if (m.role === 'system' && (m.content.includes('write_file') || m.content.includes('edit_file') || m.content.includes('创建') || m.content.includes('修改'))) {
              const matches = m.content.match(/(?:\(|：\s*)([a-zA-Z0-9_\-./]+\.(?:html|js|ts|jsx|tsx|css|json|py|md|txt))(?:\)|,|。|;|\s)/g)
              if (matches) matches.forEach(m => toolFiles.add(m.replace(/[()，。;,\s]/g, '')))
            }
          })
          // 从结果中提取关键词
          const keywords = [...new Set([
            ...result.finalAnswer.toLowerCase().match(/[\u4e00-\u9fa5]{2,}/g) || [],
            ...task.name.toLowerCase().match(/[\u4e00-\u9fa5]{2,}/g) || [],
            ...subModels.map(m => m.name.toLowerCase())
          ].slice(0, 10))]
          await addMemory({
            id: uuidv4(),
            timestamp: Date.now(),
            taskId: task.id,
            taskName: task.name,
            summary: result.finalAnswer.slice(0, 500),
            keywords,
            files: Array.from(toolFiles),
            outcome: 'success',
          })
        }
      }
    } catch (err: any) {
      await closeStatusMsg()
      const isAborted = err?.name === 'AbortError' || String(err?.message).includes('打断') || String(err?.message).includes('abort')
      if (isAborted) {
        // 用户打断：记录中断消息，任务状态保持不变
        await addTaskMessage(task.id, {
          id: uuidv4(),
          role: 'system',
          content: `⏹ 已被用户打断（用时 ${formatDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))}）`,
          timestamp: Date.now(),
          status: 'completed',
        })
      } else {
        await addTaskMessage(task.id, {
          id: uuidv4(),
          role: 'system',
          content: `❌ 任务执行失败：${err.message}`,
          timestamp: Date.now(),
          status: 'failed',
        })
        await updateTask(task.id, { status: 'failed' })
        window.electronAPI?.app.notify('任务失败', `任务「${task.name}」执行出错：${err.message.slice(0, 100)}`)
      }
    } finally {
      setIsRunning(false)
      abortControllerRef.current = null
    }
  }

  const renderMessage = (msg: TaskMessage) => {
    const model = msg.modelId ? getModel(msg.modelId) : null

    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="flex justify-end mb-4">
          <div className="max-w-[80%] flex items-start gap-3">
            <div className="bg-primary-500 text-white px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap">
              {msg.content}
            </div>
            <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-white" />
            </div>
          </div>
        </div>
      )
    }

    if (msg.role === 'system') {
      const isToolMsg = msg.content.includes('read_file') || msg.content.includes('write_file') ||
                        msg.content.includes('list_files') || msg.content.includes('run_command') ||
                        msg.content.includes('edit_file') || msg.content.includes('search_files') ||
                        msg.content.includes('use_skill')
      
      // 解析工具详情
      const writeFiles = [...msg.content.matchAll(/(?:write_file|edit_file|append_file)\s*\(([^)]+)\)/g)].map(m => m[1].trim())
      const readFiles = [...msg.content.matchAll(/read_file\s*\(([^)]+)\)/g)].map(m => m[1].trim())
      const runCmds = [...msg.content.matchAll(/run_command\s*\(([^)]+)\)/g)].map(m => m[1].trim())
      const skillCalls = [...msg.content.matchAll(/use_skill\s*\(([^)]+)\)/g)].map(m => m[1].trim())
      
      let toolSummary = msg.content
      let toolIcon = <Wrench size={12} className="flex-shrink-0" />
      let details: React.ReactNode = null
      
      if (skillCalls.length > 0) {
        toolSummary = skillCalls.length === 1 ? `已调用技能 ${skillCalls[0]}` : `已调用 ${skillCalls.length} 个技能`
        toolIcon = <Zap size={12} className="flex-shrink-0" />
        details = skillCalls.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
            <Zap size={12} className="text-amber-500" />
            <span>{s}</span>
          </div>
        ))
      } else if (writeFiles.length > 0) {
        toolSummary = writeFiles.length === 1 ? `已编辑 ${writeFiles[0]}` : `已编辑 ${writeFiles.length} 个文件`
        toolIcon = <PenLine size={12} className="flex-shrink-0" />
        details = writeFiles.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
            <FileText size={12} className="text-gray-400" />
            <span>{f}</span>
          </div>
        ))
      } else if (readFiles.length > 0) {
        toolSummary = readFiles.length === 1 ? `已读取 ${readFiles[0]}` : `已读取 ${readFiles.length} 个文件`
        toolIcon = <FileText size={12} className="flex-shrink-0" />
        details = readFiles.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-600 py-0.5">
            <FileText size={12} className="text-gray-400" />
            <span>{f}</span>
          </div>
        ))
      } else if (runCmds.length > 0) {
        toolSummary = `已执行 ${runCmds.length} 条命令`
        toolIcon = <Terminal size={12} className="flex-shrink-0" />
        // 提取命令执行结果
        const cmdOutput = msg.content.split('\n').filter(l => l.startsWith('$') || l.includes('exit code') || l.includes('stdout') || l.includes('已执行')).slice(0, 5)
        details = (
          <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600 font-mono max-h-40 overflow-y-auto">
            {cmdOutput.length > 0 ? cmdOutput.map((l, i) => <div key={i}>{l}</div>) : <span className="text-gray-400">命令已执行</span>}
          </div>
        )
      } else if (msg.content.includes('list_files')) {
        toolSummary = '已列出文件'
      } else if (msg.content.includes('search_files')) {
        toolSummary = '已搜索文件'
      }
      
      // 非工具消息或无详情 → 直接显示
      if (!isToolMsg || (!writeFiles.length && !readFiles.length && !runCmds.length && !skillCalls.length)) {
        return (
          <div key={msg.id} className="flex justify-center mb-3">
            <div className={`px-4 py-2 rounded-full text-xs flex items-center gap-2 max-w-[90%] ${
              msg.status === 'running' ? 'bg-blue-50 text-blue-600'
              : msg.status === 'failed' ? 'bg-red-50 text-red-600'
              : 'bg-gray-100 text-gray-500'
            }`}>
              {msg.status === 'running' && <Loader2 size={12} className="animate-spin flex-shrink-0" />}
              <span className="truncate">{msg.content}</span>
            </div>
          </div>
        )
      }
      
      // 可展开的工具消息
      const isExpanded = expandedToolMsgs[msg.id] || false
      return (
        <div key={msg.id} className="flex justify-center mb-3">
          <div className="w-full max-w-[85%]">
            <button
              onClick={() => setExpandedToolMsgs(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
              className={`w-full px-4 py-2 rounded-full text-xs flex items-center gap-2 transition-colors ${
                msg.status === 'running' ? 'bg-blue-50 text-blue-600'
                : msg.status === 'failed' ? 'bg-red-50 text-red-600'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
              }`}
            >
              {msg.status === 'running' && <Loader2 size={12} className="animate-spin flex-shrink-0" />}
              {msg.status !== 'running' && toolIcon}
              <span className="truncate flex-1 text-left">{toolSummary}</span>
              {msg.status !== 'running' && (
                isExpanded ? <ChevronUp size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />
              )}
            </button>
            {isExpanded && details && (
              <div className="mt-2 ml-4 pl-3 border-l-2 border-gray-200">
                {details}
              </div>
            )}
          </div>
        </div>
      )
    }

    // main / sub 消息：Trae 风格卡片
    const isMain = msg.role === 'main'
    const isCopied = copiedMsgId === msg.id
    // 判断是否为当前正在生成的最后一条消息
    const isLastMessage = msg.id === currentTask.messages[currentTask.messages.length - 1]?.id
    const isGeneratingThis = isRunning && isLastMessage && (msg.role === 'main' || msg.role === 'sub')
    // 计算该消息的执行时长（距上一条用户消息）
    const msgIndex = currentTask.messages.findIndex(m => m.id === msg.id)
    let lastUserTs = 0
    let lastUserIdx = -1
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (currentTask.messages[i].role === 'user') { lastUserTs = currentTask.messages[i].timestamp; lastUserIdx = i; break }
    }
    const duration = lastUserTs ? Math.max(1, Math.round((msg.timestamp - lastUserTs) / 1000)) : 0

    // 提取本轮执行中创建/修改的文件（从工具消息解析）
    const artifacts = new Set<string>()
    if (lastUserIdx >= 0) {
      for (let i = lastUserIdx + 1; i < msgIndex; i++) {
        const m = currentTask.messages[i]
        if (m.role === 'system') {
          const matches = m.content.matchAll(/(?:write_file|edit_file|append_file)\s*\(([^)]+)\)/g)
          for (const match of matches) {
            const f = match[1].trim()
            if (f && !f.includes(' ') && f.includes('.')) artifacts.add(f)
          }
        }
      }
    }

    // 解析思考过程和选项
    const { thinking, mainContent } = parseThinkingContent(msg.content || '')
    const questionOptions = parseQuestionOptions(mainContent)

    return (
      <div key={msg.id} className="flex mb-6">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
          isMain ? 'bg-gradient-to-br from-primary-400 to-primary-600' : 'bg-gradient-to-br from-green-400 to-green-600'
        }`}>
          {isMain ? <Bot size={16} className="text-white" /> : <Zap size={16} className="text-white" />}
        </div>
        <div className="ml-3 flex-1 min-w-0">
          {/* 思考过程（极简折叠） */}
          {thinking && (
            <ThinkingBlock content={thinking} isGenerating={isGeneratingThis} />
          )}

          {/* 内容：直接渲染（无卡片） */}
          {questionOptions ? (
            <div>
              {questionOptions.question && <Markdown content={questionOptions.question} />}
              <div className="space-y-2 mt-3">
                {questionOptions.options.map((opt, idx) => (
                  <button
                    key={idx}
                    disabled={isRunning}
                    onClick={() => handleSend(`${opt.label}. ${opt.text}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-primary-50 hover:border-primary-200 border border-gray-200 rounded-xl transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CircleDot size={16} className="text-gray-400 group-hover:text-primary-500 flex-shrink-0" />
                    <span className="font-medium text-gray-800 group-hover:text-primary-700">{opt.label}.</span>
                    <span className="text-sm text-gray-600 group-hover:text-gray-700">{opt.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : mainContent ? (
            <Markdown content={mainContent} />
          ) : !thinking ? (
            <div className="text-gray-400 italic text-sm">...</div>
          ) : null}

          {/* 产物：查看所有产物 (N) */}
          {artifacts.size > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setExpandedArtifacts(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                查看所有产物 ({artifacts.size})
                <ChevronRight
                  size={14}
                  className={`text-gray-400 transition-transform ${expandedArtifacts[msg.id] ? 'rotate-90' : ''}`}
                />
              </button>
              {expandedArtifacts[msg.id] && (
                <div className="mt-2 space-y-1.5">
                  {Array.from(artifacts).map(f => (
                    <div key={f} className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl px-4 py-2.5 hover:border-gray-300 transition-colors cursor-pointer max-w-md"
                      onClick={() => {
                        const fullPath = currentTask.folderPath.replace(/[\\/]+$/, '') + '\\' + f
                        navigator.clipboard.writeText(fullPath)
                      }}
                      title={`点击复制路径：${currentTask.folderPath}\\${f}`}
                    >
                      <FileText size={16} className="text-blue-500 flex-shrink-0" />
                      <span className="text-sm text-gray-700 truncate flex-1">{f}</span>
                      <ChevronRight size={13} className="text-gray-300" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 底部操作栏：图标 + 模型名 + 时长 + 时间 */}
          <div className="flex items-center gap-0.5 mt-2 text-gray-400">
            <button
              onClick={() => {
                navigator.clipboard.writeText(msg.content)
                setCopiedMsgId(msg.id)
                setTimeout(() => setCopiedMsgId(null), 1500)
              }}
              className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="复制"
            >
              {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="赞">
              <ThumbsUp size={14} />
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="踩">
              <ThumbsDown size={14} />
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="朗读">
              <Volume2 size={14} />
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="重新生成">
              <RefreshCw size={14} />
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="分享">
              <Share2 size={14} />
            </button>
            <button className="p-1.5 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="更多">
              <MoreHorizontal size={14} />
            </button>
            <span className={`ml-1.5 text-xs px-2 py-0.5 rounded-full ${
              isMain ? 'bg-primary-100 text-primary-600' : 'bg-green-100 text-green-600'
            }`}>
              {model?.name || 'AI'}
            </span>
            {duration > 0 && (
              <span className="text-xs text-gray-300 ml-1">{formatDuration(duration)}</span>
            )}
            <span className="text-xs text-gray-300 ml-1">{formatMsgTime(msg.timestamp)}</span>
          </div>
        </div>
      </div>
    )
  }

  // 分组渲染：系统/工具消息合并为可折叠的"过程消息"，主/附属消息独立渲染
  const renderMessageGroups = () => {
    const messages = currentTask.messages
    const groups: Array<{ type: 'msg'; msg: TaskMessage } | { type: 'process'; msgs: TaskMessage[] }> = []
    let processBuf: TaskMessage[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        processBuf.push(m)
      } else {
        if (processBuf.length > 0) { groups.push({ type: 'process', msgs: processBuf }); processBuf = [] }
        groups.push({ type: 'msg', msg: m })
      }
    }
    if (processBuf.length > 0) groups.push({ type: 'process', msgs: processBuf })

    return groups.map((g, gi) => {
      if (g.type === 'msg') return renderMessage(g.msg)
      const key = `proc-${gi}`
      const collapsed = collapsedProcess[key] ?? true
      const allDone = g.msgs.every(m => m.status !== 'running')
      return (
        <div key={key} className="mb-3">
          <button
            onClick={() => setCollapsedProcess(prev => ({ ...prev, [key]: !collapsed }))}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors px-1"
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>过程消息 ({g.msgs.length})</span>
            {!allDone && <Loader2 size={10} className="animate-spin text-primary-500" />}
          </button>
          {!collapsed && (
            <div className="mt-2 space-y-2 border-l-2 border-gray-100 pl-3 ml-1">
              {g.msgs.map(m => renderMessage(m))}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={18} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-gray-800">{currentTask.name}</h2>
              {currentTask.multiAIMode && (
                <span className="px-2 py-0.5 bg-primary-100 text-primary-600 text-xs rounded-full">多AI合作</span>
              )}
            </div>
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <FolderOpen size={10} />
              {currentTask.folderPath}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="任务设置"
        >
          <Settings size={18} className="text-gray-600" />
        </button>
      </div>

      {/* Team Info */}
      {currentTask.multiAIMode && (
        <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-4 text-xs flex-shrink-0 flex-wrap">
          <span className="text-gray-400">团队：</span>
          {mainModels.map(m => (
            <span key={m!.id} className="flex items-center gap-1 text-primary-600">
              <Bot size={12} />
              {m!.name} (主)
            </span>
          ))}
          {subModels.map(m => (
            <span key={m!.id} className="flex items-center gap-1 text-green-600">
              <Zap size={12} />
              {m!.name}
            </span>
          ))}
          {!allowExec && (
            <span className="text-amber-500 ml-auto">⚠ 命令执行已禁用（安全中心可开启）</span>
          )}
          {/* 执行计时 */}
          <span className="ml-auto flex items-center gap-3">
            {isRunning && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                {formatDuration(elapsed)}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {currentTask.messages.length === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <Bot size={48} className="mx-auto mb-3 text-gray-300" />
              <p>描述你的任务，AI 将使用文件读写、命令执行等工具真正完成工作</p>
            </div>
          ) : (
            renderMessageGroups()
          )}
          {isRunning && (
            <div className="flex justify-center py-2">
              <Loader2 size={16} className="animate-spin text-primary-500" />
            </div>
          )}
          {/* 实时深度思考 */}
          {isRunning && liveThinking.trim() && (
            <ThinkingBlock content={liveThinking.trim()} isGenerating={true} />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Task Checklist（悬浮于输入框上方） */}
      {currentTask.subtasks.length > 0 && (
        <div className="px-4 pb-1 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <TaskChecklist taskId={currentTask.id} />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={currentTask.multiAIMode ? '描述任务，主模型将自动分工给团队并行执行...' : '描述你的任务...'}
              className="w-full resize-none bg-transparent border-0 focus:ring-0 text-gray-700 placeholder-gray-400 text-sm"
              rows={2}
              disabled={isRunning}
            />
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
              <span className="text-xs text-gray-400 flex items-center gap-2">
                {currentTask.multiAIMode ? `主模型: ${mainModels[0]?.name || '未选择'} · 附属: ${subModels.length}个` : '单AI Agent 模式'}
                {contextUsage && <ContextRing used={contextUsage.used} max={contextUsage.max} size={18} />}
              </span>
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <button
                    onClick={handleStop}
                    className="p-2.5 bg-gray-900 text-white rounded-full hover:bg-gray-700 active:scale-95 transition-all"
                    title="打断 AI 执行"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="3" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim()}
                    className="p-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI 提问弹窗：选择题 + 自定义输入 */}
      {showQuestionModal && activeQuestion && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
          onClick={dismissQuestion}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-5 w-[460px] max-w-[92%] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot size={14} className="text-white" />
                </div>
                <span className="text-sm font-medium text-gray-800 leading-relaxed whitespace-pre-wrap">{activeQuestion.question}</span>
              </div>
              <button
                onClick={dismissQuestion}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {activeQuestion.options.map((opt, idx) => (
                <button
                  key={idx}
                  onClick={() => answerQuestion(`${opt.label}. ${opt.text}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-primary-50 hover:border-primary-300 border border-gray-200 rounded-xl transition-all text-left group"
                >
                  <span className="w-6 h-6 rounded-full bg-white border border-gray-300 group-hover:border-primary-400 group-hover:bg-primary-500 group-hover:text-white text-xs font-medium text-gray-500 group-hover:text-white flex items-center justify-center flex-shrink-0 transition-all">
                    {opt.label}
                  </span>
                  <span className="text-sm text-gray-700 group-hover:text-gray-800">{opt.text}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
                <PenLine size={14} className="text-gray-400 flex-shrink-0" />
                <input
                  autoFocus
                  value={customAnswer}
                  onChange={(e) => setCustomAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      answerQuestion(customAnswer)
                    }
                  }}
                  placeholder="或输入其他回答..."
                  className="flex-1 bg-transparent border-0 focus:ring-0 text-sm text-gray-700 placeholder-gray-400 outline-none"
                />
              </div>
              <button
                onClick={() => answerQuestion(customAnswer)}
                disabled={!customAnswer.trim()}
                className="p-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <TaskSettings task={currentTask} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

export default TaskWorkspace
