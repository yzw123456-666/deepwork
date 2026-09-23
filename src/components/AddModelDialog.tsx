import React, { useState } from 'react'
import { X, Eye, EyeOff, Sparkles } from 'lucide-react'
import { Model } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { guessContextWindow } from '../utils/modelContext'

interface AddModelDialogProps {
  model?: Model | null
  onSave: (model: Model) => void | Promise<void>
  onClose: () => void
}

// 快捷预设：点击后预填 Base URL
const PRESETS: Array<{ name: string; baseUrl: string }> = [
  { name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
]

const AddModelDialog: React.FC<AddModelDialogProps> = ({ model, onSave, onClose }) => {
  const [modelName, setModelName] = useState(model?.name || '')
  const [baseUrl, setBaseUrl] = useState(model?.baseUrl || '')
  const [apiKey, setApiKey] = useState(model?.apiKey || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [advanced, setAdvanced] = useState({
    functionCall: model?.advanced?.functionCall ?? false,
    imageInput: model?.advanced?.imageInput ?? false,
    reasoning: model?.advanced?.reasoning ?? false,
    customProtocol: model?.advanced?.customProtocol ?? false,
    inputPrice: model?.advanced?.inputPrice ?? 0,
    outputPrice: model?.advanced?.outputPrice ?? 0,
  })
  const [parameterSize, setParameterSize] = useState(model?.parameterSize || '')
  const [contextWindow, setContextWindow] = useState(model?.contextWindow?.toString() || '')
  // 当前上下文窗口值是否为自动评估结果（用户手动编辑后不再自动覆盖）
  const [ctxAuto, setCtxAuto] = useState(false)

  const handleModelNameChange = (v: string) => {
    setModelName(v)
    const guess = guessContextWindow(v)
    if (guess) {
      setContextWindow(String(guess))
      setCtxAuto(true)
    } else if (ctxAuto) {
      setContextWindow('')
      setCtxAuto(false)
    }
  }

  const handleContextWindowChange = (v: string) => {
    setContextWindow(v)
    setCtxAuto(false)
  }

  const handleSave = () => {
    if (!modelName.trim() || !baseUrl.trim()) return
    // Base URL 必须是合法 http(s) 地址：早期版本只判非空，填 `abc` 能保存，
    // 调用时才报无意义的 "Failed to fetch"，排查成本很高
    const rawUrl = baseUrl.trim()
    let normalizedUrl = rawUrl
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`
    try {
      new URL(normalizedUrl)
    } catch {
      window.alert(`Base URL 不是合法地址：${rawUrl}\n请填写形如 https://api.example.com/v1 的地址`)
      return
    }
    // 上下文窗口：手动值 > 自动评估 > 留空（引擎按 32K 兜底）
    // 必须排除 0/负数：负值会让「已用 >= 窗口*阈值」恒成立，导致每轮都触发压缩、并让 max_tokens 变负
    const parsedCtx = parseInt(contextWindow)
    // 夹到合法区间：手输 100 会让 max_tokens=100，模型一开口就被服务商 400 拒绝
    const clampedCtx = parsedCtx > 0 ? Math.min(Math.max(parsedCtx, 1024), 10_000_000) : 0
    const ctxNum = clampedCtx || (guessContextWindow(modelName) || undefined)
    const newModel: Model = {
      id: model?.id || uuidv4(),
      name: modelName,
      baseUrl: normalizedUrl,
      apiKey: apiKey.trim(),
      enabled: model?.enabled ?? true,
      parameterSize: parameterSize || undefined,
      contextWindow: ctxNum,
      advanced,
    }
    onSave(newModel)
  }

  const inputCls = 'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">{model ? '编辑模型' : '添加模型'}</h2>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">仅支持 OpenAI 兼容协议 API</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Model Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型名称</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => handleModelNameChange(e.target.value)}
              placeholder="输入模型名称，如 deepseek-chat、gpt-4o"
              className={inputCls}
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={inputCls}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setBaseUrl(p.baseUrl)}
                  className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 API Key"
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-800"
                title={showApiKey ? '隐藏' : '显示'}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Parameter Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型参数量</label>
            <input
              type="text"
              value={parameterSize}
              onChange={(e) => setParameterSize(e.target.value)}
              placeholder="如：7B、14B、70B、405B（可留空）"
              className={inputCls}
            />
          </div>

          {/* Context Window */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">上下文窗口</label>
            <input
              type="number" min={1024} max={10000000} step={1024}
              value={contextWindow}
              onChange={(e) => handleContextWindowChange(e.target.value)}
              placeholder="留空自动评估，也可手动填写"
              className={inputCls}
            />
            {ctxAuto && contextWindow && (
              <div className="flex items-center gap-1 mt-1.5 text-xs text-primary-500">
                <Sparkles size={12} />
                已根据模型名自动评估，可手动修改
              </div>
            )}
          </div>

          {/* Advanced Settings */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-sm font-medium text-gray-700 mb-4">高级配置</h4>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              {[
                { key: 'functionCall', label: '工具调用' },
                { key: 'imageInput', label: '图片输入' },
                { key: 'reasoning', label: '推理模式' },
                { key: 'customProtocol', label: '自定义协议' },
              ].map((item) => (
                <label key={item.key} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={advanced[item.key as keyof typeof advanced] as boolean}
                    onChange={(e) => setAdvanced({ ...advanced, [item.key]: e.target.checked })}
                    className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-600 group-hover:text-gray-800">{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">取消</button>
          <button
            onClick={handleSave}
            disabled={!modelName.trim() || !baseUrl.trim()}
            title={!baseUrl.trim() ? '请填写 Base URL' : ''}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddModelDialog
