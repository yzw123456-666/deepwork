import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  Settings,
  Bot,
  Palette,
  Database,
  HardDrive,
  Keyboard,
  Shield,
  Info,
  Edit2,
  Trash2,
  Monitor,
  Globe,
  AlertTriangle,
  RotateCcw,
  Lock,
  FileText,
  Terminal,
  Wifi,
  Download,
  Clock,
  ChevronRight,
  HelpCircle,
  FolderOpen,
  CheckCircle,
  RefreshCw,
  Plus,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Model } from '../types'
import AddModelDialog from './AddModelDialog'

interface SettingsPanelProps {
  onClose: () => void
}

/* ---------- 小组件 ---------- */

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
      checked ? 'bg-primary-500' : 'bg-gray-300'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
)

const SettingRow: React.FC<{
  title: string
  desc?: string
  children?: React.ReactNode
}> = ({ title, desc, children }) => (
  <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-100 last:border-b-0">
    <div className="min-w-0">
      <h4 className="text-sm font-medium text-gray-800">{title}</h4>
      {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
)

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-white border border-gray-200 rounded-xl px-4 py-1 mb-4">{children}</div>
)

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-medium text-gray-700 mb-2 mt-1">{children}</h3>
)

// 树形图组件
interface TreeNodeProps {
  item: any
  level?: number
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
}

const TreeNode: React.FC<TreeNodeProps> = ({ item, level = 0, expandedDirs, toggleDir }) => {
  const isExpanded = expandedDirs.has(item.path)
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
  const formatDate = (d: string) => {
    const date = new Date(d)
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 px-2 hover:bg-gray-50 rounded cursor-pointer group"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => {
          if (item.isDir) {
            toggleDir(item.path)
          } else {
            window.electronAPI?.shell.showItemInFolder(item.path)
          }
        }}
      >
        {item.isDir ? (
          <ChevronRight
            size={14}
            className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-[14px]" />
        )}
        <FileText size={14} className={item.isDir ? 'text-blue-500' : 'text-gray-500'} />
        <span className="text-sm text-gray-700 flex-1 truncate">{item.name}</span>
        {!item.isDir && (
          <span className="text-xs text-gray-400">{formatSize(item.size)}</span>
        )}
        <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatDate(item.modified)}
        </span>
      </div>
      {item.isDir && isExpanded && item.children?.map((child: any) => (
        <TreeNode
          key={child.path}
          item={child}
          level={level + 1}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
        />
      ))}
    </div>
  )
}

