import React, { useState, useEffect } from 'react'
import {
  X,
  FolderOpen,
  ChevronDown,
  Puzzle,
  Loader2,
  FolderPlus,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Task, Conversation } from '../types'
import { AgentListItem } from '../types/electron'
import { v4 as uuidv4 } from 'uuid'

interface CreateTaskDialogProps {
  onClose: () => void
}

// 新建任务：表单式创建（名称 / 工作空间 / 可选 Agent 包 / 可选描述）
// 不再有对话式「描述后发送」：创建后不自动发送任何消息，用户进入任务对话后自行开始
const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({ onClose }) => {
  const { addTask, setCurrentTask, setActivePage, models, currentModel, config, addConversation, setCurrentConversation } = useAppStore()

  const [taskName, setTaskName] = useState('')
  const [description, setDescription] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [agentId, setAgentId] = useState('')            // 空 = 不使用 Agent
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [creating, setCreating] = useState(false)

  // 已安装 Agent 包列表（供下拉选择；离线时合并 localOnly，未安装任何 Agent 时显示引导文案）
  useEffect(() => {
    window.electronAPI?.agents?.list?.().then(r => {
      if (r?.ok) {
        const all = [...(r.agents || []), ...(r.localOnly || [])]
        setAgents(all.filter(p => p.installed))
      }
    }).catch(() => {})
  }, [])

  const handleSelectFolder = async () => {
    const path = await window.electronAPI?.dialog.selectFolder()
    if (path) setFolderPath(path)
  }

  const folderName = folderPath
    ? folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath
    : ''

  const canCreate = !!folderPath && !creating

  const handleCreate = async () => {
    if (!folderPath || creating) return
    setCreating(true)

    // 默认带上一个可用模型：否则任务设置里会显示「未选模型」，执行时才临时抓一个
    const defaultModelId = currentModel?.id || models.find(m => m.enabled)?.id
    const name = taskName.trim().slice(0, 30) || '新任务'
    const newTask: Task = {
      id: uuidv4(),
      name,
      folderPath,
      mainModels: defaultModelId ? [defaultModelId] : [],
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      subtasks: [],
      // 命令执行权限：取「默认权限」设置的默认值
      execPermission: config.taskDefaultPermission ?? 'default',
      // 新建时选用的 Agent 包（可选）：对话时注入其专属人格与技能
      ...(agentId ? { agentId } : {}),
      ...(description.trim() ? { description: description.trim().slice(0, 500) } : {}),
    }

    try {
      await addTask(newTask)
      // 任务挂一个空对话：任务的一切交流都在任务下的对话里进行（这里不预填任何消息）
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
    <div className="fixed inset-0 z-[60] bg-gray-50 flex flex-col animate-page-in">
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200/80 rounded-lg transition-colors"
        title="关闭"
      >
        <X size={20} />
      </button>

      <div className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-xl">
          <h1 className="text-2xl font-bold text-gray-800 mb-1 text-center">新建任务</h1>
          <p className="text-sm text-gray-500 mb-8 text-center">选择工作空间，创建后即可在任务对话中开始工作</p>

          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-5">
            {/* 任务名称 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">任务名称 <span className="text-gray-400">（可留空，默认「新任务」）</span></label>
              <input
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="例如：整理项目文档"
                maxLength={30}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent"
              />
            </div>

            {/* 工作空间 */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">工作空间 <span className="text-red-400">*</span></label>
              <button
                onClick={handleSelectFolder}
                className="w-full flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-left hover:border-gray-300 transition-colors"
                title="选择工作文件夹"
              >
                <FolderOpen size={15} className="text-gray-400 flex-shrink-0" />
                <span className={`flex-1 truncate ${folderName ? 'text-gray-800' : 'text-gray-400'}`}>
                  {folderName || '选择一个文件夹作为本任务的工作空间'}
                </span>
                <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
              </button>
            </div>

            {/* Agent 包（可选） */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">
                Agent <span className="text-gray-400">（可选：为任务启用专属人格与技能）</span>
              </label>
              {agents.length > 0 ? (
                <div className="relative">
                  <select
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pl-9 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent cursor-pointer"
                  >
                    <option value="">不使用 Agent</option>
                    {agents.map(p => (
                      <option key={p.id} value={p.id}>{p.icon} {p.name} · {p.description.slice(0, 24)}…</option>
                    ))}
                  </select>
                  <Puzzle size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              ) : (
                <div className="text-xs text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2.5">
                  还没有已安装的 Agent — 到「更多 → Agent」安装后即可在这里选用
                </div>
              )}
            </div>

            {/* 任务描述（可选备注，不自动发送） */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">任务描述 <span className="text-gray-400">（可选备注，创建后不自动发送）</span></label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="记录这个任务的背景、目标或注意事项…"
                className="w-full resize-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent min-h-[64px]"
                rows={2}
              />
            </div>

            {/* 创建按钮 */}
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99] transition-all text-sm font-medium"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FolderPlus size={16} />
              )}
              创建任务
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreateTaskDialog
