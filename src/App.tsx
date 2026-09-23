import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Plus,
  Clock,
  Play,
  FolderOpen,
  FileText,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Zap,
  Workflow,
  Settings,
  Search,
  Star,
  Download,
  Bot,
  Check,
  Trash2,
  MoreVertical,
  MoreHorizontal,
  BarChart3,
  MessageSquare,
  PenLine,
  Loader2,
  Wrench,
  ImagePlus,
  Video,
  Eye,
  MonitorPlay,
  AlertTriangle,
} from 'lucide-react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsPanel from './components/SettingsPanel'
import CreateTaskDialog from './components/CreateTaskDialog'
import TaskSettings from './components/TaskSettings'
import { useAppStore } from './stores'
import { DirTreeItem, InstalledSkill } from './types/electron'
import { AIToolConfig, AIToolId, Conversation } from './types'
import { v4 as uuidv4 } from 'uuid'
import { invalidateSkillCatalog } from './services/agentEngine'

const fontSizeMap: Record<string, string> = {
  small: '87.5%',
  medium: '100%',
  large: '112.5%',
}

// 项目页面
const ProjectsPage: React.FC = () => {
  const { tasks, setCurrentTask, setActivePage, models, conversations, addConversation, setCurrentConversation } = useAppStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)

  const getModelName = (id: string) => models.find(m => m.id === id)?.name || id

  const openTask = (task: any) => {
    setCurrentTask(task)
    // 任务不再有独立界面：打开该任务最新会话（无则新建），会话通过 taskId 关联任务并以其 folderPath 作为工作目录
    const taskConvs = conversations
      .filter(c => c.taskId === task.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    if (taskConvs.length > 0) {
      setCurrentConversation(taskConvs[0])
    } else {
      const conv: Conversation = {
        id: uuidv4(),
        title: '新对话',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        taskId: task.id,
      }
      addConversation(conv)
      setCurrentConversation(conv)
    }
    setActivePage('chat')
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-800">项目</h1>
        <p className="text-gray-500 mt-1">多人协同，打造超级团队</p>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="mt-4 px-5 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          新建任务
        </button>

        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">我的任务</h2>
          {tasks.length === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <FolderOpen size={48} className="mx-auto mb-3 text-gray-400" />
              <p>暂无任务，点击上方按钮创建</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => openTask(task)}
                  className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-800">{task.name}</h3>
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          task.status === 'running' ? 'bg-blue-100 text-blue-600' :
                          task.status === 'completed' ? 'bg-green-100 text-green-600' :
                          task.status === 'failed' ? 'bg-red-100 text-red-600' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {task.status === 'pending' ? '待执行' :
                           task.status === 'running' ? '执行中' :
                           task.status === 'completed' ? '已完成' : '失败'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <FolderOpen size={12} />
                          {task.folderPath.split('\\').pop() || task.folderPath.split('/').pop()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Bot size={12} />
                          {task.mainModels.map(getModelName).join(', ') || '未选择'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingTask(task)
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      title="任务设置"
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateDialog && (
        <CreateTaskDialog onClose={() => setShowCreateDialog(false)} />
      )}
      {editingTask && (
        <TaskSettings task={editingTask} onClose={() => setEditingTask(null)} />
      )}
    </div>
  )
}

// 技能头像组件：优先用iconUrl，否则用名称首字
const SkillAvatar: React.FC<{ skill: any; size?: string }> = ({ skill, size = 'w-10 h-10' }) => {
  if (skill.iconUrl) {
    return (
      <div className={`${size} rounded-full overflow-hidden flex-shrink-0 bg-gray-100`}>
        <img src={skill.iconUrl} alt={skill.name} className="w-full h-full object-cover" onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
        }} />
        <div className={`${size} ${skill.color || 'bg-gray-400'} rounded-full flex items-center justify-center text-lg font-medium text-white hidden`}>
          {skill.name?.[0] || '?'}
        </div>
      </div>
    )
  }
  return (
    <div className={`${size} ${skill.color || 'bg-gray-400'} rounded-full flex items-center justify-center text-lg font-medium text-white flex-shrink-0`}>
      {skill.name?.[0] || '?'}
    </div>
  )
}

// SkillHub 技能卡片（memo化：状态变化时只重渲染受影响的卡片）
const SkillHubCard: React.FC<{ skill: any; isInstalled: boolean; isDown: boolean; onInstall: (slug: string) => void }> = React.memo(({ skill, isInstalled, isDown, onInstall }) => {
  const slug = skill.slug || skill.name
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-center gap-3 mb-2">
        <SkillAvatar skill={skill} />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 text-sm truncate">{skill.name}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (!isInstalled && !isDown) onInstall(slug) }}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          {isDown ? (
            <Loader2 size={16} className="text-primary-500 animate-spin" />
          ) : isInstalled ? (
            <Check size={16} className="text-primary-500" />
          ) : (
            <Plus size={16} className="text-gray-400" />
          )}
        </button>
      </div>
      <p className="text-xs text-gray-500 line-clamp-2 mb-2">{skill.desc}</p>
      {skill.downloads ? (
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><Download size={10} />{(skill.downloads / 1000).toFixed(0)}k</span>
          <span className="flex items-center gap-1"><Star size={10} />{skill.stars}</span>
        </div>
      ) : null}
    </div>
  )
})

