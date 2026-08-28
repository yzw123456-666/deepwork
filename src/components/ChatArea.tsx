import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Send,
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
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  User,
  Bot,
  X,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  Share2,
  MoreHorizontal,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Message, Model } from '../types'
import { v4 as uuidv4 } from 'uuid'
import AddModelDialog from './AddModelDialog'

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

// 思考过程组件
const ThinkingBlock: React.FC<{ content: string; isGenerating: boolean }> = ({ content, isGenerating }) => {
  const [expanded, setExpanded] = useState(isGenerating)
  const { t } = useTranslation()

  useEffect(() => {
    if (!isGenerating && expanded) {
      // 思考完成后自动折叠
      setExpanded(false)
    }
  }, [isGenerating])

  if (!content) return null

  return (
    <div className="mb-3 border border-blue-200 bg-blue-50/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-blue-700 hover:bg-blue-100/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-blue-500 animate-pulse' : 'bg-blue-400'}`} />
          <span className="font-medium">深度思考</span>
          {isGenerating && <span className="text-xs text-blue-500">思考中...</span>}
          {!isGenerating && <span className="text-xs text-blue-500">已完成</span>}
        </div>
        <ChevronRight
          size={14}
          className={`ml-auto text-blue-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-3 text-sm text-blue-800/80 leading-relaxed border-t border-blue-100 pt-2">
          {content.split('\n').map((line, i) => (
            <p key={i} className={line ? 'mb-1' : 'mb-3'}>{line || '\u00A0'}</p>
          ))}
        </div>
      )}
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
    addTokenUsage,
  } = useAppStore()

  const [input, setInput] = useState('')
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showAddModelDialog, setShowAddModelDialog] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Array<{ path: string; name: string; content: string }>>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 添加文件
  const handleAddFiles = async () => {
    const paths = await window.electronAPI?.dialog.selectFiles()
    if (!paths || paths.length === 0) return
    for (const p of paths) {
      const r = await window.electronAPI?.dialog.readFileContent(p)
      if (r?.ok && r.content !== undefined) {
        setAttachments(prev => [...prev, { path: p, name: p.split('\\').pop() || p.split('/').pop() || p, content: r.content! }])
      } else {
        alert(r?.error || '读取文件失败')
      }
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

  const getDefaultBaseUrl = (provider: string): string => {
    const urls: Record<string, string> = {
      zhipu: 'https://open.bigmodel.cn/api/paas/v4',
      'zhipu-coding': 'https://open.bigmodel.cn/api/paas/v4',
      tencent: 'https://api.lkeap.cloud.tencent.com/v1',
      kimi: 'https://api.moonshot.cn/v1',
      ollama: 'http://localhost:11434/v1',
      openai: 'https://api.openai.com/v1',
    }
    return urls[provider] || 'https://api.openai.com/v1'
  }

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

    // 附件内容拼进用户消息
    let displayContent = input.trim()
    let apiContent = input.trim()
    if (attachments.length > 0) {
      const attachDisplay = attachments.map(a => `[附件: ${a.name}]`).join(' ')
      const attachApi = attachments
        .map(a => `\n\n--- 文件: ${a.name} ---\n${a.content}`)
        .join('')
      displayContent = displayContent ? `${displayContent}\n${attachDisplay}` : attachDisplay
      apiContent = apiContent + attachApi
    }

    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content: displayContent,
      timestamp: Date.now(),
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

    try {
      const baseUrl = model.baseUrl || getDefaultBaseUrl(model.provider)
      const apiKey = model.apiKey || ''

      abortControllerRef.current = new AbortController()

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

      let allMessages = [...historyMessages, { ...userMessage, content: apiContent }].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      // 系统提示词
      const systemPrompt = (config as any).agentSystemPrompt
      if (systemPrompt && systemPrompt.trim()) {
        allMessages = [{ role: 'system', content: systemPrompt.trim() }, ...allMessages]
      }

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
          max_tokens: model.contextWindow || 32768,
        }),
        signal: abortControllerRef.current.signal,
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

        if (reader) {
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
                updateMessage(conversation.id, assistantMessage.id, fullContent)
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }

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
        updateMessage(conversation.id, assistantMessage.id, content)

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
      if (error.name === 'AbortError') {
        updateMessage(conversation.id, assistantMessage.id, '(生成已停止)')
      } else {
        console.error('API Error:', error)
        updateMessage(
          conversation.id,
          assistantMessage.id,
          `Error: ${error.message || 'Failed to get response from API'}`
        )
      }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
      setAttachments([])
      setInput('')
    }
  }

  const handleStop = () => {
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

  return (
    <>
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
      {messages.length === 0 ? (
        /* Welcome Screen */
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="text-center mb-8 animate-fade-in">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <Sparkles size={32} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              {t('welcome.greeting')}
            </h1>
            <p className="text-lg text-gray-500 mb-1">{t('welcome.subtitle')}</p>
            <p className="text-sm text-gray-400 max-w-md mx-auto">{t('welcome.description')}</p>
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
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 animate-fade-in ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot size={16} className="text-white" />
                  </div>
                )}
                <div className={`max-w-[85%] ${message.role === 'user' ? '' : 'w-full'}`}>
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-gray-800">WorkBuddy</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl ${
                      message.role === 'user'
                        ? 'bg-primary-500 text-white px-4 py-2.5'
                        : ''
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <div className="text-sm">
                        {(() => {
                          const { thinking, mainContent } = parseThinkingContent(message.content || '')
                          return (
                            <>
                              {thinking && (
                                <ThinkingBlock
                                  content={thinking}
                                  isGenerating={isGenerating && message.id === currentConversation?.messages[currentConversation.messages.length - 1]?.id}
                                />
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
                                <div className="text-gray-400 italic">...</div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-1 mt-2 text-gray-400">
                      <Clock size={12} />
                      <span className="text-xs">{Math.round(((message as any).duration || 0) / 1000)}s</span>
                      <span className="mx-1">·</span>
                      <span className="text-xs">已完成</span>
                      {(() => {
                        const records = useAppStore.getState().tokenUsage
                        let record = null
                        for (let i = records.length - 1; i >= 0; i--) {
                          if (records[i].timestamp <= message.timestamp && records[i].modelId === message.modelId) {
                            record = records[i]
                            break
                          }
                        }
                        if (record && record.totalTokens > 0) {
                          return (
                            <>
                              <span className="mx-1">·</span>
                              <span className="text-xs text-primary-500">{record.totalTokens} tokens</span>
                            </>
                          )
                        }
                        return null
                      })()}
                    </div>
                  )}
                  {message.role === 'assistant' && message.content && (
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        onClick={() => handleCopyMessage(message.content, message.id)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title={t('chat.copy')}
                      >
                        {copiedMessageId === message.id ? (
                          <Check size={14} className="text-green-500" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button
                        onClick={handleRegenerate}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title={t('chat.regenerate')}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
                        <ThumbsUp size={14} />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
                        <ThumbsDown size={14} />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
                        <Volume2 size={14} />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
                        <Share2 size={14} />
                      </button>
                      <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors">
                        <MoreHorizontal size={14} />
                      </button>
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

      {/* Input Area */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-3 focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 transition-all">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 group"
                  >
                    <FileText size={12} className="text-blue-500 flex-shrink-0" />
                    <span className="max-w-[180px] truncate">{att.name}</span>
                    <button
                      onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-0.5 text-gray-400 hover:text-red-500 rounded transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={t('chat.placeholder')}
              className="w-full resize-none bg-transparent border-0 focus:ring-0 text-gray-700 placeholder-gray-400 text-sm"
              rows={1}
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
              </div>
              <div className="flex items-center gap-2">
                {/* Model Selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowModelSelector(!showModelSelector)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    <Sparkles size={12} className="text-primary-500" />
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
                            <div className="text-xs text-gray-400">{model.provider}</div>
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
  </>
  )
}

export default ChatArea
