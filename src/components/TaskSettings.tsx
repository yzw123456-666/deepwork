import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Bot,
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
  const { models, updateTask, deleteTask, setCurrentTask, setActivePage } = useAppStore()

  const [taskName, setTaskName] = useState(task.name)
  const [selectedModels, setSelectedModels] = useState<string[]>(task.mainModels || [])

  const enabledModels = models.filter(m => m.enabled)

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) return prev.filter(id => id !== modelId)
      return [...prev, modelId]
    })
  }

  const handleSave = async () => {
    // 空名称会让标题栏与侧边栏显示空白；至少保留一个模型，否则执行时会随便抓一个（可能是已禁用的）
    const name = taskName.trim() || task.name
    const mainModels = selectedModels.length > 0 ? selectedModels : task.mainModels
    try {
      await updateTask(task.id, { name, mainModels })
    } catch (e: any) {
      // 早期版本失败也会关闭弹窗，用户以为保存成功、实际改动没落盘
      window.alert(`保存任务设置失败：${e?.message || e}`)
      return
    }
    onClose()
  }

  const handleDelete = async () => {
    if (window.confirm('确定要删除这个任务吗？')) {
      await deleteTask(task.id)
      setCurrentTask(null)
      // 删除任务后必须离开当前上下文：currentTask 为空会导致依赖它的界面渲染异常
      setActivePage('projects')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] animate-pop-in">
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
