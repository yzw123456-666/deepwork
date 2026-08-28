import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Bot,
  Zap,
  Check,
  Trash2,
  Save,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Task } from '../types'

interface TaskSettingsProps {
  task: Task
  onClose: () => void
}

const TaskSettings: React.FC<TaskSettingsProps> = ({ task, onClose }) => {
  const { t } = useTranslation()
  const { models, updateTask, deleteTask, setCurrentTask, updateAICapability, aiCapabilities } = useAppStore()

  const [taskName, setTaskName] = useState(task.name)
  const [selectedModels, setSelectedModels] = useState<string[]>(task.mainModels)
  const [capabilities, setCapabilities] = useState<Record<string, string>>({})

  const enabledModels = models.filter(m => m.enabled)

  useEffect(() => {
    // Load existing capabilities
    const caps: Record<string, string> = {}
    models.forEach(m => {
      const existing = aiCapabilities.find(c => c.modelId === m.id)
      caps[m.id] = m.capability || existing?.strengths?.join(', ') || ''
    })
    setCapabilities(caps)
  }, [])

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) return prev.filter(id => id !== modelId)
      return [...prev, modelId]
    })
  }

  const handleSave = async () => {
    await updateTask(task.id, {
      name: taskName,
      mainModels: selectedModels,
    })

    // Save capabilities
    Object.entries(capabilities).forEach(([modelId, cap]) => {
      if (cap.trim()) {
        updateAICapability(modelId, { strengths: cap.split(',').map(s => s.trim()) })
      }
    })

    onClose()
  }

  const handleDelete = async () => {
    if (window.confirm('确定要删除这个任务吗？')) {
      await deleteTask(task.id)
      setCurrentTask(null)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">任务设置</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Task Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">任务名称</label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
            />
          </div>

          {/* Work Folder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">工作文件夹</label>
            <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
              {task.folderPath}
            </div>
          </div>

          {/* 执行模型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Bot size={14} className="inline mr-1" />
              执行模型（第一个为主，其余为备用，失败自动切换）
            </label>
            <div className="space-y-2">
              {enabledModels.map((model) => {
                const selected = selectedModels.includes(model.id)
                const order = selectedModels.indexOf(model.id)
                return (
                  <div
                    key={model.id}
                    onClick={() => toggleModel(model.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                      selected
                        ? 'bg-primary-50 border-2 border-primary-500'
                        : 'bg-white border-2 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm ${
                      selected ? 'bg-primary-500' : 'bg-gray-400'
                    }`}>
                      {model.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 text-sm flex items-center gap-2">
                        {model.name}
                        {model.parameterSize && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded-full">{model.parameterSize}</span>
                        )}
                        {selected && order === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-primary-100 text-primary-600 rounded-full">主用</span>
                        )}
                        {selected && order > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded-full">备用{order}</span>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <Check size={16} className="text-primary-500" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* AI Capabilities + 评估 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">AI 能力与评估</label>
            <p className="text-xs text-gray-500 mb-3">描述每个AI的擅长领域（针对不会说话的模型如图像/视频生成必须手填），软件会自动评估并动态调整</p>
            <div className="space-y-3">
              {selectedModels.map((modelId) => {
                const model = models.find(m => m.id === modelId)
                if (!model) return null
                const cap = aiCapabilities.find(c => c.modelId === modelId)
                const unreliable = (cap?.failureCount || 0) >= 2
                return (
                  <div key={modelId} className={`border rounded-xl p-3 ${unreliable ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
                        {model.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-700 flex items-center gap-2 flex-wrap">
                          {model.name}
                          {model.parameterSize && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded-full">{model.parameterSize}</span>
                          )}
                          {selectedModels.indexOf(modelId) === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary-100 text-primary-600 rounded-full">主用</span>
                          )}
                          {cap?.autoAssessed && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded-full">已自动评估</span>
                          )}
                          {unreliable && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">反复失败×{cap?.failureCount}</span>
                          )}
                        </div>
                        {/* 能力评估数据 */}
                        {cap && cap.taskCount > 0 && (
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500">
                            <span>任务 {cap.taskCount}</span>
                            <span className={cap.successRate >= 70 ? 'text-green-600' : cap.successRate >= 40 ? 'text-yellow-600' : 'text-red-500'}>
                              成功率 {cap.successRate}%
                            </span>
                            <span>综合 {cap.compositeScore}/10</span>
                            <span>评分 {cap.rating}/10</span>
                          </div>
                        )}
                        <input
                          type="text"
                          value={capabilities[modelId] || ''}
                          onChange={(e) => setCapabilities({ ...capabilities, [modelId]: e.target.value })}
                          placeholder="如：代码编写、数据分析、图像生成、文案创作..."
                          className="w-full mt-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <button
            onClick={handleDelete}
            className="px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-1"
          >
            <Trash2 size={14} />
            删除任务
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl transition-colors flex items-center gap-1"
            >
              <Save size={14} />
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TaskSettings
