import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Eye, EyeOff, ExternalLink, ChevronDown, Check } from 'lucide-react'
import { Model, Provider } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { useAppStore } from '../stores'

const defaultProviders: Provider[] = [
  { id: 'zhipu', name: '智谱开放平台', icon: 'Z', color: 'bg-blue-500', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['GLM-4-Flash', 'GLM-4.6V-Flash', 'GLM-5'] },
  { id: 'moonshot', name: 'Moonshot AI', icon: 'M', color: 'bg-purple-500', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v32k', 'moonshot-v128k'] },
  { id: 'deepseek', name: 'DeepSeek', icon: 'D', color: 'bg-indigo-500', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'openai', name: 'OpenAI', icon: 'O', color: 'bg-green-500', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'ollama', name: 'Ollama', icon: '🦙', color: 'bg-gray-600', baseUrl: 'http://localhost:11434/v1', models: ['llama3.2', 'qwen2.5', 'deepseek-r1'] },
  { id: 'custom', name: '自定义', icon: '⚙', color: 'bg-gray-500', baseUrl: '', models: [] },
]

interface AddModelDialogProps {
  model?: Model | null
  onSave: (model: Model) => void
  onClose: () => void
}

const AddModelDialog: React.FC<AddModelDialogProps> = ({ model, onSave, onClose }) => {
  const { t } = useTranslation()
  const [showApiKey, setShowApiKey] = useState(!((useAppStore.getState().config as any).maskApiKeys ?? true))
  const [showProviderDropdown, setShowProviderDropdown] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [selectedProviderId, setSelectedProviderId] = useState(model?.provider || 'zhipu')
  const [apiKey, setApiKey] = useState(model?.apiKey || '')
  const [modelName, setModelName] = useState(model?.name || '')
  const [customEndpoint, setCustomEndpoint] = useState(model?.baseUrl || '')
  const [advanced, setAdvanced] = useState({
    functionCall: model?.advanced?.functionCall ?? false,
    imageInput: model?.advanced?.imageInput ?? false,
    reasoning: model?.advanced?.reasoning ?? false,
    customProtocol: model?.advanced?.customProtocol ?? false,
    inputPrice: model?.advanced?.inputPrice ?? 0,
    outputPrice: model?.advanced?.outputPrice ?? 0,
  })
  const [capability, setCapability] = useState(model?.capability || '')
  const [parameterSize, setParameterSize] = useState(model?.parameterSize || '')
  const [contextWindow, setContextWindow] = useState(model?.contextWindow?.toString() || '')

  const providerDropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  const currentProvider = defaultProviders.find((p) => p.id === selectedProviderId) || defaultProviders[0]

  useEffect(() => {
    if (!modelName && currentProvider.models.length > 0) {
      setModelName(currentProvider.models[0])
    }
  }, [selectedProviderId])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(event.target as Node)) {
        setShowProviderDropdown(false)
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSave = () => {
    if (!modelName.trim()) return
    const newModel: Model = {
      id: model?.id || uuidv4(),
      name: modelName,
      provider: selectedProviderId,
      apiKey,
      baseUrl: selectedProviderId === 'custom' ? customEndpoint : currentProvider.baseUrl,
      enabled: true,
      parameterSize: parameterSize || undefined,
      contextWindow: contextWindow ? parseInt(contextWindow) || undefined : undefined,
      advanced,
      capability,
    }
    onSave(newModel)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">添加模型</h2>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">仅支持 OpenAI 兼容协议 API</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">提供商</label>
            <div className="relative" ref={providerDropdownRef}>
              <button
                onClick={() => setShowProviderDropdown(!showProviderDropdown)}
                className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${currentProvider.color} text-white rounded-lg flex items-center justify-center text-sm font-bold`}>
                    {currentProvider.icon}
                  </span>
                  <span className="text-gray-700 font-medium">{currentProvider.name}</span>
                </div>
                <ChevronDown size={16} className="text-gray-400" />
              </button>
              {showProviderDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
                  {defaultProviders.map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => {
                        setSelectedProviderId(provider.id)
                        setShowProviderDropdown(false)
                        if (provider.models.length > 0) setModelName(provider.models[0])
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50 transition-colors ${
                        selectedProviderId === provider.id ? 'bg-primary-50' : ''
                      }`}
                    >
                      <span className={`w-8 h-8 ${provider.color} text-white rounded-lg flex items-center justify-center text-sm font-bold`}>
                        {provider.icon}
                      </span>
                      <span className="text-gray-700 flex-1 text-left">{provider.name}</span>
                      {selectedProviderId === provider.id && (
                        <Check size={16} className="text-primary-500" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {currentProvider && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <span className="truncate">{customEndpoint || currentProvider.baseUrl}</span>
                <button className="text-primary-500 hover:underline inline-flex items-center gap-0.5 flex-shrink-0">
                  查看文档
                  <ExternalLink size={10} />
                </button>
              </div>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入你的 API Key"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all pr-12"
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Model Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型名称</label>
            {currentProvider.models.length > 0 ? (
              <div className="relative" ref={modelDropdownRef}>
                <button
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm hover:border-gray-300 transition-colors"
                >
                  <span className="text-gray-700">{modelName || currentProvider.models[0]}</span>
                  <ChevronDown size={16} className="text-gray-400" />
                </button>
                {showModelDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {currentProvider.models.map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setModelName(m)
                          setShowModelDropdown(false)
                        }}
                        className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 transition-colors ${
                          modelName === m ? 'bg-primary-50 text-primary-600' : 'text-gray-700'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="输入模型名称，如 gpt-4o"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
              />
            )}
          </div>

          {/* Custom Endpoint */}
          {selectedProviderId === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">接口地址</label>
              <input
                type="text"
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
              />
            </div>
          )}

          {/* AI Capability */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型参数量</label>
            <input
              type="text"
              value={parameterSize}
              onChange={(e) => setParameterSize(e.target.value)}
              placeholder="如：7B、14B、70B、405B（可留空）"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
            />
            <p className="text-xs text-gray-400 mt-1.5">填写模型参数量，系统会据此分配更合适的任务（大模型处理复杂任务，小模型处理简单任务）</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">上下文窗口</label>
            <input
              type="number" min={1024} max={1000000} step={1024}
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              placeholder="如：4096、32768、128000（留空默认32K）"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
            />
            <p className="text-xs text-gray-400 mt-1.5">模型最大上下文长度，影响对话记忆和回复长度上限</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">擅长能力</label>
            <input
              type="text"
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              placeholder="如：代码编写、数据分析、图像生成、文案创作（留空将自动评估）"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
            />
            <p className="text-xs text-gray-400 mt-1.5">描述该 AI 的擅长领域，多AI合作时帮助主模型分配任务</p>
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
                    onChange={(e) =>
                      setAdvanced({ ...advanced, [item.key]: e.target.checked })
                    }
                    className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-600 group-hover:text-gray-800">{item.label}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 mt-5">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">输入价格</label>
                <input
                  type="number"
                  value={advanced.inputPrice || ''}
                  onChange={(e) => setAdvanced({ ...advanced, inputPrice: Number(e.target.value) })}
                  placeholder="使用提供商默认值"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">输出价格</label>
                <input
                  type="number"
                  value={advanced.outputPrice || ''}
                  onChange={(e) => setAdvanced({ ...advanced, outputPrice: Number(e.target.value) })}
                  placeholder="使用提供商默认值"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!modelName.trim()}
            className="px-5 py-2.5 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddModelDialog
