import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Check,
  Bot,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Task } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface CreateTaskDialogProps {
  onClose: () => void
}

const CreateTaskDialog: React.FC<CreateTaskDialogProps> = ({ onClose }) => {
  const { t } = useTranslation()
  const { models, addTask, setCurrentTask, setActivePage } = useAppStore()

  const [step, setStep] = useState(1)
  const [taskName, setTaskName] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [selectedModels, setSelectedModels] = useState<string[]>([])

  const enabledModels = models.filter(m => m.enabled)

  const handleSelectFolder = async () => {
    const path = await window.electronAPI?.dialog.selectFolder()
    if (path) {
      setFolderPath(path)
    }
  }

  const toggleModel = (modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) return prev.filter(id => id !== modelId)
      return [...prev, modelId]
    })
  }

  const handleCreate = async () => {
    if (!taskName.trim() || !folderPath || selectedModels.length === 0) return

    const newTask: Task = {
      id: uuidv4(),
      name: taskName,
      folderPath,
      mainModels: selectedModels,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      subtasks: [],
    }

    await addTask(newTask)
    setCurrentTask(newTask)
    setActivePage('projects')
    onClose()
  }

  const canProceed = () => {
    if (step === 1) return taskName.trim() && folderPath
    if (step === 2) return selectedModels.length > 0
    return true
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">新建任务</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-3 flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
          <span className={step >= 1 ? 'text-primary-500 font-medium' : ''}>1. 基本信息</span>
          <ChevronRight size={12} />
          <span className={step >= 2 ? 'text-primary-500 font-medium' : ''}>2. 选择模型</span>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">任务名称</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="如：开发一个贪吃蛇游戏"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">工作文件夹</label>
                <button
                  onClick={handleSelectFolder}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-left hover:border-primary-300 transition-colors flex items-center gap-2"
                >
                  <FolderOpen size={16} className="text-gray-400" />
                  {folderPath || '点击选择文件夹...'}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 mb-2">选择执行模型（第一个为主用，其余为备用，失败自动切换）</p>
              {enabledModels.map((model, idx) => {
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
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <button
            onClick={step === 1 ? onClose : () => setStep(step - 1)}
            className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors flex items-center gap-1"
          >
            <ChevronLeft size={14} />
            {step === 1 ? '取消' : '上一步'}
          </button>
          {step < 2 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="px-5 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={!canProceed()}
              className="px-5 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={14} />
              创建任务
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default CreateTaskDialog
