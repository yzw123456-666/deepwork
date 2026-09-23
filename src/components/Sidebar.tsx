import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  MessageSquare,
  FolderOpen,
  Zap,
  Workflow,
  Database,
  MoreHorizontal,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  Crown,
  RefreshCw,
  Pencil,
  FolderOpenDot,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Conversation, Task } from '../types'
import ContextRing from './ContextRing'
import { v4 as uuidv4 } from 'uuid'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onSettings: () => void
}

// 任务行「⋯」菜单项
interface TaskMenuState {
  taskId: string
  x: number
  y: number
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, onSettings }) => {
  const { t } = useTranslation()
  const {
    conversations,
    currentConversation,
    setCurrentConversation,
    addConversation,
    updateConversation,
    deleteConversation,
    activePage,
    setActivePage,
    tasks,
    setCurrentTask,
    deleteTask,
    updateTask,
  } = useAppStore()

  const menuItems = [
    { id: 'chat', icon: MessageSquare, label: t('nav.assistant') },
    { id: 'projects', icon: FolderOpen, label: t('nav.projects') },
    { id: 'experts', icon: Zap, label: t('nav.experts') },
    { id: 'automation', icon: Workflow, label: t('nav.automation') },
    { id: 'resources', icon: Database, label: t('nav.resources') },
    { id: 'more', icon: MoreHorizontal, label: t('nav.more') },
  ]

  /* ---------- 树形任务列表状态 ---------- */
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [taskMenu, setTaskMenu] = useState<TaskMenuState | null>(null)
  // 行内重命名：editing = { type: 'task' | 'conv', id, value }
  const [editing, setEditing] = useState<{ type: 'task' | 'conv'; id: string; value: string } | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      // 等输入框渲染后聚焦并全选
      requestAnimationFrame(() => {
        editInputRef.current?.focus()
        editInputRef.current?.select()
      })
    }
  }, [editing?.id])

  const toggleExpanded = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const handleNewTask = () => {
    setActivePage('projects')
  }

  /* ---------- 对话归属 ---------- */
  // 按任务分组：taskId → 该任务下的对话（按更新时间倒序）
  const convsByTask = new Map<string, Conversation[]>()
  const standaloneConvs: Conversation[] = []
  for (const c of conversations) {
    if (c.taskId) {
      const list = convsByTask.get(c.taskId) || []
      list.push(c)
      convsByTask.set(c.taskId, list)
    } else {
      standaloneConvs.push(c)
    }
  }
  for (const list of convsByTask.values()) {
    list.sort((a, b) => b.updatedAt - a.updatedAt)
  }
  standaloneConvs.sort((a, b) => b.updatedAt - a.updatedAt)

  /* ---------- 操作 ---------- */
  const confirmNeeded = () => (useAppStore.getState().config as any).confirmBeforeDelete ?? true

  const handleDeleteTask = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    if (!confirmNeeded() || window.confirm(`确定要删除任务「${task.name}」吗？\n（任务下的对话会保留，变为独立对话）`)) {
      // 任务下对话的解绑由 store.deleteTask 统一处理
      deleteTask(task.id)
      if (useAppStore.getState().currentTask?.id === task.id) {
        setCurrentTask(null)
      }
    }
    setTaskMenu(null)
  }

  const handleOpenTaskFolder = async (task: Task) => {
    setTaskMenu(null)
    if (!task.folderPath) {
      window.alert('该任务没有关联的工作文件夹')
      return
    }
    const r = await window.electronAPI?.shell.openPath(task.folderPath)
    // 文件夹被移动/删除时给出明确提示，而不是点了没反应
    if (r && r.ok === false) window.alert(`打开失败：${r.error || '路径不存在'}`)
  }

  const handleStartRenameTask = (task: Task) => {
    setEditing({ type: 'task', id: task.id, value: task.name })
    setTaskMenu(null)
  }

  const handleStartRenameConv = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation()
    setEditing({ type: 'conv', id: conv.id, value: conv.title })
  }

  const commitRename = () => {
    if (!editing) return
    const name = editing.value.trim()
    if (name) {
      if (editing.type === 'task') {
        updateTask(editing.id, { name })
      } else {
        updateConversation(editing.id, { title: name })
      }
    }
    setEditing(null)
  }

  const handleDeleteConversation = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirmNeeded() || window.confirm('确定要删除这个对话吗？')) {
      deleteConversation(id)
      if (currentConversation?.id === id) {
        setCurrentConversation(null)
      }
    }
  }

  // 在任务下新建对话，并打开聊天页
  const handleNewConversationInTask = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    const conv: Conversation = {
      id: uuidv4(),
      title: '新对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      taskId: task.id,
    }
    addConversation(conv)
    // 必须同时设为当前对话：否则聊天页还停留在上一个对话，新建的「新对话」看起来没反应
    setCurrentConversation(conv)
    setActivePage('chat')
    setExpandedTasks(prev => new Set(prev).add(task.id))
  }

  const openConversation = (conv: Conversation) => {
    if (editing?.id === conv.id) return
    setCurrentConversation(conv)
    setActivePage('chat')
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN')
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-500',
    running: 'bg-blue-100 text-blue-500',
    completed: 'bg-green-100 text-green-600',
    failed: 'bg-red-100 text-red-500',
  }

  // 点击空白处关闭「⋯」菜单
  useEffect(() => {
    if (!taskMenu) return
    const close = () => setTaskMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTaskMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [taskMenu])

  // AI Status Panel
  const { models, checkModelStatus, modelStatus, modelContextUsage } = useAppStore()
  const [checking, setChecking] = useState<string | null>(null)
  const checkingRef = useRef(false)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const checkAll = async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    for (const m of useAppStore.getState().models.filter(m => m.enabled)) {
      setChecking(m.id)
      await useAppStore.getState().checkModelStatus(m.id)
    }
    setChecking(null)
    checkingRef.current = false
  }

  // 实时自动检测：启动时检测一次，之后每 60 秒自动检测
  useEffect(() => {
    const timer = setTimeout(() => { checkAll() }, 2000)
    const interval = setInterval(() => { checkAll() }, 60000)
    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [])

  // 主模型集合：出现在任意任务 mainModels 中的模型
  const mainModelIds = new Set(tasks.flatMap(t => t.mainModels || []))

  // 排序：主模型在最上面，其余按名称
  const enabledModels = models
    .filter(m => m.enabled)
    .sort((a, b) => {
      const aMain = mainModelIds.has(a.id) ? 0 : 1
      const bMain = mainModelIds.has(b.id) ? 0 : 1
      if (aMain !== bMain) return aMain - bMain
      return a.name.localeCompare(b.name)
    })

  const handleCheckModel = async (modelId: string) => {
    setChecking(modelId)
    await checkModelStatus(modelId)
    setChecking(null)
  }

  const handleCheckAll = async () => {
    await checkAll()
  }

  /* ---------- 渲染：任务下的对话行 ---------- */
  const renderConversationRow = (conv: Conversation, nested: boolean) => {
    const isActive = currentConversation?.id === conv.id && activePage === 'chat'
    return (
      <div
        key={conv.id}
        onClick={() => openConversation(conv)}
        className={`group flex items-center gap-2 rounded-lg cursor-pointer transition-colors mb-0.5 ${
          nested ? 'pl-8 pr-2 py-1.5 ml-2' : 'pl-3 pr-2 py-2'
        } ${
          isActive
            ? 'bg-primary-50 text-primary-600'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <MessageSquare size={13} className={`flex-shrink-0 ${isActive ? 'text-primary-500' : 'text-gray-400'}`} />
        {editing?.type === 'conv' && editing.id === conv.id ? (
          <input
            ref={editInputRef}
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setEditing(null)
            }}
            onBlur={commitRename}
            className="flex-1 min-w-0 text-sm px-1.5 py-0.5 border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
          />
        ) : (
          <div className="flex-1 min-w-0 text-sm truncate">{conv.title || '新对话'}</div>
        )}
        <span className="text-[10px] text-gray-500 group-hover:hidden whitespace-nowrap">{formatTime(conv.updatedAt)}</span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button
            onClick={(e) => handleStartRenameConv(e, conv)}
            title="重命名"
            className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-800"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => handleDeleteConversation(e, conv.id)}
            title="删除对话"
            className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-red-500"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    )
  }

  /* ---------- 渲染：任务行 ---------- */
  const renderTaskRow = (task: Task) => {
    const expanded = expandedTasks.has(task.id)
    const nestedConvs = convsByTask.get(task.id) || []
    const isActive = useAppStore.getState().currentConversation?.taskId === task.id
    return (
      <div key={task.id} className="mb-0.5">
        <div
          onClick={() => {
            if (editing?.id === task.id) return
            // 点击任务仅展开/收起其下对话列表；任务本身不跳转、不直接对话（对话功能只在任务下的对话条目）
            toggleExpanded(task.id)
          }}
          className={`group flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isActive
              ? 'bg-primary-50 text-primary-600'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(task.id) }}
            className={`p-0.5 rounded hover:bg-gray-200 text-gray-400 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}
            title={expanded ? '收起' : '展开对话'}
          >
            <ChevronDown size={14} />
          </button>
          <FolderOpen size={14} className={`flex-shrink-0 ${isActive ? 'text-primary-500' : 'text-gray-400'}`} />
          <div className="flex-1 min-w-0">
            {editing?.type === 'task' && editing.id === task.id ? (
              <input
                ref={editInputRef}
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={commitRename}
                className="w-full text-sm px-1.5 py-0.5 border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
              />
            ) : (
              <div className="text-sm truncate leading-tight">{task.name}</div>
            )}
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[task.status] || ''}`}>
                {task.status === 'pending' ? '待执行' :
                 task.status === 'running' ? '执行中' :
                 task.status === 'completed' ? '已完成' : '失败'}
              </span>
              {nestedConvs.length > 0 && (
                <span className="text-[10px] text-gray-500">{nestedConvs.length} 对话</span>
              )}
              <span className="text-xs text-gray-400 group-hover:hidden">{formatTime(task.updatedAt)}</span>
            </div>
          </div>
          {/* 悬停操作：新建对话 / 更多 */}
          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={(e) => handleNewConversationInTask(e, task)}
              title="在此任务下新建对话"
              className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-primary-600"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setTaskMenu({ taskId: task.id, x: rect.right, y: rect.bottom + 4 })
              }}
              title="更多操作"
              className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
        {/* 展开的对话列表 */}
        {expanded && nestedConvs.length > 0 && (
          <div className="border-l border-gray-100 ml-4">
            {nestedConvs.map(c => renderConversationRow(c, true))}
          </div>
        )}
        {expanded && nestedConvs.length === 0 && (
          <div className="ml-8 pl-2 py-1.5 text-xs text-gray-500">暂无对话，点击 + 新建</div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* New Task Button */}
      <div className="p-3">
        <button
          onClick={handleNewTask}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors ${
            collapsed ? 'px-2' : ''
          }`}
        >
          <Plus size={18} />
          {!collapsed && <span className="text-sm font-medium">新建任务</span>}
        </button>
      </div>

      {/* Navigation Menu */}
      <div className="px-2 pb-2">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActivePage(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
              activePage === item.id
                ? 'bg-primary-50 text-primary-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <item.icon size={18} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </div>

      {/* 任务树（任务 → 对话）+ 独立对话 - show on chat/projects/experts/automation/resources/more pages */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2 py-2 border-t border-gray-100 min-h-[200px]">
          <div className="text-xs font-medium text-gray-400 px-3 py-2">我的任务</div>
          {tasks.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-6">
              暂无任务
              <p className="text-xs text-gray-500 mt-1">点击「新建任务」创建第一个任务</p>
            </div>
          ) : (
            tasks.map(renderTaskRow)
          )}

          {/* 独立对话（不属于任何任务） */}
          {standaloneConvs.length > 0 && (
            <>
              <div className="text-xs font-medium text-gray-400 px-3 py-2 mt-2">对话</div>
              {standaloneConvs.map(c => renderConversationRow(c, false))}
            </>
          )}
        </div>
      )}

      {/* 任务「⋯」菜单（浮层） */}
      {taskMenu && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setTaskMenu(null)} />
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-40"
            style={{
              left: Math.max(8, Math.min(taskMenu.x - 150, window.innerWidth - 170)),
              top: Math.max(8, Math.min(taskMenu.y, window.innerHeight - 140)),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {(() => {
              const task = tasks.find(t => t.id === taskMenu.taskId)
              if (!task) return null
              return (
                <>
                  <button
                    onClick={() => handleStartRenameTask(task)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <Pencil size={14} className="text-gray-500" />
                    重命名
                  </button>
                  <button
                    onClick={() => handleOpenTaskFolder(task)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    <FolderOpenDot size={14} className="text-gray-500" />
                    打开任务文件夹
                  </button>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={(e) => handleDeleteTask(e, task)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    删除任务
                  </button>
                </>
              )
            })()}
          </div>
        </>
      )}

      {/* AI Status Panel */}
      {!collapsed && models.length > 0 && (
        <div className="border-t border-gray-100 px-2 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gray-400">AI 状态</div>
            <button
              onClick={handleCheckAll}
              disabled={checking !== null}
              className="text-xs text-primary-500 hover:text-primary-700 flex items-center gap-1"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              全部检测
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {enabledModels.map((model) => {
              const status = modelStatus[model.id]
              const isOnline = status?.online
              const isChecking = checking === model.id
              const isMainModel = mainModelIds.has(model.id)
              return (
                <div key={model.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    isChecking ? 'bg-gray-300 animate-pulse' : (isOnline ? 'bg-green-500' : 'bg-red-500')
                  }`} title={isOnline ? '在线' : '离线'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate font-medium text-gray-700 flex items-center gap-1">
                      <span className="truncate">{model.name}</span>
                      {isMainModel && <span title="主模型" className="flex-shrink-0"><Crown size={12} className="text-amber-500" /></span>}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {isMainModel ? '主模型' : model.parameterSize || ''}
                    </div>
                  </div>
                  {modelContextUsage[model.id] && (
                    <ContextRing used={modelContextUsage[model.id].used} max={modelContextUsage[model.id].max} size={16} />
                  )}
                  <button
                    onClick={() => handleCheckModel(model.id)}
                    disabled={isChecking}
                    className="text-xs text-primary-500 hover:text-primary-700 opacity-60 hover:opacity-100 whitespace-nowrap"
                  >
                    {isChecking ? '检测中...' : '检测'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Bottom Actions */}
      <div className="border-t border-gray-200 p-2">
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
        >
          <Settings size={18} />
          {!collapsed && <span>{t('nav.settings')}</span>}
        </button>
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center py-2 text-gray-400 hover:text-gray-600 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </div>
  )
}

export default Sidebar
