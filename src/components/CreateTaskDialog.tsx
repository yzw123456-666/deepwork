import React, { useState, useRef, useEffect } from 'react'
import {
  X,
  FolderOpen,
  ChevronDown,
  Plus,
  ArrowUp,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Task, Conversation } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface CreateTaskDialogProps {
  onClose: () => void
}

// 按当前时间生成问候语
function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return '早上好'
  if (h >= 11 && h < 13) return '中午好'
  if (h >= 13 && h < 18) return '下午好'
  return '晚上好'
}

// 新建任务欢迎页：只负责选择工作空间 + 命名 + 任务描述
// 模型与运行权限在任务工作区（会话输入栏）中选择
const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({ onClose }) => {
  const { addTask, setCurrentTask, setActivePage, setPendingTaskMessage, models, currentModel, config, addConversation, setCurrentConversation } = useAppStore()

  const [taskName, setTaskName] = useState('')
  const [input, setInput] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [creating, setCreating] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSelectFolder = async () => {
    const path = await window.electronAPI?.dialog.selectFolder()
    if (path) setFolderPath(path)
  }

  const folderName = folderPath
    ? folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
    : ''

  const canSend = !!input.trim() && !!folderPath && !creating

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !folderPath || creating) return
    setCreating(true)

    // 任务名：手动命名为空时自动取描述首行前 24 字
    const firstLine = text.split('\n')[0].trim()
    // 默认带上一个可用模型：否则任务设置里会显示「未选模型」，执行时才临时抓一个
    const defaultModelId = currentModel?.id || models.find(m => m.enabled)?.id
    const newTask: Task = {
      id: uuidv4(),
      name: taskName.trim().slice(0, 30) || firstLine.slice(0, 24) || '新任务',
      folderPath,
      mainModels: defaultModelId ? [defaultModelId] : [],
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      subtasks: [],
      // 命令执行权限：取对话输入框「默认权限」下拉设置的默认值
      execPermission: config.taskDefaultPermission ?? 'default',
    }

    try {
      await addTask(newTask)
      // 任务必须挂一个对话：自动在任务下创建一个空对话，供用户在任务下直接交流
      const now = Date.now()
      const firstConv: Conversation = {
        id: uuidv4(),
        title: '新对话',
        messages: [],
        createdAt: now,
        updatedAt: now,
        taskId: newTask.id,
      }
      addConversation(firstConv)
      setCurrentConversation(firstConv)
      setCurrentTask(newTask)
      setPendingTaskMessage(text)
      // 任务不再有独立界面：直接进入对话页，首条描述由 ChatArea 消费 pendingTaskMessage 自动发送
      setActivePage('chat')
      onClose()
    } catch (e) {
      console.error('创建任务失败:', e)
      window.alert('创建任务失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col animate-fade-in">
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200/80 rounded-lg transition-colors"
        title="关闭"
      >
        <X size={20} />
      </button>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        {/* 问候语 */}
        <h1 className="text-3xl font-bold text-gray-800 mb-10 text-center">
          {getGreeting()}，有什么想让我帮忙的吗
        </h1>

        {/* 输入卡片 */}
        <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {/* 任务命名 */}
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="任务名称（可留空，自动取自描述）"
            maxLength={30}
            className="w-full bg-transparent border-0 focus:ring-0 text-gray-800 placeholder-gray-400 text-sm font-medium px-4 pt-3.5 outline-none"
          />

          {/* 工作空间选择 */}
          <div className="px-4 pt-2.5">
            <button
              onClick={handleSelectFolder}
              className="flex items-center gap-2 px-2.5 py-1.5 -ml-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors max-w-full"
              title="选择工作空间"
            >
              <FolderOpen size={16} className="text-gray-500 flex-shrink-0" />
              <span className="truncate">{folderName || '选择工作空间'}</span>
              <ChevronDown size={15} className="text-gray-500 flex-shrink-0" />
            </button>
          </div>

          {/* 任务描述 */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="今天帮你做些什么？描述任务后发送，AI 将自主完成工作"
            className="w-full resize-none bg-transparent border-0 focus:ring-0 text-gray-700 placeholder-gray-400 text-sm px-4 pt-2 min-h-[80px]"
            rows={3}
          />

          {/* 底部控制栏 */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <button
              onClick={handleSelectFolder}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              title="选择工作空间"
            >
              <Plus size={18} />
            </button>

            {/* 发送按钮 */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="p-2.5 bg-gray-900 text-white rounded-full hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 transition-all"
              title="创建并开始任务"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowUp size={16} />
              )}
            </button>
          </div>
        </div>

        {/* 提示 */}
        <p className="mt-4 text-xs text-gray-500">
          Enter 发送，Shift + Enter 换行 · 模型与运行权限可在任务工作区下方选择
        </p>
      </div>
    </div>
  )
}

export default CreateTaskDialog