// 技能与连接器页面
const ExpertsPage: React.FC = () => {
  const { setActivePage } = useAppStore()
  const [activeTab, setActiveTab] = useState<'skillhub' | 'installed'>('skillhub')
  const [activeCategory, setActiveCategory] = useState('全部')
  // 已安装技能：真实持久化在主进程 userData/skills 目录，不再只是内存里的一个 Set
  const [installed, setInstalled] = useState<InstalledSkill[]>([])
  const [installedLoaded, setInstalledLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; skill: any } | null>(null)
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [skillhubSkills, setSkillhubSkills] = useState<any[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [actionMsg, setActionMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const msgTimerRef = useRef<number | null>(null)

  const categories = ['全部', '办公效率', '内容创作', '开发编程', '数据分析', 'AI Agent', '知识管理', '生活服务']

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setActionMsg({ type, text })
    if (msgTimerRef.current) window.clearTimeout(msgTimerRef.current)
    msgTimerRef.current = window.setTimeout(() => setActionMsg(null), type === 'err' ? 6000 : 3000)
  }, [])

  useEffect(() => () => { if (msgTimerRef.current) window.clearTimeout(msgTimerRef.current) }, [])

  const skillApi = typeof window !== 'undefined' ? window.electronAPI?.skills : undefined

  // 从磁盘读取真实已安装列表
  const refreshInstalled = useCallback(async () => {
    if (!skillApi) { setInstalledLoaded(true); return }
    try {
      const r = await skillApi.list()
      setInstalled(r?.ok && Array.isArray(r.skills) ? r.skills : [])
    } catch (e) {
      console.error('skills:list failed:', e)
      setInstalled([])
    }
    // Agent 侧缓存的技能清单同步失效，下一轮任务会重新读取
    invalidateSkillCatalog()
    setInstalledLoaded(true)
  }, [skillApi])

  useEffect(() => { refreshInstalled() }, [refreshInstalled])

  // 实时从 SkillHub API 获取技能（按下载量排序）
  const fetchSkillhub = useCallback(async (pageNum: number, append = false) => {
    setLoadingMore(true)
    try {
      const resp = await fetch(`https://api.skillhub.cn/api/skills?page=${pageNum}&pageSize=50&sortBy=downloads`, {
        headers: { 'Accept': 'application/json' }
      })
      const data = await resp.json()
      if (data?.data?.skills) {
        const colors = ['bg-blue-500','bg-green-500','bg-red-500','bg-yellow-500','bg-purple-500','bg-pink-500','bg-indigo-500','bg-cyan-500','bg-orange-500','bg-teal-500','bg-rose-500','bg-violet-500','bg-emerald-500','bg-sky-500','bg-amber-500']
        const catMap: Record<string,string> = { 'office-efficiency':'办公效率','content-creation':'内容创作','dev-programming':'开发编程','data-analysis':'数据分析','design-media':'设计多媒体','ai-agent':'AI Agent','knowledge-management':'知识管理','life-service':'生活服务','business-ops':'商业运营','professional':'专业领域','education':'教育学习' }
        const mapped = data.data.skills.map((s: any, i: number) => ({
          slug: s.slug,
          name: s.name,
          desc: (s.description_zh || s.description || '').slice(0, 120),
          iconUrl: s.iconUrl || null,
          color: colors[(pageNum * 50 + i) % colors.length],
          category: catMap[s.category] || '其他',
          downloads: s.downloads || 0,
          stars: s.stars || 0,
          // owner 用于消歧：ClawHub 上同名 slug 可能属于不同作者
          owner: s.upstream_owner_login || s.namespace?.handle || '',
          version: s.version || '',
        }))
        if (append) {
          setSkillhubSkills(prev => [...prev, ...mapped])
        } else {
          setSkillhubSkills(mapped)
        }
        setHasMore(data.data.skills.length === 50)
      }
    } catch (e) {
      console.error('SkillHub fetch error:', e)
    }
    setLoadingMore(false)
    setInitialLoading(false)
  }, [])

  // 首次加载 / 切到技能页 / 清空搜索 —— 统一在这里拉全量列表
  // 早期版本下面那个防抖 effect 在空关键词时也会拉一次，首屏会重复请求两次
  useEffect(() => {
    if (activeTab !== 'skillhub') return
    if (searchQuery.trim()) return // 有关键词时交给下面的搜索请求
    setPage(1)
    setHasMore(true)
    fetchSkillhub(1, false)
  }, [activeTab, searchQuery, fetchSkillhub])

  // 搜索时防抖获取
  useEffect(() => {
    if (activeTab !== 'skillhub') return
    // 清空搜索由上面的 effect 负责，这里只处理有关键词的情况
    if (!searchQuery.trim()) return
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch(`https://api.skillhub.cn/api/skills?page=1&pageSize=50&sortBy=downloads&keyword=${encodeURIComponent(searchQuery)}`, {
          headers: { 'Accept': 'application/json' }
        })
        const data = await resp.json()
        if (data?.data?.skills) {
          const colors = ['bg-blue-500','bg-green-500','bg-red-500','bg-yellow-500','bg-purple-500','bg-pink-500','bg-indigo-500','bg-cyan-500','bg-orange-500','bg-teal-500','bg-rose-500','bg-violet-500','bg-emerald-500','bg-sky-500','bg-amber-500']
          const catMap: Record<string,string> = { 'office-efficiency':'办公效率','content-creation':'内容创作','dev-programming':'开发编程','data-analysis':'数据分析','design-media':'设计多媒体','ai-agent':'AI Agent','knowledge-management':'知识管理','life-service':'生活服务','business-ops':'商业运营','professional':'专业领域','education':'教育学习' }
          const catIcon: Record<string,string> = { 'office-efficiency':'💼','content-creation':'✍️','dev-programming':'💻','data-analysis':'📊','design-media':'🎨','ai-agent':'🤖','knowledge-management':'🧠','life-service':'🏠','business-ops':'📈','professional':'👔','education':'📚' }
          setSkillhubSkills(data.data.skills.map((s: any, i: number) => ({
            slug: s.slug, name: s.name, desc: (s.description_zh || s.description || '').slice(0, 120),
            iconUrl: s.iconUrl || null, color: colors[i % colors.length],
            category: catMap[s.category] || '其他', downloads: s.downloads || 0, stars: s.stars || 0,
            owner: s.upstream_owner_login || s.namespace?.handle || '', version: s.version || '',
          })))
          // 搜索结果是单次查询，没有后续分页，否则滚动会把未过滤的第 N 页数据追加进来
          setHasMore(false)
          setPage(1)
        }
      } catch (e) { console.error(e) }
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery, activeTab])

  // 加载更多
  const loadMore = () => {
    if (loadingMore || !hasMore) return
    const next = page + 1
    setPage(next)
    fetchSkillhub(next, true)
  }

  // 无限滚动：监听滚动事件，到底部自动加载
  useEffect(() => {
    const el = scrollRef.current
    if (!el || activeTab !== 'skillhub') return
    const handleScroll = () => {
      if (loadingMore || !hasMore) return
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore()
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [activeTab, loadingMore, hasMore, page])

  // 真实安装：主进程从 ClawHub 下载 zip → 解压到 userData/skills/<slug>
  const installSkill = useCallback(async (slug: string) => {
    if (!skillApi) {
      notify('err', '当前环境不支持安装技能，请在桌面客户端中使用')
      return
    }
    const meta = skillhubSkills.find(s => s.slug === slug)
    const label = meta?.name || slug
    setDownloading(prev => { const n = new Set(prev); n.add(slug); return n })
    try {
      const r = await skillApi.install({
        slug,
        owner: meta?.owner || undefined,
        name: meta?.name,
        desc: meta?.desc,
        iconUrl: meta?.iconUrl || undefined,
        category: meta?.category,
      })
      if (!r?.ok) notify('err', `安装「${label}」失败：${r?.error || '未知错误'}`)
      else notify('ok', `已安装「${r.skill?.name || label}」${r.skill?.version ? ' v' + r.skill.version : ''}${r.notice ? '（' + r.notice + '）' : ''}`)
      await refreshInstalled()
    } catch (e: any) {
      notify('err', `安装「${label}」失败：${e?.message || e}`)
    } finally {
      setDownloading(prev => { const n = new Set(prev); n.delete(slug); return n })
    }
  }, [skillApi, skillhubSkills, refreshInstalled, notify])

  const toggleEnabled = useCallback(async (slug: string, next: boolean) => {
    if (!skillApi) return
    // 先本地乐观更新，失败再回滚
    setInstalled(prev => prev.map(s => (s.slug === slug ? { ...s, enabled: next } : s)))
    try {
      const r = await skillApi.setEnabled(slug, next)
      if (!r?.ok) {
        notify('err', r?.error || '切换启用状态失败')
        await refreshInstalled()
      }
    } catch (e: any) {
      // IPC 直接 reject（主进程抛错）时上面不会走到，必须单独兜住并回滚
      notify('err', `切换启用状态失败：${e?.message || e}`)
      await refreshInstalled()
    }
  }, [skillApi, refreshInstalled, notify])

  const uninstallSkill = useCallback(async (slug: string) => {
    if (!skillApi) return
    const r = await skillApi.remove(slug)
    if (!r?.ok) notify('err', r?.error || '卸载失败')
    else notify('ok', `已卸载「${slug}」`)
    await refreshInstalled()
  }, [skillApi, refreshInstalled, notify])

  const openSkillFolder = useCallback(async (slug: string) => {
    try {
      const api = window.electronAPI
      if (!api) return
      const info = await api.app.getInfo()
      const dir = [info.skillsPath, slug].filter(Boolean).join('/')
      await api.shell.openPath(dir)
    } catch (e) {
      notify('err', '打开技能文件夹失败')
    }
  }, [notify])

  const handleContextMenu = (e: React.MouseEvent, skill: any) => {
    e.preventDefault()
    // 贴边时把菜单拉回可视区，避免右键菜单被窗口裁掉
    const x = Math.min(e.clientX, Math.max(8, window.innerWidth - 180))
    const y = Math.min(e.clientY, Math.max(8, window.innerHeight - 150))
    setContextMenu({ x, y, skill })
  }

  // 已安装列表以磁盘为准；SkillHub 列表只用来补充图标/分类等展示信息
  const installedSlugs = useMemo(() => new Set(installed.map(s => s.slug)), [installed])
  const installedList = useMemo(() => installed.map(s => {
    const remote = skillhubSkills.find(x => x.slug === s.slug)
    return {
      slug: s.slug,
      name: s.name || remote?.name || s.slug,
      desc: s.desc || remote?.desc || '（无描述）',
      iconUrl: s.iconUrl || remote?.iconUrl || null,
      color: remote?.color,
      category: s.category || remote?.category || '其他',
      version: s.version,
      enabled: s.enabled !== false,
    }
  }), [installed, skillhubSkills])

  const getDisplaySkills = () => {
    if (activeTab === 'skillhub') return skillhubSkills
    return installedList
  }

  const displaySkills = getDisplaySkills().filter(s => {
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) && !s.desc.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (activeCategory !== '全部' && 'category' in s && (s as any).category !== activeCategory) return false
    return true
  })

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" onClick={() => setContextMenu(null)}>
      {/* Tabs */}
      <div className="border-b border-gray-200 px-6 pt-4">
        <div className="flex gap-6">
          {[
            { id: 'skillhub' as const, label: 'SkillHub' },
            { id: 'installed' as const, label: '我安装的' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'text-gray-800 border-b-2 border-gray-800'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.id === 'installed' && installed.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-100 text-primary-600 rounded-full">{installed.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {/* 操作结果提示 */}
        {actionMsg && (
          <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm flex items-start gap-2 ${
            actionMsg.type === 'err' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'
          }`}>
            {actionMsg.type === 'err' ? <Wrench size={15} className="mt-0.5 flex-shrink-0" /> : <Check size={15} className="mt-0.5 flex-shrink-0" />}
            <span className="break-all">{actionMsg.text}</span>
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={activeTab === 'installed' ? '搜索已安装的技能...' : '搜索技能...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
        </div>

        {/* Categories */}
        {activeTab !== 'installed' && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  activeCategory === cat ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >{cat}</button>
            ))}
          </div>
        )}

        {/* ====== 我安装的 - 严格按参考图 ====== */}
        {activeTab === 'installed' && (
          <div className="grid grid-cols-3 gap-4">
            {installedList.length === 0 ? (
              <div className="col-span-3 text-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Download size={24} className="text-gray-400" />
                </div>
                <p className="text-gray-500 text-sm mb-1">{installedLoaded ? '还没有安装任何技能' : '正在读取已安装技能…'}</p>
                <p className="text-gray-400 text-xs">{installedLoaded ? '去「SkillHub」浏览并安装技能' : ' '}</p>
              </div>
            ) : (
              displaySkills.map((skill: any) => {
                const slug = skill.slug
                const isEnabled = skill.enabled
                return (
                  <div
                    key={slug}
                    className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                    onContextMenu={(e) => handleContextMenu(e, skill)}
                  >
                  <div className="flex items-center gap-3">
                    <SkillAvatar skill={skill} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 text-sm truncate flex items-center gap-1.5">
                        <span className="truncate">{skill.name}</span>
                        {skill.version && <span className="text-[10px] text-gray-400 flex-shrink-0">v{skill.version}</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{skill.desc}</p>
                    </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleContextMenu(e, skill) }}
                          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                        >
                          <MoreHorizontal size={16} className="text-gray-400" />
                        </button>
                        <button
                          onClick={() => toggleEnabled(slug, !isEnabled)}
                          title={isEnabled ? '点击停用' : '点击启用'}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            isEnabled ? 'bg-cyan-500' : 'bg-gray-300'
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            isEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ====== SkillHub 列表 ====== */}
        {activeTab === 'skillhub' && (
          <>
          {initialLoading && skillhubSkills.length === 0 ? (
            <div className="flex justify-center py-16">
              <Loader2 size={24} className="text-gray-400 animate-spin" />
            </div>
          ) : (
            <>
            <div className="grid grid-cols-4 gap-3">
              {displaySkills.map((skill: any) => {
                const slug = skill.slug || skill.name
                return (
                  <SkillHubCard
                    key={slug}
                    skill={skill}
                    isInstalled={installedSlugs.has(slug)}
                    isDown={downloading.has(slug)}
                    onInstall={installSkill}
                  />
                )
              })}
            </div>
            {displaySkills.length === 0 && !loadingMore && (
              <div className="text-center py-12 text-sm text-gray-400">未找到匹配的技能</div>
            )}
            </>
          )}
          {/* 底部加载指示器 */}
          {activeTab === 'skillhub' && loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 size={20} className="text-gray-400 animate-spin" />
            </div>
          )}
          {activeTab === 'skillhub' && !hasMore && skillhubSkills.length > 0 && (
            <div className="text-center py-4 text-xs text-gray-400">已加载全部技能</div>
          )}
          </>
        )}

        {/* ====== 右键菜单 ====== */}
        {contextMenu && (
          <div
            className="fixed z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const s = contextMenu?.skill
                setContextMenu(null)
                setActivePage('chat')
                if (s) notify('ok', `已切换到对话，直接描述你的需求，AI 会自动调用「${s.name}」`)
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
            >
              <MessageSquare size={15} className="text-gray-400" /> 去对话
            </button>
            <button
              onClick={() => {
                const s = contextMenu?.skill
                setContextMenu(null)
                if (s) openSkillFolder(s.slug)
              }}
              className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
            >
              <FolderOpen size={15} className="text-gray-400" /> 打开文件夹
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { const s = contextMenu?.skill; setContextMenu(null); if (s) uninstallSkill(s.slug) }}
              className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50 flex items-center gap-2.5"
            >
              <Trash2 size={15} /> 卸载
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// 自动化页面
const AutomationPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'tasks' | 'logs'>('tasks')

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Tabs */}
      <div className="border-b border-gray-200 px-6 pt-4">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`pb-3 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'tasks'
                ? 'text-gray-800 border-b-2 border-gray-800'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock size={14} />
            定时任务
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`pb-3 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'text-gray-800 border-b-2 border-gray-800'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Play size={14} />
            运行记录
          </button>
        </div>
      </div>

      <div className="p-6 flex-1 flex items-center justify-center">
        {activeTab === 'tasks' ? (
          <div className="text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock size={32} className="text-gray-400" />
            </div>
            <p className="text-gray-500 mb-4">开启你的第一个自动化任务吧</p>
            <button className="px-5 py-2.5 bg-gray-800 text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors flex items-center gap-2 mx-auto">
              <Plus size={16} />
              添加自动化
            </button>
          </div>
        ) : (
          <div className="text-center text-gray-400">
            <Play size={48} className="mx-auto mb-3 text-gray-400" />
            <p>暂无运行记录</p>
          </div>
        )}
      </div>
    </div>
  )
}

// 资料库页面
const ResourcesPage: React.FC = () => {
  const [dirTree, setDirTree] = useState<any[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const loadDirTree = async () => {
    if (!window.electronAPI) return
    try {
      const info = await window.electronAPI.app.getInfo()
      const tree = await window.electronAPI.fs.readDirTree(info.userDataPath)
      setDirTree(Array.isArray(tree) ? tree : [])
      const convDir = (Array.isArray(tree) ? tree : []).find((item: any) => item.name === 'conversations')
      if (convDir) {
        setExpandedDirs(new Set([convDir.path]))
      }
    } catch (e) {
      // IPC 失败时不静默：否则界面永远停在加载中
      console.error('loadDirTree failed:', e)
      setDirTree([])
    }
  }

  useEffect(() => {
    loadDirTree()
  }, [])

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const TreeNode: React.FC<{ item: any; level?: number }> = ({ item, level = 0 }) => {
    const isExpanded = expandedDirs.has(item.path)
    return (
      <div>
        <div
          className="flex items-center gap-2 py-2 px-3 hover:bg-gray-100 rounded cursor-pointer group"
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            if (item.isDir) toggleDir(item.path)
            else window.electronAPI?.shell.showItemInFolder(item.path)
          }}
        >
          {item.isDir ? (
            <ChevronRight size={14} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          ) : (
            <span className="w-[14px]" />
          )}
          <FileText size={14} className={item.isDir ? 'text-blue-500' : 'text-gray-500'} />
          <span className="text-sm text-gray-700 flex-1 truncate">{item.name}</span>
          {!item.isDir && <span className="text-xs text-gray-400">{formatSize(item.size)}</span>}
        </div>
        {item.isDir && isExpanded && item.children?.map((child: any) => (
          <TreeNode key={child.path} item={child} level={level + 1} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">资料库</h1>
            <p className="text-gray-500 mt-1">工作空间内的所有文件和数据</p>
          </div>
          <button
            onClick={loadDirTree}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {dirTree.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">加载中...</div>
          ) : (
            dirTree.map((item: any) => (
              <TreeNode key={item.path} item={item} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}


// Token用量页面
const TokenUsagePage: React.FC = () => {
  const { tokenUsage, clearTokenUsage, models } = useAppStore()
  const [view, setView] = useState<'chart' | 'table'>('chart')

  const totalInput = tokenUsage.reduce((s, r) => s + r.inputTokens, 0)
  const totalOutput = tokenUsage.reduce((s, r) => s + r.outputTokens, 0)
  const totalAll = tokenUsage.reduce((s, r) => s + r.totalTokens, 0)

  const byModel: Record<string, { input: number; output: number; total: number; count: number }> = {}
  for (const r of tokenUsage) {
    const key = r.modelName || r.modelId
    if (!byModel[key]) byModel[key] = { input: 0, output: 0, total: 0, count: 0 }
    byModel[key].input += r.inputTokens
    byModel[key].output += r.outputTokens
    byModel[key].total += r.totalTokens
    byModel[key].count++
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatFullTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // Chart data: group by minute for cleaner display
  const chartData = useMemo(() => {
    if (tokenUsage.length === 0) return []
    const sorted = [...tokenUsage].sort((a, b) => a.timestamp - b.timestamp)
    const groups: { time: number; total: number; input: number; output: number; label: string }[] = []
    let lastLabel = ''
    let current = { time: 0, total: 0, input: 0, output: 0, label: '' }
    for (const r of sorted) {
      const d = new Date(r.timestamp)
      const label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
      if (label !== lastLabel) {
        if (current.time > 0) groups.push(current)
        current = { time: r.timestamp, total: r.totalTokens, input: r.inputTokens, output: r.outputTokens, label }
        lastLabel = label
      } else {
        current.total += r.totalTokens
        current.input += r.inputTokens
        current.output += r.outputTokens
      }
    }
    if (current.time > 0) groups.push(current)
    return groups
  }, [tokenUsage])

  // SVG chart dimensions
  const CHART_W = 700
  const CHART_H = 220
  const PAD = { top: 20, right: 20, bottom: 40, left: 60 }
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom

  const maxVal = chartData.length > 0 ? Math.max(...chartData.map(d => d.total), 1) : 1
  const yTicks = 5

  const toX = (i: number) => chartData.length <= 1 ? innerW / 2 : (i / (chartData.length - 1)) * innerW
  const toY = (v: number) => innerH - (v / maxVal) * innerH

  const buildPath = (values: number[]) => {
    if (values.length === 0) return ''
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  }

  const totalPath = buildPath(chartData.map(d => d.total))
  const inputPath = buildPath(chartData.map(d => d.input))
  const outputPath = buildPath(chartData.map(d => d.output))

  // Color map for models
  const modelColors = ['rgb(59,130,246)', 'rgb(16,185,129)', 'rgb(245,158,11)', 'rgb(239,68,68)', 'rgb(139,92,246)', 'rgb(236,72,153)']

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Token 用量</h1>
            <p className="text-gray-500 mt-1">实时记录每次 API 调用的 Token 消耗</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setView('chart')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${view === 'chart' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <BarChart3 size={14} className="inline mr-1" />
                折线图
              </button>
              <button
                onClick={() => setView('table')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${view === 'table' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <FileText size={14} className="inline mr-1" />
                列表
              </button>
            </div>
            {tokenUsage.length > 0 && (
              <button
                onClick={() => { if (window.confirm('确定要清空所有 Token 用量记录吗？')) clearTokenUsage() }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
                清空记录
              </button>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm text-gray-500 mb-1">总消耗</div>
            <div className="text-2xl font-bold text-gray-800">{totalAll.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">tokens</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm text-gray-500 mb-1">输入</div>
            <div className="text-2xl font-bold text-blue-600">{totalInput.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">prompt tokens</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="text-sm text-gray-500 mb-1">输出</div>
            <div className="text-2xl font-bold text-green-600">{totalOutput.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mt-1">completion tokens</div>
          </div>
        </div>

        {/* Chart / Table view */}
        {view === 'chart' ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Token 消耗趋势</h2>
            {chartData.length === 0 ? (
              <div className="text-center py-16">
                <BarChart3 size={48} className="mx-auto mb-3 text-gray-400" />
                <p className="text-gray-500">暂无 Token 用量记录</p>
                <p className="text-xs text-gray-400 mt-1">发送消息后将自动记录</p>
              </div>
            ) : (
              <div>
                <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ maxHeight: 280 }}>
                  {/* Grid lines */}
                  {Array.from({ length: yTicks + 1 }, (_, i) => {
                    const y = PAD.top + (i / yTicks) * innerH
                    const val = Math.round(maxVal * (1 - i / yTicks))
                    return (
                      <g key={i}>
                        <line x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y} stroke="#f0f0f0" strokeWidth={1} />
                        <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill="#999">
                          {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                        </text>
                      </g>
                    )
                  })}

                  {/* X axis labels */}
                  {chartData.map((d, i) => {
                    const show = chartData.length <= 10 || i % Math.ceil(chartData.length / 8) === 0 || i === chartData.length - 1
                    if (!show) return null
                    return (
                      <text key={i} x={PAD.left + toX(i)} y={CHART_H - 8} textAnchor="middle" fontSize={9} fill="#999">
                        {d.label}
                      </text>
                    )
                  })}

                  {/* Lines */}
                  <g transform={`translate(${PAD.left},${PAD.top})`}>
                    {totalPath && <path d={totalPath} fill="none" stroke="rgb(59,130,246)" strokeWidth={2} strokeLinejoin="round" />}
                    {inputPath && <path d={inputPath} fill="none" stroke="rgb(16,185,129)" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="4,3" />}
                    {outputPath && <path d={outputPath} fill="none" stroke="rgb(245,158,11)" strokeWidth={1.5} strokeLinejoin="round" strokeDasharray="4,3" />}

                    {/* Dots on total line */}
                    {chartData.map((d, i) => (
                      <circle key={i} cx={toX(i)} cy={toY(d.total)} r={3} fill="rgb(59,130,246)" />
                    ))}
                  </g>
                </svg>

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-600">
                  <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-blue-500 rounded" />总计</div>
                  <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-green-500 rounded border-dashed" style={{ borderTop: '1.5px dashed rgb(16,185,129)', height: 0 }} />输入</div>
                  <div className="flex items-center gap-1.5"><div className="w-4 h-0.5 bg-amber-500 rounded border-dashed" style={{ borderTop: '1.5px dashed rgb(245,158,11)', height: 0 }} />输出</div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Per-model breakdown */}
        {Object.keys(byModel).length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">按模型统计</h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">模型</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">调用次数</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">输入 Tokens</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">输出 Tokens</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">总 Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byModel).sort((a, b) => b[1].total - a[1].total).map(([name, stats]) => (
                    <tr key={name} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{stats.count}</td>
                      <td className="px-4 py-3 text-right text-blue-600">{stats.input.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-green-600">{stats.output.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">{stats.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent records - simplified table matching screenshot */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">最近记录</h2>
          {tokenUsage.length === 0 ? (
            <div className="text-center py-16">
              <BarChart3 size={48} className="mx-auto mb-3 text-gray-400" />
              <p className="text-gray-500">暂无 Token 用量记录</p>
              <p className="text-xs text-gray-400 mt-1">发送消息后将自动记录每次 API 调用的 Token 消耗</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-600">时间</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-600">Token 消耗</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-600">模型</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tokenUsage].reverse().slice(0, 100).map((record) => (
                    <tr key={record.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                      <td className="px-6 py-3 text-gray-500">{formatFullTime(record.timestamp)}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-800">{record.totalTokens.toLocaleString()}</td>
                      <td className="px-6 py-3 text-gray-800">{record.modelName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// AI 工具页面（更多 → AI 工具）
const AI_TOOLS_META: Array<{ id: AIToolId; name: string; desc: string; icon: any; iconColor: string; badgeColor: string }> = [
  { id: 'image-gen', name: '图片生成', desc: '根据文字描述生成图片', icon: ImagePlus, iconColor: 'text-purple-600', badgeColor: 'bg-purple-100' },
  { id: 'video-gen', name: '视频生成', desc: '根据文字描述生成视频', icon: Video, iconColor: 'text-blue-600', badgeColor: 'bg-blue-100' },
  { id: 'image-understand', name: '图片理解', desc: '为不支持图片输入的模型补齐看图能力', icon: Eye, iconColor: 'text-green-600', badgeColor: 'bg-green-100' },
  { id: 'video-understand', name: '视频理解', desc: '为不支持视频输入的模型补齐视频理解能力', icon: MonitorPlay, iconColor: 'text-amber-600', badgeColor: 'bg-amber-100' },
]

const AIToolsPage: React.FC = () => {
  const { setConfig, config } = useAppStore()

  // 与默认工具定义合并（老配置里缺省的补默认值）
  const saved: AIToolConfig[] = (config as any).aiTools || []
  const tools = AI_TOOLS_META.map(m => {
    const s = saved.find(t => t.id === m.id)
    return { ...m, enabled: s?.enabled ?? false, baseUrl: s?.baseUrl ?? '', apiKey: s?.apiKey ?? '', model: s?.model ?? '' }
  })

  const updateTool = (id: AIToolId, patch: Partial<AIToolConfig>) => {
    // 只持久化核心配置字段（name/icon 等展示信息由 META 定义）
    setConfig({
      aiTools: tools.map(t => {
        // 只对目标工具应用补丁，其余保持原值
        const merged = t.id === id ? { ...t, ...patch } : t
        return { id: t.id, enabled: merged.enabled, baseUrl: merged.baseUrl, apiKey: merged.apiKey, model: merged.model }
      }),
    })
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold text-gray-800">AI 工具</h1>
        <p className="text-gray-500 mt-1">开启扩展能力并为每个工具配置专用的 API 与模型，开启后即可使用对应功能</p>

        <div className="mt-6 space-y-4">
          {tools.map((tool) => (
            <div key={tool.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 ${tool.badgeColor} rounded-xl flex items-center justify-center flex-shrink-0`}>
                    <tool.icon size={22} className={tool.iconColor} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-800">{tool.name}</h3>
                      {tool.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded-full">已开启</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{tool.desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => updateTool(tool.id, { enabled: !tool.enabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                    tool.enabled ? 'bg-primary-500' : 'bg-gray-300'
                  }`}
                  title={tool.enabled ? '关闭' : '开启'}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    tool.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>

              {/* 开启后展开：专用 API 配置 */}
              {tool.enabled && (
                <div className="px-5 pb-5 pt-4 border-t border-gray-100 space-y-3.5">
                  <p className="text-xs text-gray-400">为该工具配置专用的 AI 服务（等同模型添加页的配置）</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Base URL</label>
                    <input
                      value={tool.baseUrl}
                      onChange={(e) => updateTool(tool.id, { baseUrl: e.target.value })}
                      placeholder="https://api.example.com/v1"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">API Key</label>
                    <input
                      type="password"
                      value={tool.apiKey}
                      onChange={(e) => updateTool(tool.id, { apiKey: e.target.value })}
                      placeholder="输入 API Key"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">模型</label>
                    <input
                      value={tool.model}
                      onChange={(e) => updateTool(tool.id, { model: e.target.value })}
                      placeholder="模型名称，如 GLM-5.3-Flash"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-primary-500 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// 更多页面
const MorePage: React.FC = () => {
  const { setActivePage } = useAppStore()

  const items = [
    { icon: Wrench, title: 'AI 工具', desc: '图片/视频生成与理解的专用 AI 配置', color: 'text-purple-500', bgColor: 'bg-purple-50', page: 'aiTools' },
    { icon: BarChart3, title: 'Token 用量', desc: '查看 API Token 消耗统计', color: 'text-blue-500', bgColor: 'bg-blue-50', page: 'tokenUsage' },
  ]

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">更多</h1>
        <div className="grid grid-cols-3 gap-4">
          {items.map((item, i) => (
            <div
              key={i}
              onClick={() => item.page && setActivePage(item.page)}
              className={`bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md transition-shadow cursor-pointer`}
            >
              <div className={`w-12 h-12 ${item.bgColor} rounded-xl flex items-center justify-center mb-3`}>
                <item.icon size={24} className={item.color} />
              </div>
              <h3 className="font-medium text-gray-800">{item.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function App() {
  const { i18n } = useTranslation()
  const { loaded, loadAll, loadError, config, showSettings, activePage } = useAppStore()

  useEffect(() => {
    loadAll().then(() => {
      const savedLang = useAppStore.getState().config.language
      if (savedLang) i18n.changeLanguage(savedLang)
    })
  }, [])

  useEffect(() => {
    const size = (config as any).fontSize ?? 'medium'
    document.documentElement.style.fontSize = fontSizeMap[size] || '100%'
  }, [(config as any).fontSize])

  // 主题：light / dark / system（跟随系统时实时响应系统切换）；accent 为主题色
  useEffect(() => {
    const mode = (config as any).theme ?? 'light'
    const accent = (config as any).accent || 'sky'
    const root = document.documentElement
    if (accent && accent !== 'sky') root.setAttribute('data-accent', accent)
    else root.removeAttribute('data-accent')
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && !!mq?.matches)
      if (dark) root.setAttribute('data-theme', 'dark')
      else root.removeAttribute('data-theme')
      // 让窗口标题栏等原生控件也跟着变（Electron 支持）
      try { window.electronAPI?.app.setTheme?.(dark ? 'dark' : 'light') } catch { /* 旧版本主进程无此接口 */ }
    }
    apply()
    if (mode !== 'system' || !mq) return
    const onChange = () => apply()
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [(config as any).theme, (config as any).accent])

  // 小窗口自适应：宽度不足 960 自动收起侧边栏（把空间让给内容区），
  // 恢复到 1120 以上且之前是「自动收起」的才自动展开；用户手动收起的不动。
  // 用独立的内存态（compactMode）驱动，不写入偏好配置，重启不受影响。
  const [compactMode, setCompactMode] = useState(false)
  const compactRef = useRef(false)
  const autoCollapsedRef = useRef(false)
  useEffect(() => {
    const COLLAPSE_BELOW = 960
    const RESTORE_ABOVE = 1120
    let timer: number | null = null
    const onResize = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const w = window.innerWidth
        if (w < COLLAPSE_BELOW && !compactRef.current) {
          compactRef.current = true
          autoCollapsedRef.current = true
          setCompactMode(true)
        } else if (w >= RESTORE_ABOVE && compactRef.current) {
          compactRef.current = false
          if (autoCollapsedRef.current) autoCollapsedRef.current = false
          setCompactMode(false)
        }
      }, 120)
    }
    window.addEventListener('resize', onResize)
    // 挂载时立即判断一次（避免小窗口打开时侧边栏先展开再收起的闪动）
    onResize()
    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  // 侧边栏开关（用户点击/快捷键共用）：compact 模式下点开 → 解除 compact；否则切换偏好
  const toggleSidebarUnified = useCallback(() => {
    const store = useAppStore.getState()
    const collapsed = store.config.sidebarCollapsed || compactRef.current
    if (collapsed) {
      compactRef.current = false
      autoCollapsedRef.current = false
      setCompactMode(false)
      if (store.config.sidebarCollapsed) store.setSidebarCollapsed(false)
    } else {
      autoCollapsedRef.current = false
      store.setSidebarCollapsed(true)
    }
  }, [])

  useEffect(() => {
    if (!loaded) return
    const cfg = useAppStore.getState().config as any
    const shortcuts: Record<string, string> = {
      shortcutNewChat: cfg.shortcutNewChat ?? 'Ctrl+N',
      shortcutOpenSettings: cfg.shortcutOpenSettings ?? 'Ctrl+,',
      shortcutToggleSidebar: cfg.shortcutToggleSidebar ?? 'Ctrl+B',
    }
    const comboMap: Record<string, string> = {}
    for (const [action, combo] of Object.entries(shortcuts)) {
      comboMap[combo.toLowerCase()] = action
    }

    const onKey = (e: KeyboardEvent) => {
      // 正在输入时不响应快捷键，否则单键快捷键会把输入字符吞掉
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as any)?.isContentEditable) return

      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('ctrl')
      if (e.altKey) parts.push('alt')
      if (e.shiftKey) parts.push('shift')
      parts.push(e.key === ',' ? ',' : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase())
      const combo = parts.join('+')
      // 单键快捷键（无修饰键）在输入场景下一律不触发，避免影响正常打字
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey
      if (!hasModifier && e.key.length === 1) return
      const action = comboMap[combo]
      if (!action) return

      e.preventDefault()
      const store = useAppStore.getState()
      if (action === 'shortcutNewChat') {
        store.setCurrentConversation(null)
        store.setActivePage('chat')
      } else if (action === 'shortcutOpenSettings') {
        store.setShowSettings(!store.showSettings)
      } else if (action === 'shortcutToggleSidebar') {
        toggleSidebarUnified()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loaded, showSettings, config.sidebarCollapsed, config.shortcutNewChat, config.shortcutOpenSettings, config.shortcutToggleSidebar, toggleSidebarUnified])

  if (!loaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <span className="text-white text-xl font-bold">D</span>
          </div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  const renderPage = () => {
    switch (activePage) {
      case 'projects': return <ProjectsPage />
      case 'experts': return <ExpertsPage />
      case 'automation': return <AutomationPage />
      case 'resources': return <ResourcesPage />
      case 'more': return <MorePage />
      case 'aiTools': return <AIToolsPage />
      case 'tokenUsage': return <TokenUsagePage />
      default: return <ChatArea />
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <TitleBar />
      {loadError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex-shrink-0">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1 truncate">
            本地数据加载失败，当前为默认配置；此状态下保存设置可能覆盖你的配置（{loadError}）
          </span>
          <button
            onClick={() => useAppStore.setState({ loadError: null })}
            className="px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-900 flex-shrink-0"
          >
            知道了
          </button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={config.sidebarCollapsed || compactMode}
          onToggle={toggleSidebarUnified}
          onSettings={() => useAppStore.getState().setShowSettings(true)}
        />
        {renderPage()}
      </div>
      {showSettings && (
        <SettingsPanel
          onClose={() => useAppStore.getState().setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default App
