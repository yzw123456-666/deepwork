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
} from 'lucide-react'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import SettingsPanel from './components/SettingsPanel'
import CreateTaskDialog from './components/CreateTaskDialog'
import TaskSettings from './components/TaskSettings'
import TaskWorkspace from './components/TaskWorkspace'
import { useAppStore } from './stores'
import { DirTreeItem } from './types/electron'

const fontSizeMap: Record<string, string> = {
  small: '87.5%',
  medium: '100%',
  large: '112.5%',
}

// 项目页面
const ProjectsPage: React.FC = () => {
  const { tasks, setCurrentTask, setActivePage, models } = useAppStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)

  const getModelName = (id: string) => models.find(m => m.id === id)?.name || id

  const openTask = (task: any) => {
    setCurrentTask(task)
    setActivePage('taskWorkspace')
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
              <FolderOpen size={48} className="mx-auto mb-3 text-gray-300" />
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
                        {task.multiAIMode && (
                          <span className="px-2 py-0.5 bg-primary-100 text-primary-600 text-xs rounded-full flex items-center gap-1">
                            <Bot size={10} />
                            多AI合作
                          </span>
                        )}
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
                        {task.multiAIMode && (
                          <>
                            <span className="flex items-center gap-1">
                              <Bot size={12} />
                              主模型: {task.mainModels.map(getModelName).join(', ') || '未选择'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Zap size={12} />
                              附属: {task.subModels.length}个
                            </span>
                          </>
                        )}
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
        <div className={`${size} ${skill.color || 'bg-gray-400'} rounded-full items-center justify-center text-lg font-medium text-white hidden`}>
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
  const [activeTab, setActiveTab] = useState<'skillhub' | 'installed'>('skillhub')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(new Set())
  const [enabledSkills, setEnabledSkills] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; skill: any } | null>(null)
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [skillhubSkills, setSkillhubSkills] = useState<any[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const categories = ['全部', '办公效率', '内容创作', '开发编程', '数据分析', 'AI Agent', '知识管理', '生活服务']

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

  // 首次加载 + 搜索时重新获取
  useEffect(() => {
    if (activeTab === 'skillhub') {
      setPage(1)
      fetchSkillhub(1, false)
    }
  }, [activeTab, fetchSkillhub])

  // 搜索时防抖获取
  useEffect(() => {
    if (activeTab !== 'skillhub' || !searchQuery) return
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
          })))
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

  const installSkill = useCallback((slug: string) => {
    setDownloading(prev => { const n = new Set(prev); n.add(slug); return n })
    setTimeout(() => {
      setInstalledSkills(prev => { const n = new Set(prev); n.add(slug); return n })
      setEnabledSkills(prev => { const n = new Set(prev); n.add(slug); return n })
      setDownloading(prev => { const n = new Set(prev); n.delete(slug); return n })
    }, 800)
  }, [])

  const toggleEnabled = (slug: string) => {
    setEnabledSkills(prev => {
      const n = new Set(prev)
      if (n.has(slug)) n.delete(slug); else n.add(slug)
      return n
    })
  }

  const uninstallSkill = (slug: string) => {
    setInstalledSkills(prev => { const n = new Set(prev); n.delete(slug); return n })
    setEnabledSkills(prev => { const n = new Set(prev); n.delete(slug); return n })
  }

  const handleContextMenu = (e: React.MouseEvent, skill: any) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, skill })
  }

  const allSkillSources = skillhubSkills
  const installedList = allSkillSources.filter(s => installedSkills.has(s.slug))

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
              {tab.id === 'installed' && installedSkills.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-100 text-primary-600 rounded-full">{installedSkills.size}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
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
                <p className="text-gray-500 text-sm mb-1">还没有安装任何技能</p>
                <p className="text-gray-400 text-xs">去「SkillHub」浏览并安装技能</p>
              </div>
            ) : (
              displaySkills.map((skill: any) => {
                const slug = skill.slug
                const isEnabled = enabledSkills.has(slug)
                return (
                  <div
                    key={slug}
                    className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                    onContextMenu={(e) => handleContextMenu(e, skill)}
                  >
                  <div className="flex items-center gap-3">
                    <SkillAvatar skill={skill} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 text-sm truncate">{skill.name}</div>
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
                          onClick={() => toggleEnabled(slug)}
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
                    isInstalled={installedSkills.has(slug)}
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
            <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
              <MessageSquare size={15} className="text-gray-400" /> 去对话
            </button>
            <button className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5">
              <FolderOpen size={15} className="text-gray-400" /> 打开文件夹
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { uninstallSkill(contextMenu.skill.slug); setContextMenu(null) }}
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
            <Play size={48} className="mx-auto mb-3 text-gray-300" />
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
    if (window.electronAPI) {
      const info = await window.electronAPI.app.getInfo()
      const tree = await window.electronAPI.fs.readDirTree(info.userDataPath)
      setDirTree(tree)
      const convDir = tree.find((item: any) => item.name === 'conversations')
      if (convDir) {
        setExpandedDirs(new Set([convDir.path]))
      }
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

// AI介绍页面
const AIIntroPage: React.FC = () => {
  const { models, aiCapabilities, updateModel } = useAppStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const getCapabilityDesc = (modelId: string): string => {
    const model = models.find(m => m.id === modelId)
    const cap = aiCapabilities.find(c => c.modelId === modelId)
    if (model?.capability) return model.capability
    if (cap?.strengths?.length) return cap.strengths.join('、')
    return ''
  }

  const getStrengths = (modelId: string): string[] => {
    const cap = aiCapabilities.find(c => c.modelId === modelId)
    return cap?.strengths || []
  }

  const getWeaknesses = (modelId: string): string[] => {
    const cap = aiCapabilities.find(c => c.modelId === modelId)
    return cap?.weaknesses || []
  }

  const getRating = (modelId: string): number => {
    const cap = aiCapabilities.find(c => c.modelId === modelId)
    return cap?.rating || 0
  }

  const handleSave = async (modelId: string) => {
    await updateModel(modelId, { capability: editValue })
    setEditingId(null)
  }

  const enabledModels = models.filter(m => m.enabled)

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">AI 介绍</h1>
          <p className="text-gray-500 mt-1">查看所有已添加 AI 的能力介绍，可手动编辑</p>
        </div>

        {enabledModels.length === 0 ? (
          <div className="text-center py-16">
            <Bot size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">暂无已添加的 AI 模型</p>
            <p className="text-xs text-gray-400 mt-1">请先在设置中添加模型</p>
          </div>
        ) : (
          <div className="space-y-4">
            {enabledModels.map((model) => {
              const strengthList = getStrengths(model.id)
              const weaknessList = getWeaknesses(model.id)
              const rating = getRating(model.id)
              const isEditing = editingId === model.id

              return (
                <div key={model.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg bg-gradient-to-br from-primary-400 to-primary-600">
                      {model.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">{model.name}</h3>
                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{model.provider}</span>
                        {model.parameterSize && (
                          <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">{model.parameterSize}</span>
                        )}
                        {rating > 0 && (
                          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            {'★'.repeat(Math.min(5, Math.round(rating / 2)))} {rating}/10
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {model.id}</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingId(isEditing ? null : model.id)
                        setEditValue(model.capability || '')
                      }}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        isEditing ? 'bg-gray-200 text-gray-600' : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                      }`}
                    >
                      {isEditing ? '取消' : '编辑'}
                    </button>
                  </div>

                  {/* Content */}
                  <div className="px-5 py-4">
                    {isEditing ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">能力介绍</label>
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="如：擅长代码编写、数据分析、文案创作..."
                          rows={3}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all resize-none"
                        />
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => handleSave(model.id)}
                            className="px-4 py-2 bg-primary-500 text-white text-sm rounded-lg hover:bg-primary-600 transition-colors"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {/* Capability description */}
                        <div className="mb-4">
                          <div className="text-xs font-medium text-gray-500 mb-1">擅长能力</div>
                          {getCapabilityDesc(model.id) ? (
                            <p className="text-sm text-gray-700">{getCapabilityDesc(model.id)}</p>
                          ) : (
                            <p className="text-sm text-gray-400 italic">未设置能力介绍（添加模型时可自动评估或手动填写）</p>
                          )}
                        </div>

                        {/* Strengths */}
                        {strengthList.length > 0 && (
                          <div className="mb-3">
                            <div className="text-xs font-medium text-gray-500 mb-1">擅长领域</div>
                            <div className="flex flex-wrap gap-1.5">
                              {strengthList.map((s, i) => (
                                <span key={i} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs rounded-lg">{s}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Weaknesses */}
                        {weaknessList.length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-gray-500 mb-1">不擅长领域</div>
                            <div className="flex flex-wrap gap-1.5">
                              {weaknessList.map((w, i) => (
                                <span key={i} className="px-2.5 py-1 bg-red-50 text-red-600 text-xs rounded-lg">{w}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
                <BarChart3 size={48} className="mx-auto mb-3 text-gray-300" />
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
              <BarChart3 size={48} className="mx-auto mb-3 text-gray-300" />
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

// 更多页面
const MorePage: React.FC = () => {
  const { setActivePage } = useAppStore()

  const items = [
    { icon: Bot, title: 'AI 介绍', desc: '查看所有已添加 AI 的能力介绍', color: 'text-primary-500', bgColor: 'bg-primary-50', page: 'aiIntro' },
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
  const { loaded, loadAll, config, showSettings, activePage } = useAppStore()

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
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push('ctrl')
      if (e.altKey) parts.push('alt')
      if (e.shiftKey) parts.push('shift')
      parts.push(e.key === ',' ? ',' : e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase())
      const combo = parts.join('+')
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
        store.setSidebarCollapsed(!store.config.sidebarCollapsed)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loaded, showSettings, config.sidebarCollapsed, config.shortcutNewChat, config.shortcutOpenSettings, config.shortcutToggleSidebar])

  if (!loaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <span className="text-white text-xl font-bold">M</span>
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
      case 'tokenUsage': return <TokenUsagePage />
      case 'aiIntro': return <AIIntroPage />
      case 'taskWorkspace': return <TaskWorkspace onBack={() => useAppStore.getState().setActivePage('projects')} />
      default: return <ChatArea />
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={config.sidebarCollapsed}
          onToggle={() => {
            const store = useAppStore.getState()
            store.setSidebarCollapsed(!store.config.sidebarCollapsed)
          }}
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
