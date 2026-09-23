import React, { useState } from 'react'
import { Plus, Edit2, Trash2, Zap, Check } from 'lucide-react'
import { Model } from '../types'
import { useAppStore } from '../stores'
import AddModelDialog from './AddModelDialog'

// 上下文窗口格式化：1000000 → 1M，200000 → 200K
function formatContext(n?: number): string | null {
  if (!n || n <= 0) return null
  if (n >= 1000000) {
    const m = n / 1000000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
  }
  return `${Math.round(n / 1000)}K`
}

// 模型行右侧徽章（视觉/上下文/参数量 + Function Call 闪电标）
const ModelBadges: React.FC<{ model: Model }> = ({ model }) => (
  <>
    {model.parameterSize && (
      <span className="px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-500 rounded">{model.parameterSize}</span>
    )}
    {model.advanced?.imageInput && (
      <span className="px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-500 rounded">视觉</span>
    )}
    {formatContext(model.contextWindow) && (
      <span className="px-1.5 py-0.5 text-[11px] bg-gray-100 text-gray-500 rounded">{formatContext(model.contextWindow)}</span>
    )}
    {model.advanced?.functionCall && <Zap size={13} className="text-amber-500 fill-amber-400" />}
  </>
)

// ---------- 模型管理（设置 → 模型）：平铺列表，直接管理每个模型的 API 配置 ----------
export default function ModelManager() {
  const { models, updateModel, deleteModel } = useAppStore()

  const [showDialog, setShowDialog] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)

  // 早期版本不 await 也不兜错：写盘失败时弹窗照样关闭，改动重启后凭空消失
  const handleSaveModel = async (model: Model) => {
    try {
      if (editingModel) await updateModel(model.id, model)
      else await useAppStore.getState().addModel(model)
      setShowDialog(false)
      setEditingModel(null)
    } catch (e: any) {
      window.alert(`保存模型失败：${e?.message || e}`)
    }
  }

  const handleDeleteModel = (id: string) => {
    if (!confirm('确定删除该模型吗？')) return
    deleteModel(id)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-700">模型列表</span>
        <button
          onClick={() => { setEditingModel(null); setShowDialog(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors"
        >
          <Plus size={13} /> 添加模型
        </button>
      </div>

      {models.length === 0 ? (
        <div className="border border-gray-200 rounded-xl px-4 py-10 text-center">
          <p className="text-sm text-gray-400">还没有模型，点击右上角「添加模型」</p>
          <p className="text-xs text-gray-400 mt-1">填写 Base URL、API Key 和模型名称即可使用</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
          {models.map((m) => (
            <div key={m.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{m.name}</span>
                    <ModelBadges model={m} />
                    {m.enabled ? (
                      <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded-full">已启用</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">已禁用</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate mt-0.5">{m.baseUrl}</div>
                </div>
                <button
                  onClick={() => updateModel(m.id, { enabled: !m.enabled })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    m.enabled ? 'bg-primary-500' : 'bg-gray-300'
                  }`}
                  title={m.enabled ? '禁用' : '启用'}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                    m.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
                <button
                  onClick={() => { setEditingModel(m); setShowDialog(true) }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors flex-shrink-0"
                  title="编辑模型"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleDeleteModel(m.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors flex-shrink-0"
                  title="删除模型"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showDialog && (
        <AddModelDialog
          model={editingModel}
          onSave={handleSaveModel}
          onClose={() => { setShowDialog(false); setEditingModel(null) }}
        />
      )}
    </div>
  )
}
