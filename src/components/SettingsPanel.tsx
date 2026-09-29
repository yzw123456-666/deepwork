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
  MessageSquare,
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
  Brain,
  Sun,
  Moon,
  Image as ImageIcon,
  Video as VideoIcon,
  FileCode,
  Link2,
  Pencil,
  User,
} from 'lucide-react'
import { useAppStore } from '../stores'
import { Model, MemoryEntry } from '../types'
import { BUILTIN_WALLPAPERS } from '../services/builtinWallpapers'
import { REPLY_STYLES } from '../services/persona'
import AppLogo from './AppLogo'
import AddModelDialog from './AddModelDialog'
import ModelManager from './ModelManager'
import { v4 as uuidv4 } from 'uuid'

interface SettingsPanelProps {
  onClose: () => void
  /** 独立窗口模式（2026-09-25）：铺满整个窗口、无黑遮罩圆角卡片，onClose = 关闭窗口 */
  standalone?: boolean
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

/* ---------- 主题选择（浅色 / 深色 / 跟随系统） ---------- */
const ThemePicker: React.FC<{ value: string; onChange: (v: 'light' | 'dark' | 'system') => void }> = ({ value, onChange }) => {
  const opts = [
    { id: 'light' as const, label: '浅色模式', icon: Sun },
    { id: 'dark' as const, label: '深色模式', icon: Moon },
    { id: 'system' as const, label: '跟随系统', icon: Monitor },
  ]
  return (
    <div className="py-3 flex gap-3 flex-wrap">
      {opts.map((o) => {
        const active = value === o.id
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              active
                ? 'border-primary-300 text-primary-600 bg-primary-50'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <o.icon size={16} />
            <span>{o.label}</span>
            {active && <CheckCircle size={14} className="ml-0.5" />}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- 主题色选择（accent，2026-09-25 晚恢复） ----------
   预览块同时展示「强调色」与「被染色的浅底」，让用户直观看到整个界面的色彩氛围 */
const ACCENTS: Array<{ id: 'sky' | 'deepblue' | 'navy' | 'violet' | 'emerald' | 'teal' | 'lime' | 'rose' | 'amber'; label: string; hue: number }> = [
  { id: 'sky', label: '天蓝', hue: 199 },
  { id: 'deepblue', label: '深蓝', hue: 221 },
  { id: 'navy', label: '海军蓝', hue: 232 },
  { id: 'violet', label: '紫罗兰', hue: 262 },
  { id: 'emerald', label: '翡翠绿', hue: 160 },
  { id: 'teal', label: '青碧', hue: 174 },
  { id: 'lime', label: '浅绿', hue: 88 },
  { id: 'rose', label: '玫红', hue: 350 },
  { id: 'amber', label: '琥珀橙', hue: 24 },
]

const AccentPicker: React.FC<{ value: string; onChange: (v: typeof ACCENTS[number]['id']) => void }> = ({ value, onChange }) => (
  <div className="py-3 grid grid-cols-3 gap-2.5">
    {ACCENTS.map((a) => {
      const active = (value || 'sky') === a.id
      return (
        <button
          key={a.id}
          onClick={() => onChange(a.id)}
          className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl border transition-colors text-left ${
            active ? 'border-gray-400 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
          }`}
        >
          <span
            className="w-7 h-7 rounded-lg flex-shrink-0 overflow-hidden"
            style={{
              background: `linear-gradient(to bottom, hsl(${a.hue} 82% 52%) 0 55%, hsl(${a.hue} 45% 86%) 55% 100%)`,
              border: '1px solid var(--c-border-strong)',
            }}
          />
          <span className="text-xs text-gray-700 truncate">{a.label}</span>
          {active && <CheckCircle size={13} className="ml-auto flex-shrink-0 text-gray-500" />}
        </button>
      )
    })}
  </div>
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

/* 系统设置-显示：字体大小滑条的三档（小/默认/大） */
const FONT_SIZES = ['small', 'medium', 'large'] as const

/* ---------- 人格设置（2026-09-25，参考 WorkBuddy） ----------
   回复风格 / 自定义指令 / 称呼与身份 / 人设描述，注入所有对话 */
const PersonaCard: React.FC = () => {
  const { config, setConfig } = useAppStore()
  const cfg = config as any
  const [styleOpen, setStyleOpen] = useState(false)
  const [editingPersona, setEditingPersona] = useState(false)
  const [personaDraft, setPersonaDraft] = useState('')
  const style = REPLY_STYLES.find(s => s.id === (cfg.replyStyle ?? 'default')) ?? REPLY_STYLES[0]
  const instructions = String(cfg.customInstructions ?? '')

  return (
    <Card>
      {/* 回复风格 */}
      <div className="py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800">回复风格</div>
          <p className="text-xs text-gray-500 mt-0.5">选择 AI 回复的默认语气</p>
        </div>
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setStyleOpen(o => !o)}
            className="flex items-center justify-between gap-2 w-36 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-gray-300 transition-colors"
          >
            <span className="truncate">{style.label}</span>
            <ChevronRight size={14} className={`text-gray-400 transition-transform ${styleOpen ? 'rotate-90' : ''}`} />
          </button>
          {styleOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setStyleOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-60 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
                {REPLY_STYLES.map(s => {
                  const active = s.id === (cfg.replyStyle ?? 'default')
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setConfig({ replyStyle: s.id }); setStyleOpen(false) }}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors ${active ? 'bg-primary-50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm ${active ? 'text-primary-600 font-medium' : 'text-gray-700'}`}>{s.label}</span>
                        {active && <CheckCircle size={14} className="text-primary-500 flex-shrink-0" />}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{s.desc}</div>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 自定义指令 */}
      <div className="py-3 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-800">自定义指令</div>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">给 AI 定几条规则，后续所有对话都生效</p>
        <textarea
          value={instructions}
          maxLength={1500}
          rows={4}
          onChange={(e) => setConfig({ customInstructions: e.target.value })}
          placeholder="例如：回答先给结论再展开..."
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 resize-y"
        />
        <div className="text-right text-xs text-gray-400 mt-1">{instructions.length} / 1500</div>
      </div>

      {/* 称呼与身份 */}
      <div className="py-3 border-b border-gray-100">
        <div className="text-sm font-medium text-gray-800 mb-2">称呼与身份</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700 min-w-0">AI 的名字</span>
            <input
              value={String(cfg.aiName ?? '')}
              maxLength={30}
              onChange={(e) => setConfig({ aiName: e.target.value })}
              placeholder="（待补充）"
              className="w-44 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-primary-400"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-700 min-w-0">对你的称呼</span>
            <input
              value={String(cfg.userNickname ?? '')}
              maxLength={30}
              onChange={(e) => setConfig({ userNickname: e.target.value })}
              placeholder="（待补充）"
              className="w-44 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-primary-400"
            />
          </div>
        </div>
      </div>

      {/* 人设 / 人格描述 */}
      <div className="py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">人设 / 人格描述</span>
          {editingPersona ? (
            <button
              onClick={() => { setConfig({ personaPrompt: personaDraft }); setEditingPersona(false) }}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              <CheckCircle size={12} />完成
            </button>
          ) : (
            <button
              onClick={() => { setPersonaDraft(String(cfg.personaPrompt ?? '')); setEditingPersona(true) }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
            >
              <Pencil size={12} />编辑
            </button>
          )}
        </div>
        {editingPersona ? (
          <textarea
            value={personaDraft}
            maxLength={2000}
            rows={6}
            autoFocus
            onChange={(e) => setPersonaDraft(e.target.value)}
            placeholder="描述 AI 的人格：说话方式、价值观、口头禅..."
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 resize-y"
          />
        ) : (
          <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-600 whitespace-pre-wrap break-words min-h-[64px] max-h-56 overflow-y-auto">
            {String(cfg.personaPrompt ?? '').trim() || '（未设置——AI 使用默认人格）'}
          </div>
        )}
      </div>
    </Card>
  )
}

/* ---------- 壁纸设置（2026-09-25，参考 Wallpaper Engine） ----------
   内置动态壁纸 + 本地图片/视频/HTML + 网址；暗化遮罩与侧栏毛玻璃可调 */
const wpTypeFromName = (name: string): 'image' | 'video' | 'html' => {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video'
  if (['html', 'htm'].includes(ext)) return 'html'
  return 'image'
}
const wpFmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

const WallpaperCard: React.FC = () => {
  const { config, setConfig } = useAppStore()
  const wp: any = (config as any).wallpaper ?? { type: 'none', value: '', dim: 0.35, blur: 18 }
  const [urlInput, setUrlInput] = useState('')
  const [imported, setImported] = useState<Array<{ name: string; path: string; size: number }>>([])
  const [busy, setBusy] = useState<string | null>(null)

  const setWp = (patch: any) => setConfig({ wallpaper: { type: 'none', value: '', dim: 0.35, blur: 18, ...wp, ...patch } })
  const loadImported = () => {
    window.electronAPI?.wallpaper.list?.().then(r => { if (r?.ok && r.items) setImported(r.items) }).catch(() => {})
  }
  useEffect(() => { loadImported() }, [])

  const choose = async (kind: 'image' | 'video' | 'html') => {
    setBusy(kind)
    try {
      const r = await window.electronAPI?.wallpaper.chooseFile?.(kind)
      if (r?.ok && r.path) setWp({ type: kind, value: r.path })
      loadImported()
    } finally { setBusy(null) }
  }

  const wpOn = wp.type && wp.type !== 'none'
  const btnCls = `flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
    busy ? 'opacity-60 cursor-wait' : 'hover:bg-gray-50'
  } border-gray-200 text-gray-600`

  return (
    <Card>
      {/* 内置动态壁纸 */}
      <div className="py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium text-gray-800 mb-3">内置动态壁纸</h4>
        <div className="grid grid-cols-4 gap-2.5">
          <button
            onClick={() => setWp({ type: 'none', value: '' })}
            className={`h-[68px] rounded-lg border-2 flex items-center justify-center text-xs transition-colors ${
              !wpOn ? 'border-primary-400 text-primary-600 bg-primary-50' : 'border-gray-200 text-gray-400 hover:bg-gray-50'
            }`}
          >
            关闭壁纸
          </button>
          {BUILTIN_WALLPAPERS.map(b => {
            const active = wp.type === 'builtin' && wp.value === b.id
            return (
              <button
                key={b.id}
                onClick={() => setWp({ type: 'builtin', value: b.id })}
                className={`h-[68px] rounded-lg border-2 relative overflow-hidden transition-all ${
                  active ? 'border-primary-500' : 'border-transparent hover:border-gray-300'
                }`}
                style={{ background: b.css }}
                title={b.name}
              >
                <span className="absolute inset-x-0 bottom-0 py-0.5 text-[11px] text-white bg-black/40">{b.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 上传 / 网址 */}
      <div className="py-3 border-b border-gray-100">
        <h4 className="text-sm font-medium text-gray-800 mb-3">自定义壁纸</h4>
        <div className="flex gap-2 flex-wrap mb-3">
          <button className={btnCls} onClick={() => choose('image')} disabled={!!busy}>
            <ImageIcon size={15} />图片
          </button>
          <button className={btnCls} onClick={() => choose('video')} disabled={!!busy}>
            <VideoIcon size={15} />视频
          </button>
          <button className={btnCls} onClick={() => choose('html')} disabled={!!busy}>
            <FileCode size={15} />HTML 文件
          </button>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && urlInput.trim()) setWp({ type: 'url', value: urlInput.trim() }) }}
              placeholder="粘贴网页地址作为壁纸（如动态页面 / 在线视频页）"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:border-primary-400"
            />
          </div>
          <button
            className={btnCls}
            disabled={!urlInput.trim()}
            onClick={() => { if (urlInput.trim()) { setWp({ type: 'url', value: urlInput.trim() }); setUrlInput('') } }}
          >
            应用
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">导入的文件会复制到应用数据目录管理，不影响原文件。部分网站禁止被嵌入，网址壁纸可能显示空白。</p>
      </div>

      {/* 已导入壁纸 */}
      {imported.length > 0 && (
        <div className="py-3 border-b border-gray-100">
          <h4 className="text-sm font-medium text-gray-800 mb-2">已导入（{imported.length}）</h4>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {imported.map(it => {
              const active = wp.value === it.path
              return (
                <div key={it.path} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm ${active ? 'border-primary-300 bg-primary-50' : 'border-gray-100'}`}>
                  <span className="flex-1 truncate text-gray-700" title={it.name}>{it.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{wpFmtSize(it.size)}</span>
                  <button
                    className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 flex-shrink-0"
                    onClick={() => setWp({ type: wpTypeFromName(it.name), value: it.path })}
                  >
                    使用
                  </button>
                  <button
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="删除该导入副本"
                    onClick={() => {
                      window.electronAPI?.wallpaper.remove?.(it.name).then(() => {
                        loadImported()
                        if (active) setWp({ type: 'none', value: '' })
                      }).catch(() => {})
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 显示调节（壁纸激活时） */}
      {wpOn && (
        <div className="py-3">
          <h4 className="text-sm font-medium text-gray-800 mb-3">显示调节</h4>
          <div className="space-y-3">
            <label className="flex items-center gap-3 text-sm text-gray-600">
              <span className="w-20 flex-shrink-0">暗化遮罩</span>
              <input
                type="range" min={0} max={70} step={5}
                value={Math.round((typeof wp.dim === 'number' ? wp.dim : 0.35) * 100)}
                onChange={e => setWp({ dim: Number(e.target.value) / 100 })}
                className="flex-1 accent-primary-500"
              />
              <span className="w-10 text-right text-xs text-gray-400">{Math.round((typeof wp.dim === 'number' ? wp.dim : 0.35) * 100)}%</span>
            </label>
            <label className="flex items-center gap-3 text-sm text-gray-600">
              <span className="w-20 flex-shrink-0">玻璃模糊</span>
              <input
                type="range" min={0} max={30} step={2}
                value={typeof wp.blur === 'number' ? wp.blur : 18}
                onChange={e => setWp({ blur: Number(e.target.value) })}
                className="flex-1 accent-primary-500"
              />
              <span className="w-10 text-right text-xs text-gray-400">{typeof wp.blur === 'number' ? wp.blur : 18}px</span>
            </label>
            <p className="text-xs text-gray-400">模糊作用于整个界面（标题栏、侧栏、内容区一起毛玻璃化），0 = 关闭玻璃直接透出壁纸；弹窗不受影响。暗化让壁纸上方的文字更清楚。</p>
          </div>
        </div>
      )}
    </Card>
  )
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose, standalone }) => {
  const { t, i18n } = useTranslation()
  const { models, addModel, updateModel, deleteModel, setConfig, config } = useAppStore()
  const { globalMemory, addMemory, deleteMemory, clearMemory, searchMemory } = useAppStore()
  const [activeTab, setActiveTab] = useState('models')
  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [capturing, setCapturing] = useState<string | null>(null)
  const [dirTree, setDirTree] = useState<any[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [appVersion, setAppVersion] = useState('')
  // 更新检测状态
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{ received: number; total: number } | null>(null)
  const [applyMsg, setApplyMsg] = useState<string>('')
  const [sandboxSection, setSandboxSection] = useState<string | null>(null)
  // 记忆页
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryDraft, setMemoryDraft] = useState({ summary: '', keywords: '', files: '', outcome: 'success' as MemoryEntry['outcome'] })
  const [memoryBusy, setMemoryBusy] = useState(false)

  useEffect(() => {
    window.electronAPI?.app.getInfo().then((info: any) => {
      if (info?.version) setAppVersion(info.version)
    }).catch(() => {})
  }, [])

  // 检测更新
  const handleCheckUpdate = async () => {
    setChecking(true)
    setUpdateInfo(null)
    setApplyMsg('')
    try {
      const r = await window.electronAPI?.app.checkUpdate()
      setUpdateInfo(r || { ok: false, error: '无返回' })
    } catch (e: any) {
      setUpdateInfo({ ok: false, error: String(e?.message || e) })
    } finally {
      setChecking(false)
    }
  }

  // 启动独立更新器（关闭主程序，由 update.exe 完成下载与整文件夹替换）
  const handleUpdate = async () => {
    if (!updateInfo?.hasUpdate) return
    setDownloading(true)
    setApplyMsg('正在启动更新器…')
    try {
      const r = await window.electronAPI?.app.launchUpdater()
      if (r?.ok) {
        // 主程序即将退出，更新器接管后续下载/替换
        setApplyMsg('更新器已启动，软件即将重启以完成更新…')
      } else {
        setApplyMsg('启动更新器失败：' + (r?.error || '未知错误'))
        setDownloading(false)
      }
    } catch (e: any) {
      setApplyMsg('启动更新器失败：' + String(e?.message || e))
      setDownloading(false)
    }
  }

  // 加载目录树
  const loadDirTree = async () => {
    if (window.electronAPI) {
      try {
        const info = await window.electronAPI.app.getInfo()
        const tree = await window.electronAPI.fs.readDirTree(info.userDataPath)
        const list = Array.isArray(tree) ? tree : []
        setDirTree(list)
        // 默认展开 conversations 目录
        const convDir = list.find((item: any) => item.name === 'conversations')
        if (convDir) {
          setExpandedDirs(new Set([convDir.path]))
        }
      } catch (e) {
        console.error('loadDirTree failed:', e)
        setDirTree([])
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
    { id: 'persona', icon: User, label: '人格设置' },
    { id: 'personalization', icon: Palette, label: t('settings.personalization') },
    { id: 'models', icon: Database, label: t('settings.models') },
    { id: 'memory', icon: Brain, label: '长期记忆' },
    { id: 'data', icon: HardDrive, label: t('settings.data') },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.shortcuts') },
    { id: 'security', icon: Shield, label: t('settings.security') },
    { id: 'about', icon: Info, label: t('settings.about') },
  ]

  /* ---------- 模型管理 ---------- */
  const handleAddModel = async (model: Model) => {
    await addModel(model)
    setShowAddModel(false)
  }

  const handleEditModel = async (model: Model) => {
    await updateModel(model.id, model)
    setEditingModel(null)
    setShowAddModel(false)
  }

  const handleDeleteModel = async (modelId: string) => {
    if (!config.confirmBeforeDelete || window.confirm(t('models.deleteConfirm'))) {
      await deleteModel(modelId)
    }
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
    // 必须在确认清盘成功后再 reload：静默失败会让人误以为数据已清（实际还在）
    try {
      const ok = await window.electronAPI?.app.clearAllData()
      // 开发模式（无 electronAPI）下清 localStorage；Electron 模式下不动 localStorage
      if (!window.electronAPI) {
        for (const k of ['manyai_models', 'manyai_tasks', 'manyai_convs', 'manyai_config', 'manyai_tokenUsage', 'manyai_memory']) {
          localStorage.removeItem(k)
        }
      } else if (ok === false) {
        window.alert('清除失败：部分文件可能被占用，请关闭相关程序后重试。')
        return
      }
    } catch (e) {
      console.error('clearAllData failed:', e)
      window.alert('清除失败，请查看控制台日志。')
      return
    }
    window.location.reload()
  }

  const cfg = config as Record<string, any>

  /* ---------- 长期记忆 ---------- */
  const fmtMemoryDate = (ts: number) => {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const memoryList = memoryQuery.trim()
    ? searchMemory(memoryQuery.trim())
    : globalMemory

  const handleAddMemory = async () => {
    const summary = memoryDraft.summary.trim()
    if (!summary) return
    setMemoryBusy(true)
    try {
      await addMemory({
        id: uuidv4(),
        timestamp: Date.now(),
        summary,
        keywords: memoryDraft.keywords.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 8),
        files: memoryDraft.files.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 6),
        outcome: memoryDraft.outcome,
      })
      setMemoryDraft({ summary: '', keywords: '', files: '', outcome: 'success' })
    } catch (e) {
      console.error('addMemory failed:', e)
    }
    setMemoryBusy(false)
  }

  const handleClearMemory = async () => {
    if (!window.confirm(`确定清空全部 ${globalMemory.length} 条记忆？此操作不可撤销。`)) return
    await clearMemory()
  }

  return (
    <div className={standalone
      ? 'h-screen bg-gray-50 flex justify-center overflow-hidden'
      : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-pop-in'}>
      <div className={standalone
        ? 'bg-white w-[950px] h-full flex overflow-hidden'
        : 'bg-white rounded-2xl shadow-2xl w-[950px] h-[650px] flex overflow-hidden'}>
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
                <ModelManager />

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

            {/* 长期记忆 Tab */}
            {activeTab === 'memory' && (
              <div className="max-w-2xl">
                <SectionTitle>长期记忆</SectionTitle>
                <Card>
                  <SettingRow title="启用长期记忆" desc="对话与任务开始执行前，自动检索相关历史记忆并注入提示词">
                    <Toggle
                      checked={cfg.memoryEnabled !== false}
                      onChange={(v) => setConfig({ memoryEnabled: v })}
                    />
                  </SettingRow>
                  <SettingRow title="任务完成后自动沉淀" desc="任务成功结束时，让模型把本次成果压缩成一条记忆（会多一次模型调用）">
                    <Toggle
                      checked={cfg.autoMemory !== false}
                      onChange={(v) => setConfig({ autoMemory: v })}
                    />
                  </SettingRow>
                </Card>

                <SectionTitle>手动添加</SectionTitle>
                <Card>
                  <div className="py-3 space-y-3">
                    <textarea
                      value={memoryDraft.summary}
                      onChange={(e) => setMemoryDraft({ ...memoryDraft, summary: e.target.value })}
                      placeholder="一句话记录要长期记住的事实，例如：创建了五子棋项目，入口是 index.html"
                      rows={3}
                      className="w-full resize-none px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-300"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        value={memoryDraft.keywords}
                        onChange={(e) => setMemoryDraft({ ...memoryDraft, keywords: e.target.value })}
                        placeholder="关键词，逗号分隔：五子棋,Canvas"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-300"
                      />
                      <input
                        value={memoryDraft.files}
                        onChange={(e) => setMemoryDraft({ ...memoryDraft, files: e.target.value })}
                        placeholder="相关文件，逗号分隔（可选）"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-300"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <select
                        value={memoryDraft.outcome}
                        onChange={(e) => setMemoryDraft({ ...memoryDraft, outcome: e.target.value as MemoryEntry['outcome'] })}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-primary-300"
                      >
                        <option value="success">成功</option>
                        <option value="partial">部分完成</option>
                        <option value="failed">失败</option>
                      </select>
                      <button
                        onClick={handleAddMemory}
                        disabled={memoryBusy || !memoryDraft.summary.trim()}
                        className="px-4 py-1.5 bg-primary-500 text-white text-sm rounded-lg hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        <Plus size={14} /> 添加记忆
                      </button>
                    </div>
                  </div>
                </Card>

                <SectionTitle>已有记忆（{globalMemory.length} / 200）</SectionTitle>
                <div className="relative mb-3">
                  <input
                    value={memoryQuery}
                    onChange={(e) => setMemoryQuery(e.target.value)}
                    placeholder="搜索记忆（摘要 / 关键词 / 文件）"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-300"
                  />
                </div>
                {memoryList.length === 0 ? (
                  <Card>
                    <div className="py-8 text-center text-sm text-gray-400">
                      {globalMemory.length === 0 ? '还没有任何记忆，完成任务或手动添加后会出现在这里' : '没有匹配的记忆'}
                    </div>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {memoryList.map((m) => (
                      <Card key={m.id}>
                        <div className="py-3 px-4">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-xs text-gray-400">{fmtMemoryDate(m.timestamp)}</span>
                                {m.taskName && (
                                  <span className="text-[11px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded truncate max-w-[220px]">{m.taskName}</span>
                                )}
                                <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                                  m.outcome === 'success' ? 'bg-green-50 text-green-600'
                                  : m.outcome === 'partial' ? 'bg-amber-50 text-amber-600'
                                  : 'bg-red-50 text-red-600'
                                }`}>
                                  {m.outcome === 'success' ? '成功' : m.outcome === 'partial' ? '部分完成' : '失败'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-800 break-words">{m.summary}</p>
                              {m.keywords?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {m.keywords.map((k, i) => (
                                    <span key={i} className="text-[11px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded">{k}</span>
                                  ))}
                                </div>
                              )}
                              {m.files?.length > 0 && (
                                <p className="text-[11px] text-gray-400 mt-1 truncate">文件：{m.files.join('、')}</p>
                              )}
                            </div>
                            <button
                              onClick={() => deleteMemory(m.id)}
                              title="删除这条记忆"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors flex-shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
                {globalMemory.length > 0 && (
                  <button
                    onClick={handleClearMemory}
                    className="mt-4 px-4 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 flex items-center gap-1.5"
                  >
                    <Trash2 size={14} /> 清空全部记忆
                  </button>
                )}
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

            {/* Persona Tab（独立于「个性化」，v26.9.62 起单独成项） */}
            {activeTab === 'persona' && (
              <div className="max-w-2xl">
                <PersonaCard />
              </div>
            )}

            {/* Personalization Tab */}
            {activeTab === 'personalization' && (
              <div className="max-w-2xl">
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
                  <ThemePicker value={cfg.theme ?? 'light'} onChange={(v) => setConfig({ theme: v })} />
                  <div className="px-1 pb-1">
                    <p className="text-xs text-gray-400">切换后立即生效，并持久化到配置文件。</p>
                  </div>
                </Card>

                <SectionTitle>主题色</SectionTitle>
                <Card>
                  <AccentPicker value={cfg.accent ?? 'sky'} onChange={(v) => setConfig({ accent: v })} />
                  <div className="px-1 pb-3 -mt-1">
                    <p className="text-xs text-gray-400">决定整个界面的色相：按钮、高亮、链接以及底色都会被该色系晕染，与壁纸、深浅色模式叠加生效。</p>
                  </div>
                </Card>

                <SectionTitle>壁纸</SectionTitle>
                <WallpaperCard />
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
                        <span title="文件 / 命令 / 网络三类策略分别控制 AI 的访问范围" className="inline-flex"><HelpCircle size={15} className="text-gray-500" /></span>
                      </div>
                      <Toggle
                        checked={(cfg as any).sandboxEnabled ?? true}
                        onChange={(v) => setConfig({ sandboxEnabled: v })}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mb-3">AI 运行于隔离沙箱，并按下方名单管控文件、命令与网络访问；总开关关闭时全部放行</p>

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
                              <div className="text-xs text-gray-400">黑名单路径禁止读写改删；同时列入白名单的路径视为例外放行</div>
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
                              <div className="text-xs text-gray-400">命中放行名单直接执行；命中询问名单时弹窗询问；都未命中按默认放行</div>
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
                              <div className="text-xs text-gray-400">禁止域名直接拦截；配置允许域名后，其他域名先弹窗询问</div>
                            </div>
                          </div>
                          <ChevronRight size={14} className={`text-gray-400 transition-transform ${sandboxSection === 'net' ? 'rotate-90' : ''}`} />
                        </button>
                        {sandboxSection === 'net' && (
                          <div className="px-1 pb-3 space-y-2">
                            <div className="text-[11px] text-gray-400 leading-relaxed">
                              AI 的联网搜索（web_search）会依次尝试 cn.bing.com、html.duckduckgo.com、www.baidu.com；
                              网页正文抓取（web_fetch）会访问搜到的具体网址，两者都受下面规则约束。
                            </div>
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
                          min={0}
                          onChange={(e) => setConfig({ batchDeleteThreshold: Math.max(0, parseInt(e.target.value) || 0) })}
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
                      <span title="AI 修改或删除文件前会自动备份到本地，可随时找回" className="inline-flex"><HelpCircle size={15} className="text-gray-500" /></span>
                    </div>
                    <Toggle
                      checked={(cfg as any).autoBackup ?? true}
                      onChange={(v) => setConfig({ autoBackup: v })}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mb-3">覆盖/编辑/删除文件前自动备份原文件，超出总上限时清理最旧的备份</p>
                  <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">备份总上限</span>
                      <input
                        type="number"
                          value={(cfg as any).backupMaxSize ?? 3000}
                          min={1}
                          onChange={(e) => setConfig({ backupMaxSize: Math.max(1, parseInt(e.target.value) || 3000) })}
                        className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 text-center"
                      />
                      <span className="text-xs text-gray-500">MB</span>
                    </div>
                    <button
                      onClick={() => window.electronAPI?.app.openBackupDir()}
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

                {/* 对话页工具（ChatArea 的读写/执行能力） */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare size={18} className="text-blue-500" />
                      <div>
                        <h3 className="text-sm font-medium text-gray-800">对话页工具</h3>
                        <p className="text-xs text-gray-500">
                          在「AI 助理」对话界面直接读写文件、执行命令（与任务视图同一套工具链）
                        </p>
                      </div>
                    </div>
                    <select
                      value={cfg.chatToolsEnabled === false ? 'disabled' : 'enabled'}
                      onChange={(e) => setConfig({ chatToolsEnabled: e.target.value === 'enabled' })}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 bg-white"
                    >
                      <option value="enabled">启用</option>
                      <option value="disabled">禁用（纯聊天）</option>
                    </select>
                  </div>

                  {cfg.chatToolsEnabled !== false && (
                    <>
                      <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-800">允许执行命令</div>
                          <p className="text-xs text-gray-500">
                            关闭时仍可读写文件，但不会运行任何命令（跟随安全中心策略）
                          </p>
                        </div>
                        <select
                          value={cfg.chatAllowExec === true ? 'enabled' : 'disabled'}
                          onChange={(e) => setConfig({ chatAllowExec: e.target.value === 'enabled' })}
                          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 bg-white flex-shrink-0"
                        >
                          <option value="disabled">禁止</option>
                          <option value="enabled">允许</option>
                        </select>
                      </div>

                      <div className="pt-3 border-t border-gray-100">
                        <div className="text-sm text-gray-800 mb-1">工作目录</div>
                        <p className="text-xs text-gray-500 mb-2">
                          对话页创建的文件默认落在这个目录；留空则使用系统「文档」目录
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            value={cfg.chatWorkDir ?? ''}
                            onChange={(e) => setConfig({ chatWorkDir: e.target.value })}
                            placeholder="留空 = 系统「文档」目录"
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 bg-white"
                          />
                          <button
                            onClick={async () => {
                              const p = await window.electronAPI?.dialog.selectFolder()
                              if (p) setConfig({ chatWorkDir: p })
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex-shrink-0"
                          >
                            <FolderOpen size={14} />
                            选择
                          </button>
                          {cfg.chatWorkDir && (
                            <button
                              onClick={() => setConfig({ chatWorkDir: '' })}
                              className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
                            >
                              重置
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
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
                  <SectionTitle>显示</SectionTitle>
                  <Card>
                    <div className="py-3 border-b border-gray-100">
                      <div className="flex items-center gap-5">
                        <span className="text-sm font-medium text-gray-800 flex-shrink-0">字体大小</span>
                        <div className="flex-1 min-w-0 pt-1">
                          <input
                            type="range" min={0} max={2} step={1}
                            value={FONT_SIZES.indexOf((cfg.fontSize ?? 'medium') as any)}
                            onChange={(e) => setConfig({ fontSize: FONT_SIZES[Number(e.target.value)] })}
                            className="w-full accent-primary-500 cursor-pointer"
                          />
                          <div className="flex justify-between text-xs mt-0.5">
                            {(['小', '默认', '大'] as const).map((label, i) => (
                              <span key={label} className={FONT_SIZES.indexOf((cfg.fontSize ?? 'medium') as any) === i ? 'text-gray-700 font-medium' : 'text-gray-400'}>
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <SettingRow title={t('settings.showTimestamp')}>
                      <Toggle
                        checked={cfg.showTimestamp ?? false}
                        onChange={(v) => setConfig({ showTimestamp: v })}
                      />
                    </SettingRow>
                  </Card>
                </div>
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
                  {/* 外观（深浅模式）已于 2026-09-25 移至「个性化」tab */}
                </div>
              </div>
            )}

            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <AppLogo size={64} />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">deepwork</h2>
                <p className="text-sm text-gray-500 mb-1">版本 {appVersion}</p>
                <p className="text-xs text-gray-400 mb-4">完成于 2026年08月27日</p>
                <p className="text-sm text-gray-600 max-w-md mx-auto mb-4">
                  多智能体桌面应用，支持多模型协作完成复杂任务。
                </p>
                <div className="text-xs text-gray-400 space-y-1">
                  <p>Electron + React + TypeScript + Tailwind CSS</p>
                  <p>GitHub: yzw123456-666/deepwork</p>
                  <p>
                    反馈邮箱:{' '}
                    <a
                      href="mailto:yzwkf@hotmail.com"
                      className="text-primary-500 hover:text-primary-600 hover:underline"
                    >
                      yzwkf@hotmail.com
                    </a>
                  </p>
                </div>

                {/* 更新检测 */}
                <div className="mt-6 max-w-md mx-auto">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checking || downloading}
                    className="px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-60 transition-colors"
                  >
                    {checking ? '正在检查…' : downloading ? '更新中…' : '检查更新'}
                  </button>

                  <div className="mt-3 text-sm">
                    {updateInfo?.ok === false && (
                      <p className="text-red-500">检查失败：{updateInfo.error}</p>
                    )}
                    {updateInfo?.ok && updateInfo.hasUpdate && (
                      <div className="text-left bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <p className="text-gray-800 font-medium mb-1">
                          发现新版本 v{updateInfo.latest}（当前 v{updateInfo.current}）
                        </p>
                        {updateInfo.pubDate && (
                          <p className="text-xs text-gray-400 mb-1">发布于 {updateInfo.pubDate}</p>
                        )}
                        {updateInfo.notes && (
                          <p className="text-xs text-gray-600 whitespace-pre-wrap mb-2">{updateInfo.notes}</p>
                        )}
                        {!downloading ? (
                          <button
                            onClick={handleUpdate}
                            className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors"
                          >
                            立即更新
                          </button>
                        ) : (
                          <p className="text-primary-500 text-sm">{applyMsg || '正在下载并应用…'}</p>
                        )}
                      </div>
                    )}
                    {updateInfo?.ok && !updateInfo.hasUpdate && !checking && (
                      <p className="text-green-600">已是最新版本（v{updateInfo.current}）</p>
                    )}
                    {!updateInfo && !checking && !downloading && (
                      <p className="text-gray-400">点击「检查更新」获取最新版本</p>
                    )}
                  </div>

                  {/* 卸载 */}
                  <button
                    onClick={async () => {
                      if (!window.confirm('确定要卸载 deepwork 吗？此操作不可恢复。')) return
                      const r = await window.electronAPI?.app.launchUninstaller()
                      if (!r?.ok) window.alert('启动卸载器失败：' + (r?.error || '请手动删除程序文件夹'))
                    }}
                    className="mt-6 px-4 py-2 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors"
                  >
                    卸载 deepwork
                  </button>
                </div>
              </div>
            )}

            {/* Placeholder for other tabs */}
            {!['models', 'system', 'about', 'agent', 'persona', 'personalization', 'memory', 'shortcuts', 'security', 'data'].includes(activeTab) && (
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