/* ---------- 主面板 ---------- */

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { t, i18n } = useTranslation()
  const { models, addModel, updateModel, deleteModel, setConfig, config, updateAICapability, aiCapabilities } = useAppStore()
  const [activeTab, setActiveTab] = useState('models')
  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [dirTree, setDirTree] = useState<any[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [appVersion, setAppVersion] = useState('')
  const [sandboxSection, setSandboxSection] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.app.getInfo().then((info: any) => {
      if (info?.version) setAppVersion(info.version)
    }).catch(() => {})
  }, [])

  // 加载目录树
  const loadDirTree = async () => {
    if (window.electronAPI) {
      const info = await window.electronAPI.app.getInfo()
      const tree = await window.electronAPI.fs.readDirTree(info.userDataPath)
      setDirTree(tree)
      // 默认展开 conversations 目录
      const convDir = tree.find((item: any) => item.name === 'conversations')
      if (convDir) {
        setExpandedDirs(new Set([convDir.path]))
      }
    }
  }

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }

  useEffect(() => {
    if (activeTab === 'data') {
      loadDirTree()
    }
  }, [activeTab])

  const menuItems = [
    { id: 'system', icon: Settings, label: t('settings.title') },
    { id: 'agent', icon: Bot, label: t('settings.agent') },
    { id: 'personalization', icon: Palette, label: t('settings.personalization') },
    { id: 'models', icon: Database, label: t('settings.models') },
    { id: 'data', icon: HardDrive, label: t('settings.data') },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.shortcuts') },
    { id: 'security', icon: Shield, label: t('settings.security') },
    { id: 'about', icon: Info, label: t('settings.about') },
  ]

  /* ---------- 模型管理 ---------- */
  const handleAddModel = async (model: Model) => {
    await addModel(model)
    setShowAddModel(false)

    // 自动能力询问：添加 API 后自动问 AI 擅长什么（用户没手填时）
    if (!model.capability?.trim()) {
      const { probeCapability } = await import('../services/agentEngine')
      const probe = await probeCapability(model)
      if (probe) {
        updateModel(model.id, {
          capability: probe.strengths.join('、'),
        })
        updateAICapability(model.id, {
          strengths: probe.strengths,
          weaknesses: probe.weaknesses,
          rating: probe.rating,
          autoAssessed: true,
        })
      }
    }
  }

  const handleEditModel = async (model: Model) => {
    await updateModel(model.id, model)
    setEditingModel(null)
    setShowAddModel(false)

    // 编辑时如果清空了能力描述，重新自动询问
    if (!model.capability?.trim() && model.enabled) {
      const { probeCapability } = await import('../services/agentEngine')
      const probe = await probeCapability(model)
      if (probe) {
        await updateModel(model.id, { capability: probe.strengths.join('、') })
        updateAICapability(model.id, {
          strengths: probe.strengths,
          weaknesses: probe.weaknesses,
          rating: probe.rating,
          autoAssessed: true,
        })
      }
    }
  }

  const handleDeleteModel = async (modelId: string) => {
    if (!config.confirmBeforeDelete || window.confirm(t('models.deleteConfirm'))) {
      await deleteModel(modelId)
    }
  }

  const getProviderName = (provider: string): string => {
    const names: Record<string, string> = {
      zhipu: '智谱开放平台',
      'zhipu-coding': '智谱 Coding Plan',
      tencent: '腾讯云 Token Plan',
      kimi: 'Kimi Coding Plan',
      deepseek: 'DeepSeek',
      ollama: 'Ollama',
      openai: 'OpenAI',
      custom: '自定义',
    }
    return names[provider] || provider
  }

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    i18n.changeLanguage(lang)
    setConfig({ language: lang })
  }

  /* ---------- 快捷键 ---------- */
  const defaultShortcuts = { shortcutNewChat: 'Ctrl+N', shortcutOpenSettings: 'Ctrl+,', shortcutToggleSidebar: 'Ctrl+B' }
  const shortcutRows: Array<{ id: 'shortcutNewChat' | 'shortcutOpenSettings' | 'shortcutToggleSidebar'; label: string }> = [
    { id: 'shortcutNewChat', label: t('settings.shortcutNewChat') },
    { id: 'shortcutOpenSettings', label: t('settings.shortcutOpenSettings') },
    { id: 'shortcutToggleSidebar', label: t('settings.shortcutToggleSidebar') },
  ]

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setCapturing(null); return }
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        parts.push(keyName)
        setConfig({ [capturing]: parts.join('+') } as any)
        setCapturing(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  /* ---------- 安全中心 ---------- */
  const handleClearAllData = async () => {
    if (!window.confirm(t('settings.clearAllDataConfirm'))) return
    await window.electronAPI?.app.clearAllData()
    window.location.reload()
  }

  const cfg = config as Record<string, any>

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-[950px] h-[650px] flex overflow-hidden">
        {/* Left Menu */}
        <div className="w-56 bg-gray-50 border-r border-gray-200 p-3">
          <div className="mb-4 px-3 py-2">
            <h3 className="text-sm font-semibold text-gray-800">{t('settings.title')}</h3>
          </div>
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors mb-0.5 ${
                activeTab === item.id
                  ? 'bg-primary-50 text-primary-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">
              {menuItems.find((m) => m.id === activeTab)?.label}
            </h2>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {/* Models Tab */}
            {activeTab === 'models' && (
              <div>
                <button
                  onClick={() => { setEditingModel(null); setShowAddModel(true) }}
                  className="mb-4 flex items-center gap-1.5 px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg transition-colors"
                >
                  <Plus size={14} />
                  添加模型
                </button>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* 表头 */}
                  <div className="flex items-center px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
                    <span className="flex-1">模型</span>
                    <span className="w-20 text-center">参数量</span>
                    <span className="w-44">服务商</span>
                    <span className="w-28 text-right">操作</span>
                  </div>

                  {models.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-gray-400 text-sm">暂无模型，点击上方"添加模型"开始</p>
                    </div>
                  ) : (
                    models.map((model, index) => {
                      const providerIcon: Record<string, string> = {
                        zhipu: '⊕', 'zhipu-coding': '⊕', tencent: '☁', kimi: '◆',
                        deepseek: '♦', ollama: '⚙', openai: '○', custom: '✏',
                      }
                      return (
                        <div
                          key={model.id}
                          className={`flex items-center px-4 py-2.5 hover:bg-gray-50 transition-colors ${
                            index < models.length - 1 ? 'border-b border-gray-100' : ''
                          }`}
                        >
                          <div className="flex-1 flex items-center gap-2.5 min-w-0">
                            <span className="text-gray-500 text-base w-5 text-center flex-shrink-0">
                              {providerIcon[model.provider] || '•'}
                            </span>
                            <span className="text-sm text-gray-800 truncate">{model.name}</span>
                          </div>
                          <span className="w-20 text-center text-xs text-gray-500">
                            {model.parameterSize || '-'}
                          </span>
                          <span className="w-44 text-sm text-gray-500 truncate">
                            {getProviderName(model.provider)}
                          </span>
                          <div className="w-28 flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => { setEditingModel(model); setShowAddModel(true) }}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                              title="编辑"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteModel(model.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                            <Toggle
                              checked={model.enabled}
                              onChange={(v) => updateModel(model.id, { enabled: v })}
                            />
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* 单模型任务备用模型 */}
                <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-gray-800">单模型任务备用模型</h4>
                    <p className="text-xs text-gray-500 mt-0.5">单模型任务执行失败时，自动换用备用模型重试</p>
                  </div>
                  <select
                    value={(cfg as any).fallbackModelId ?? ''}
                    onChange={(e) => setConfig({ fallbackModelId: e.target.value })}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 bg-white max-w-[200px]"
                  >
                    <option value="">不启用</option>
                    <option value="auto">自动选择</option>
                    {models.filter(m => m.enabled).map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Agent Tab */}
            {activeTab === 'agent' && (
              <div className="max-w-2xl">
                <SectionTitle>行为</SectionTitle>
                <Card>
                  <SettingRow title={t('settings.agentStreaming')} desc={t('settings.agentStreamingDesc')}>
                    <Toggle
                      checked={cfg.agentStreaming ?? true}
                      onChange={(v) => setConfig({ agentStreaming: v })}
                    />
                  </SettingRow>
                  <SettingRow title={t('settings.agentAutoScroll')}>
                    <Toggle
                      checked={cfg.agentAutoScroll ?? true}
                      onChange={(v) => setConfig({ agentAutoScroll: v })}
                    />
                  </SettingRow>
                </Card>

                <SectionTitle>生成参数</SectionTitle>
                <Card>
                  <div className="py-3 border-b border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-gray-800">{t('settings.agentTemperature')}</h4>
                      <span className="text-xs text-primary-600 font-medium">{cfg.agentTemperature ?? 0.7}</span>
                    </div>
                    <input
                      type="range" min={0} max={2} step={0.1}
                      value={cfg.agentTemperature ?? 0.7}
                      onChange={(e) => setConfig({ agentTemperature: parseFloat(e.target.value) })}
                      className="w-full accent-primary-500"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{t('settings.agentTemperatureLow')}</span>
                      <span>{t('settings.agentTemperatureHigh')}</span>
                    </div>
                  </div>
                </Card>

                <SectionTitle>{t('settings.agentSystemPrompt')}</SectionTitle>
                <Card>
                  <div className="py-3">
                    <p className="text-xs text-gray-500 mb-2">{t('settings.agentSystemPromptDesc')}</p>
                    <textarea
                      value={cfg.agentSystemPrompt ?? ''}
                      onChange={(e) => setConfig({ agentSystemPrompt: e.target.value })}
                      placeholder={t('settings.agentSystemPromptPlaceholder')}
                      rows={4}
                      className="w-full resize-none px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-300"
                    />
                  </div>
                </Card>
              </div>
            )}

            {/* Personalization Tab */}
            {activeTab === 'personalization' && (
              <div className="max-w-2xl">
                <SectionTitle>显示</SectionTitle>
                <Card>
                  <div className="py-3 border-b border-gray-100">
                    <h4 className="text-sm font-medium text-gray-800 mb-3">{t('settings.fontSize')}</h4>
                    <div className="flex gap-2">
                      {(['small', 'medium', 'large'] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setConfig({ fontSize: size })}
                          className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${
                            (cfg.fontSize ?? 'medium') === size
                              ? 'bg-primary-50 border-primary-300 text-primary-600'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {t(`settings.fontSize${size.charAt(0).toUpperCase()}${size.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SettingRow title={t('settings.showTimestamp')}>
                    <Toggle
                      checked={cfg.showTimestamp ?? false}
                      onChange={(v) => setConfig({ showTimestamp: v })}
                    />
                  </SettingRow>
                </Card>

                <SectionTitle>输入</SectionTitle>
                <Card>
                  <div className="py-3">
                    <h4 className="text-sm font-medium text-gray-800 mb-3">{t('settings.sendKey')}</h4>
                    <div className="space-y-2">
                      {(['enter', 'ctrlEnter'] as const).map((mode) => (
                        <label
                          key={mode}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            (cfg.sendKey ?? 'enter') === mode
                              ? 'border-primary-300 bg-primary-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="radio" name="sendKey" className="accent-primary-500"
                            checked={(cfg.sendKey ?? 'enter') === mode}
                            onChange={() => setConfig({ sendKey: mode })}
                          />
                          <span className="text-sm text-gray-700">
                            {mode === 'enter' ? t('settings.sendKeyEnter') : t('settings.sendKeyCtrlEnter')}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </Card>

                <SectionTitle>语言</SectionTitle>
                <Card>
                  <div className="py-3 flex gap-3">
                    <button
                      onClick={() => handleLanguageChange('zh')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                        i18n.language === 'zh'
                          ? 'bg-primary-50 border-primary-300 text-primary-600'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Globe size={16} /><span>简体中文</span>
                    </button>
                    <button
                      onClick={() => handleLanguageChange('en')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                        i18n.language === 'en'
                          ? 'bg-primary-50 border-primary-300 text-primary-600'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Globe size={16} /><span>English</span>
                    </button>
                  </div>
                </Card>

                <SectionTitle>外观</SectionTitle>
                <Card>
                  <div className="py-3 flex gap-3">
                    <button className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-white border-primary-300 text-primary-600">
                      <Monitor size={16} /><span>浅色模式</span>
                    </button>
                  </div>
                </Card>
              </div>
            )}

            {/* Shortcuts Tab */}
            {activeTab === 'shortcuts' && (
              <div className="max-w-2xl">
                <SectionTitle>键盘快捷键</SectionTitle>
                <Card>
                  {shortcutRows.map(({ id, label }) => (
                    <SettingRow key={id} title={label}>
                      <button
                        onClick={() => setCapturing(id)}
                        className={`min-w-[120px] px-3 py-1.5 rounded-lg border text-sm font-mono transition-colors ${
                          capturing === id
                            ? 'border-primary-400 bg-primary-50 text-primary-600 animate-pulse'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {capturing === id
                          ? t('settings.shortcutPressKeys')
                          : (cfg[id] ?? defaultShortcuts[id])}
                      </button>
                    </SettingRow>
                  ))}
                  {capturing && (
                    <p className="py-2 text-xs text-gray-400">{t('settings.shortcutEscToCancel')}</p>
                  )}
                </Card>
                <button
                  onClick={() =>
                    setConfig(defaultShortcuts as any)
                  }
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <RotateCcw size={14} />
                  {t('settings.resetShortcuts')}
                </button>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === 'security' && (
              <div className="space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800">安全中心</h2>
                    <p className="text-xs text-gray-500 mt-0.5">统一管理工作空间内的进程安全、数据安全与系统授权</p>
                  </div>
                  <span className="text-xs text-gray-400 mt-1">安全能力由本地运行时提供</span>
                </div>

                {/* Sandbox + Data Security two-column layout */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: Sandbox Security */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-hidden">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Shield size={18} className="text-primary-500" />
                        <h3 className="text-sm font-medium text-gray-800">沙箱安全</h3>
                        <HelpCircle size={14} className="text-gray-400" />
                      </div>
                      <Toggle
                        checked={(cfg as any).sandboxEnabled ?? true}
                        onChange={(v) => setConfig({ sandboxEnabled: v })}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mb-3">AI 运行于隔离沙箱，并配置文件、命令、网络访问策略</p>

                    {/* Sub-items */}
                    <div className="space-y-0 border-t border-gray-100">
                      {/* 文件安全 */}
                      <div className="border-b border-gray-100">
                        <button
                          onClick={() => setSandboxSection(sandboxSection === 'file' ? null : 'file')}
                          className="w-full flex items-center justify-between py-3 hover:bg-gray-50 rounded-lg px-1 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <FileText size={14} className="text-gray-500" />
                            <div className="text-left">
                              <div className="text-sm text-gray-700">文件安全</div>
                              <div className="text-xs text-gray-400">为沙箱拦截后的文件路径配置白名单和黑名单</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className={`text-gray-400 transition-transform ${sandboxSection === 'file' ? 'rotate-90' : ''}`} />
                        </button>
                        {sandboxSection === 'file' && (
                          <div className="px-1 pb-3 space-y-2">
                            <div>
                              <label className="text-xs text-gray-500">白名单（每行一个路径，允许访问）</label>
                              <textarea
                                value={(cfg as any).fileWhitelist ?? ''}
                                onChange={(e) => setConfig({ fileWhitelist: e.target.value })}
                                placeholder={'如：\nC:/Users/公共/文档\nD:/共享文件'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">黑名单（每行一个路径，禁止访问）</label>
                              <textarea
                                value={(cfg as any).fileBlacklist ?? ''}
                                onChange={(e) => setConfig({ fileBlacklist: e.target.value })}
                                placeholder={'如：\nC:/Windows\nC:/Program Files'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 命令安全 */}
                      <div className="border-b border-gray-100">
                        <button
                          onClick={() => setSandboxSection(sandboxSection === 'cmd' ? null : 'cmd')}
                          className="w-full flex items-center justify-between py-3 hover:bg-gray-50 rounded-lg px-1 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Terminal size={14} className="text-gray-500" />
                            <div className="text-left">
                              <div className="text-sm text-gray-700">命令安全</div>
                              <div className="text-xs text-gray-400">为命令前缀配置询问和放行名单</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className={`text-gray-400 transition-transform ${sandboxSection === 'cmd' ? 'rotate-90' : ''}`} />
                        </button>
                        {sandboxSection === 'cmd' && (
                          <div className="px-1 pb-3 space-y-2">
                            <div>
                              <label className="text-xs text-gray-500">放行名单（每行一个前缀，直接执行不询问）</label>
                              <textarea
                                value={(cfg as any).cmdAllowList ?? ''}
                                onChange={(e) => setConfig({ cmdAllowList: e.target.value })}
                                placeholder={'如：\nls\ncat\nnode --version'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">询问名单（每行一个前缀，执行前询问用户）</label>
                              <textarea
                                value={(cfg as any).cmdAskList ?? ''}
                                onChange={(e) => setConfig({ cmdAskList: e.target.value })}
                                placeholder={'如：\nnpm install\npip install\nrm'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 网络安全 */}
                      <div>
                        <button
                          onClick={() => setSandboxSection(sandboxSection === 'net' ? null : 'net')}
                          className="w-full flex items-center justify-between py-3 hover:bg-gray-50 rounded-lg px-1 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <Wifi size={14} className="text-gray-500" />
                            <div className="text-left">
                              <div className="text-sm text-gray-700">网络安全</div>
                              <div className="text-xs text-gray-400">控制 URL 访问与沙箱网络域名规则</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className={`text-gray-400 transition-transform ${sandboxSection === 'net' ? 'rotate-90' : ''}`} />
                        </button>
                        {sandboxSection === 'net' && (
                          <div className="px-1 pb-3 space-y-2">
                            <div>
                              <label className="text-xs text-gray-500">允许的域名（每行一个，如 api.example.com）</label>
                              <textarea
                                value={(cfg as any).netAllowedDomains ?? ''}
                                onChange={(e) => setConfig({ netAllowedDomains: e.target.value })}
                                placeholder={'如：\napi.deepseek.com\napi.skillhub.cn'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">禁止的域名（每行一个）</label>
                              <textarea
                                value={(cfg as any).netBlockedDomains ?? ''}
                                onChange={(e) => setConfig({ netBlockedDomains: e.target.value })}
                                placeholder={'如：\nexample.com\ntracker.example.net'}
                                rows={3}
                                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 font-mono"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Data Security */}
                  <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                      <Lock size={18} className="text-green-500" />
                      <h3 className="text-sm font-medium text-gray-800">数据安全</h3>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">数据流转及删除行为的安全防护</p>

                    <div className="space-y-3">
                      {/* 安全网关 */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-700">安全网关</div>
                          <div className="text-xs text-gray-500">工作空间出入流量统一经过安全网关安全处理</div>
                        </div>
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已开启</span>
                      </div>

                      {/* 传输加密 */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-700">传输加密</div>
                          <div className="text-xs text-gray-500">本地与云端通信使用端到端加密通道</div>
                        </div>
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">已开启</span>
                      </div>

                      {/* 删除保护 */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-700">删除保护</div>
                          <div className="text-xs text-gray-500">开启后优先移到废纸篓/回收站，关闭后按系统删除</div>
                        </div>
                        <Toggle
                          checked={(cfg as any).deleteProtection ?? true}
                          onChange={(v) => setConfig({ deleteProtection: v })}
                        />
                      </div>

                      {/* 批量删除审批 */}
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium text-gray-700">批量删除审批</div>
                          <div className="text-xs text-gray-500">需开启删除保护，一次删除达到该数量时需要审批</div>
                        </div>
                        <input
                          type="number"
                          value={(cfg as any).batchDeleteThreshold ?? 50}
                          onChange={(e) => setConfig({ batchDeleteThreshold: parseInt(e.target.value) || 50 })}
                          className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 text-center"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Auto Backup */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 overflow-hidden">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Database size={18} className="text-primary-500" />
                      <h3 className="text-sm font-medium text-gray-800">自动备份</h3>
                      <HelpCircle size={14} className="text-gray-400" />
                    </div>
                    <Toggle
                      checked={(cfg as any).autoBackup ?? true}
                      onChange={(v) => setConfig({ autoBackup: v })}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mb-3">每轮对话修改文件之前自动备份</p>
                  <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">备份总上限</span>
                      <input
                        type="number"
                        value={(cfg as any).backupMaxSize ?? 3000}
                        onChange={(e) => setConfig({ backupMaxSize: parseInt(e.target.value) || 3000 })}
                        className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 text-center"
                      />
                      <span className="text-xs text-gray-500">MB</span>
                    </div>
                    <button
                      onClick={() => window.electronAPI?.shell.openPath((useAppStore.getState().appInfo?.userDataPath || '') + '/conversations')}
                      className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors ml-auto"
                    >
                      <FolderOpen size={14} />
                      打开备份目录
                    </button>
                  </div>
                </div>

                {/* System Tools */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Monitor size={18} className="text-purple-500" />
                      <div>
                        <h3 className="text-sm font-medium text-gray-800">系统级工具</h3>
                        <p className="text-xs text-gray-500">WSL、wmic、sc、reg、schtasks 等系统级工具可绕过沙箱限制，请谨慎启用</p>
                      </div>
                    </div>
                    <select
                      value={(cfg as any).systemTools ?? 'disabled'}
                      onChange={(e) => setConfig({ systemTools: e.target.value as 'disabled' | 'enabled' })}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 bg-white"
                    >
                      <option value="disabled">禁用</option>
                      <option value="enabled">启用</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* System Tab */}

            {/* Data Tab */}
            {activeTab === 'data' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">数据管理</h2>
                  <p className="text-xs text-gray-500 mt-0.5">管理工作空间内的所有文件和数据</p>
                </div>

                {/* Storage overview */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Database size={16} className="text-blue-500" />
                      <span className="text-sm font-medium text-gray-700">模型配置</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-800">{models.length}</div>
                    <div className="text-xs text-gray-500">个模型</div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText size={16} className="text-green-500" />
                      <span className="text-sm font-medium text-gray-700">对话记录</span>
                    </div>
                    <div className="text-2xl font-bold text-gray-800">{useAppStore.getState().conversations.length}</div>
                    <div className="text-xs text-gray-500">个对话</div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <HardDrive size={16} className="text-purple-500" />
                      <span className="text-sm font-medium text-gray-700">存储路径</span>
                    </div>
                    <div className="text-sm text-gray-600 truncate" title={useAppStore.getState().appInfo?.userDataPath || ''}>
                      {useAppStore.getState().appInfo?.userDataPath ? '...' + useAppStore.getState().appInfo!.userDataPath.slice(-25) : '加载中'}
                    </div>
                  </div>
                </div>

                {/* Directory Tree */}
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={18} className="text-orange-500" />
                      <div>
                        <h3 className="text-sm font-medium text-gray-800">文件结构</h3>
                        <p className="text-xs text-gray-500">点击文件夹展开/折叠，点击文件在资源管理器中定位</p>
                      </div>
                    </div>
                    <button
                      onClick={loadDirTree}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <RefreshCw size={12} />
                      刷新
                    </button>
                  </div>

                  <div className="border border-gray-100 rounded-lg max-h-[480px] overflow-y-auto bg-gray-50/50">
                    {dirTree.length === 0 ? (
                      <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
                    ) : (
                      dirTree.map((item: any) => (
                        <TreeNode
                          key={item.path}
                          item={item}
                          expandedDirs={expandedDirs}
                          toggleDir={toggleDir}
                        />
                      ))
                    )}
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-medium text-red-700">{t('settings.clearAllData')}</h4>
                      <p className="text-xs text-red-500 mt-0.5 mb-3">{t('settings.clearAllDataDesc')}</p>
                      <button
                        onClick={handleClearAllData}
                        className="px-4 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 transition-colors"
                      >
                        {t('settings.clearAllData')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* System Tab */}
            {activeTab === 'system' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <SectionTitle>语言设置</SectionTitle>
                  <Card>
                    <div className="py-3 flex gap-3">
                      <button
                        onClick={() => handleLanguageChange('zh')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                          i18n.language === 'zh'
                            ? 'bg-primary-50 border-primary-300 text-primary-600'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Globe size={16} /><span>简体中文</span>
                      </button>
                      <button
                        onClick={() => handleLanguageChange('en')}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                          i18n.language === 'en'
                            ? 'bg-primary-50 border-primary-300 text-primary-600'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <Globe size={16} /><span>English</span>
                      </button>
                    </div>
                  </Card>
                </div>
                <div>
                  <SectionTitle>外观</SectionTitle>
                  <Card>
                    <div className="py-3 flex gap-3">
                      <button className="flex items-center gap-2 px-4 py-2 rounded-lg border bg-white border-primary-300 text-primary-600">
                        <Monitor size={16} /><span>浅色模式</span>
                      </button>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="text-white text-2xl font-bold">M</span>
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">Many AI</h2>
                <p className="text-sm text-gray-500 mb-1">版本 {appVersion}</p>
                <p className="text-xs text-gray-400 mb-4">完成于 2026年08月27日</p>
                <p className="text-sm text-gray-600 max-w-md mx-auto mb-4">
                  多智能体桌面应用，支持多模型协作完成复杂任务。
                </p>
                <div className="text-xs text-gray-400 space-y-1">
                  <p>Electron + React + TypeScript + Tailwind CSS</p>
                  <p>GitHub: yzw123456-666/many-agent</p>
                </div>
              </div>
            )}

            {/* Placeholder for other tabs */}
            {!['models', 'system', 'about', 'agent', 'personalization', 'memory', 'shortcuts', 'security'].includes(activeTab) && (
              <div className="text-center py-12">
                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  {React.createElement(menuItems.find((m) => m.id === activeTab)?.icon || Settings, {
                    size: 24,
                    className: 'text-gray-400',
                  })}
                </div>
                <p className="text-gray-500 text-sm">
                  {menuItems.find((m) => m.id === activeTab)?.label} 设置
                </p>
                <p className="text-gray-400 text-xs mt-1">功能开发中...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddModel && (
        <AddModelDialog
          model={editingModel}
          onSave={editingModel ? handleEditModel : handleAddModel}
          onClose={() => {
            setShowAddModel(false)
            setEditingModel(null)
          }}
        />
      )}
    </div>
  )
}

export default SettingsPanel
