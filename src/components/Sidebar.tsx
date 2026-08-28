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
  Trash2,
  Bot,
  Crown,
  RefreshCw,
} from 'lucide-react'
import { useAppStore } from '../stores'
import ContextRing from './ContextRing'
import { v4 as uuidv4 } from 'uuid'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  onSettings: () => void
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle, onSettings }) => {
  const { t } = useTranslation()
  const {
    conversations,
    currentConversation,
    setCurrentConversation,
    addConversation,
    deleteConversation,
    activePage,
    setActivePage,
    tasks,
    setCurrentTask,
    deleteTask,
  } = useAppStore()

  const menuItems = [
    { id: 'chat', icon: MessageSquare, label: t('nav.assistant') },
    { id: 'projects', icon: FolderOpen, label: t('nav.projects') },
    { id: 'experts', icon: Zap, label: t('nav.experts') },
    { id: 'automation', icon: Workflow, label: t('nav.automation') },
    { id: 'resources', icon: Database, label: t('nav.resources') },
    { id: 'more', icon: MoreHorizontal, label: t('nav.more') },
  ]

  const handleNewTask = () => {
    setActivePage('projects')
  }

  const handleDeleteTask = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const confirmNeeded = (useAppStore.getState().config as any).confirmBeforeDelete ?? true
    if (!confirmNeeded || window.confirm('确定要删除这个任务吗？')) {
      deleteTask(id)
      if (useAppStore.getState().currentTask?.id === id) {
        setCurrentTask(null)
      }
    }
  }

  const handleDeleteConversation = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const confirmNeeded = (useAppStore.getState().config as any).confirmBeforeDelete ?? true
    if (!confirmNeeded || window.confirm('确定要删除这个对话吗？')) {
      deleteConversation(id)
      if (currentConversation?.id === id) {
        setCurrentConversation(null)
      }
    }
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

      {/* Task List - show on chat/projects/experts/automation/resources/more pages */}
      {!collapsed && activePage !== 'taskWorkspace' && (
        <div className="flex-1 overflow-y-auto px-2 py-2 border-t border-gray-100 min-h-[200px]">
          <div className="text-xs font-medium text-gray-400 px-3 py-2">我的任务</div>
          {tasks.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-8">
              暂无任务
              <p className="text-xs text-gray-300 mt-1">点击「新建任务」创建第一个任务</p>
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                onClick={() => {
                  setCurrentTask(task)
                  setActivePage('taskWorkspace')
                }}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-1 ${
                  useAppStore.getState().currentTask?.id === task.id
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <FolderOpen size={14} className="flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{task.name}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[task.status] || ''}`}>
                      {task.status === 'pending' ? '待执行' :
                       task.status === 'running' ? '执行中' :
                       task.status === 'completed' ? '已完成' : '失败'}
                    </span>
                    <span className="text-xs text-gray-400">{formatTime(task.updatedAt)}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteTask(e, task.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
                >
                  <Trash2 size={12} className="text-gray-400" />
                </button>
              </div>
            ))
          )}
        </div>
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
                    <div className="text-[10px] text-gray-400 truncate">
                      {isMainModel ? `主模型 · ${model.provider}` : model.provider}
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
