import { create } from 'zustand'
import { Model, Message, Conversation, AppConfig, Task, TaskMessage, TokenUsageRecord, SubTask, MemoryEntry } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { persistMemoryMd } from '../services/memoryFile'

// localStorage 兜底解析：开发模式（无 electronAPI）下数据损坏时不抛异常白屏
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return (v === null || v === undefined) ? fallback : (v as T)
  } catch {
    console.warn('[store] 本地数据解析失败，已回退为空值')
    return fallback
  }
}

const api = () => (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null

async function saveModelsToDisk(models: Model[]) {
  const a = api()
  if (a) {
    await a.models.save({ models, providers: [] })
  } else {
    localStorage.setItem('manyai_models', JSON.stringify(models))
  }
}

async function saveTasksToDisk(tasks: Task[]) {
  const a = api()
  if (a) {
    await a.tasks.save(tasks)
  } else {
    localStorage.setItem('manyai_tasks', JSON.stringify(tasks))
  }
}

async function loadModelsFromDisk(): Promise<Model[]> {
  const a = api()
  if (a) {
    const data = await a.models.getAll()
    const loaded = data?.models || []
    // 显式过滤掉旧版内置的默认模型，防止空列表时回退
    const bannedIds = new Set(['glm-4-flash', 'glm-4.6v-flash', 'glm-5'])
    return loaded.filter((m: Model) => !bannedIds.has(m.id))
  }
  const loaded: Model[] = safeParse<Model[]>(localStorage.getItem('manyai_models'), [])
  const bannedIds = new Set(['glm-4-flash', 'glm-4.6v-flash', 'glm-5'])
  return Array.isArray(loaded) ? loaded.filter((m: Model) => !bannedIds.has(m.id)) : []
}

async function saveConvToDisk(conv: Conversation) {
  const a = api()
  if (a) {
    await a.conversations.save(conv.id, conv)
  } else {
    const list = safeParse<Conversation[]>(localStorage.getItem('manyai_convs'), [])
    const idx = list.findIndex((c: Conversation) => c.id === conv.id)
    if (idx >= 0) list[idx] = conv
    else list.unshift(conv)
    localStorage.setItem('manyai_convs', JSON.stringify(list))
  }
}

async function deleteConvFromDisk(id: string) {
  const a = api()
  if (a) {
    await a.conversations.delete(id)
  } else {
    const list = safeParse<Conversation[]>(localStorage.getItem('manyai_convs'), [])
    localStorage.setItem('manyai_convs', JSON.stringify(list.filter((c: Conversation) => c.id !== id)))
  }
}

async function loadConvsFromDisk(): Promise<Conversation[]> {
  const a = api()
  if (a) {
    const raw = await a.conversations.getAll()
    return Array.isArray(raw) ? raw : []
  }
  const convs = safeParse<Conversation[]>(localStorage.getItem('manyai_convs'), [])
  return Array.isArray(convs) ? convs : []
}

async function saveConfigToDisk(cfg: Record<string, any>) {
  const a = api()
  if (a) {
    await a.config.set('appConfig', cfg)
  } else {
    localStorage.setItem('manyai_config', JSON.stringify(cfg))
  }
}

async function loadConfigFromDisk(): Promise<Record<string, any>> {
  const a = api()
  if (a) {
    return (await a.config.get('appConfig')) || {}
  }
  return safeParse<Record<string, any>>(localStorage.getItem('manyai_config'), {})
}

async function saveTokenUsageToDisk(records: TokenUsageRecord[]) {
  const a = api()
  if (a) {
    await a.config.set('tokenUsage', records)
  } else {
    localStorage.setItem('manyai_tokenUsage', JSON.stringify(records))
  }
}

async function loadTokenUsageFromDisk(): Promise<TokenUsageRecord[]> {
  const a = api()
  if (a) {
    return (await a.config.get('tokenUsage')) || []
  }
  const usage = safeParse<TokenUsageRecord[]>(localStorage.getItem('manyai_tokenUsage'), [])
  return Array.isArray(usage) ? usage : []
}

async function saveMemoryToDisk(memories: MemoryEntry[]) {
  const a = api()
  if (a) {
    await a.config.set('globalMemory', memories)
  } else {
    localStorage.setItem('manyai_memory', JSON.stringify(memories))
  }
}

async function loadMemoryFromDisk(): Promise<MemoryEntry[]> {
  const a = api()
  if (a) {
    return (await a.config.get('globalMemory')) || []
  }
  const mem = safeParse<MemoryEntry[]>(localStorage.getItem('manyai_memory'), [])
  return Array.isArray(mem) ? mem : []
}

const defaultModels: Model[] = []

// 载入旧版/损坏数据时做字段归一化，避免缺字段导致渲染时 TypeError 白屏
function normalizeModel(m: any): Model {
  return {
    ...m,
    baseUrl: m?.baseUrl ?? '',
    apiKey: m?.apiKey ?? '',
    enabled: m?.enabled !== false,
    advanced: {
      functionCall: !!m?.advanced?.functionCall,
      imageInput: !!m?.advanced?.imageInput,
      reasoning: !!m?.advanced?.reasoning,
      customProtocol: !!m?.advanced?.customProtocol,
      inputPrice: m?.advanced?.inputPrice,
      outputPrice: m?.advanced?.outputPrice,
    },
  }
}

function normalizeTask(t: any): Task {
  return {
    ...t,
    name: t?.name ?? '未命名任务',
    folderPath: t?.folderPath ?? '',
    mainModels: Array.isArray(t?.mainModels) ? t.mainModels : [],
    status: t?.status ?? 'pending',
    messages: Array.isArray(t?.messages) ? t.messages : [],
    subtasks: Array.isArray(t?.subtasks) ? t.subtasks : [],
    createdAt: t?.createdAt ?? Date.now(),
    updatedAt: t?.updatedAt ?? Date.now(),
  }
}

function normalizeConversation(c: any): Conversation {
  return {
    ...c,
    title: c?.title ?? '未命名对话',
    messages: Array.isArray(c?.messages) ? c.messages : [],
    createdAt: c?.createdAt ?? Date.now(),
    updatedAt: c?.updatedAt ?? Date.now(),
  }
}

// ---------------- 旧版本 system 行一次性清洗（2026-09-23） ----------------
// 旧版把引擎状态原文写成 system 消息，形态：
//   「🔧 模型名 正在调用 read...」+「read」成对  /「✅ write_file (五子棋.html)」/「❌ run_command (start ...)」/ 纯「bash」
// 归一为当前视频样式文案（中文动词 + 参数），清洗过的会话回写磁盘，幂等。
const LEGACY_TOOL_VERB: Record<string, string> = {
  read: '已读取', read_file: '已读取',
  write: '已写入', write_file: '已写入',
  edit: '已编辑', edit_file: '已编辑',
  append: '已追加', append_file: '已追加',
  bash: '已运行命令', run_command: '已运行命令',
  list_files: '已浏览目录',
  glob: '已查找文件', find_files: '已查找文件',
  grep: '已搜索内容', search_files: '已搜索内容',
  web_search: '已联网搜索', web_fetch: '已抓取网页',
}

/** 旧进行中行「<模型名> 正在调用 <tool>...」→ 提取工具名；非该格式返回 null */
function legacyCallTool(content: string): string | null {
  const m = content.match(/正在调用\s+([A-Za-z_]+)/)
  return m ? m[1] : null
}

/** 旧完成行「✅ tool (arg)」/「❌ tool (arg)」/ 纯工具名 → 提取工具名与参数；非该格式返回 null */
function legacyDoneTool(content: string): { tool: string; arg: string; failed: boolean } | null {
  const t = content.trim()
  const m = t.match(/^(?:✅|❌)\s*([A-Za-z_]+)(?:\s*\((.*)\))?$/s)
  if (m) return { tool: m[1], arg: (m[2] || '').trim(), failed: t.startsWith('❌') }
  if (LEGACY_TOOL_VERB[t]) return { tool: t, arg: '', failed: false }
  return null
}

/** 遍历 system 消息做旧格式归一；无任何变化时返回原数组引用（changed=false） */
function normalizeLegacySystemLines(messages: Message[]): { changed: boolean; messages: Message[] } {
  let changed = false
  const out: Message[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'system') { out.push(m); continue }
    const c = String(m.content || '')
    const callTool = legacyCallTool(c)
    if (callTool && c.includes('正在调用')) {
      // 旧进行中行：下一条 system 是同名完成行 → 直接丢弃（避免成对重复）；无配对 → 转完成态动词
      const next = messages[i + 1]
      const nextDone = next && next.role === 'system' ? legacyDoneTool(String(next.content || '')) : null
      if (nextDone && nextDone.tool === callTool) { changed = true; continue }
      const verb = LEGACY_TOOL_VERB[callTool]
      if (verb) { changed = true; out.push({ ...m, content: verb }); continue }
      out.push(m); continue
    }
    const done = legacyDoneTool(c)
    if (done && LEGACY_TOOL_VERB[done.tool]) {
      const verb = LEGACY_TOOL_VERB[done.tool]
      const content = done.failed
        ? `❌ ${verb} 失败${done.arg ? `：${done.arg}` : ''}`
        : `${verb}${done.arg ? ' ' + done.arg : ''}`
      if (content !== c) changed = true
      out.push({ ...m, content })
      continue
    }
    // 旧版别名未归一产生的「已处理 X」（实为写入/编辑）：按落盘详情推断真实动词（2026-09-23）
    const vague = c.match(/^已处理(?:\s+(.+))?$/)
    if (vague) {
      const d: any = (m as any).toolDetail
      const arg = vague[1] ? ' ' + vague[1] : ''
      const diff: any[] = d && Array.isArray(d.diff) ? d.diff : []
      const added = diff.filter((x: any) => x && x.t === '+').length
      const removed = diff.filter((x: any) => x && x.t === '-').length
      if (added > 0 && removed === 0) { changed = true; out.push({ ...m, content: `写入${arg}` }); continue }
      if (added > 0 && removed > 0) { changed = true; out.push({ ...m, content: `编辑${arg}` }); continue }
      // 旧版别名导致 buildToolDetail 落成 kind=text（内容=文件全文）——完整文件内容视为写入
      const txt = String(d?.text || '')
      if (txt.length > 500 && /^\s*(?:<!DOCTYPE|<html[\s>]|function\s|import\s|const\s|let\s|var\s|package\s|using\s)/m.test(txt)) {
        changed = true; out.push({ ...m, content: `写入${arg}` }); continue
      }
      out.push(m); continue
    }
    // 旧版中断残留的进行中行（「正在处理 X」）：无配对完成行 → 明确标记为已中断（不能一直挂「正在处理」）
    const stuck = c.match(/^正在处理(?:\s+(.+))?$/)
    if (stuck) {
      const next = messages[i + 1]
      const nextDone = next && next.role === 'system' ? legacyDoneTool(String(next.content || '')) : null
      if (nextDone) { changed = true; continue }
      changed = true
      out.push({ ...m, content: `已中断${stuck[1] ? ' ' + stuck[1] : ''}` })
      continue
    }
    // 旧版空路径占位「浏览目录 .」→ 去掉孤立的点（与 26.9.37 的代码修复对齐）
    if (/^浏览目录\s*\.$/.test(c)) { changed = true; out.push({ ...m, content: '浏览目录' }); continue }
    out.push(m)
  }
  return { changed, messages: changed ? out : messages }
}

// Token 记录：缺字段/脏数据会让统计页求和变成 NaN
function normalizeUsage(r: any): TokenUsageRecord {
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const input = num(r?.inputTokens)
  const output = num(r?.outputTokens)
  return {
    ...r,
    id: r?.id || uuidv4(),
    modelId: r?.modelId || '',
    modelName: r?.modelName || '未知模型',
    timestamp: num(r?.timestamp) || Date.now(),
    inputTokens: input,
    outputTokens: output,
    totalTokens: num(r?.totalTokens) || input + output,
  }
}

interface AppStore {
  loaded: boolean
  // 数据加载失败的原因：早期版本只在 console 里打日志，界面上表现为
  // 「一切正常但数据全空」，用户可能在不知情的情况下被默认值覆盖配置
  loadError: string | null
  config: AppConfig
  models: Model[]
  currentModel: Model | null
  conversations: Conversation[]
  currentConversation: Conversation | null
  sidebarCollapsed: boolean
  showSettings: boolean
  isGenerating: boolean
  appInfo: { version: string; name: string; userDataPath: string; platform: string; arch: string } | null
  activePage: string
  tasks: Task[]
  currentTask: Task | null
  // 新建任务后待自动执行的首条消息（仅内存，不持久化）
  pendingTaskMessage: string | null
  tokenUsage: TokenUsageRecord[]
  modelStatus: Record<string, { online: boolean; lastChecked: number; error?: string }>
  // 各模型上下文用量（会话内，不持久化）
  modelContextUsage: Record<string, { used: number; max: number }>
  // 长期记忆（跨任务）
  globalMemory: MemoryEntry[]

  loadAll: () => Promise<void>
  // 轮 K：旧任务消息一次性迁移为任务下的对话（独立任务界面已删除，历史改在 AI 助理对话页查看）
  migrateTaskMessages: () => Promise<void>
  setConfig: (cfg: Partial<AppConfig>) => void
  addModel: (model: Model) => Promise<void>
  updateModel: (id: string, updates: Partial<Model>) => Promise<void>
  deleteModel: (id: string) => Promise<void>
  setCurrentModel: (m: Model | null) => void
  addConversation: (conv: Conversation) => Promise<void>
  updateConversation: (id: string, updates: Partial<Conversation>) => Promise<void>
  setCurrentConversation: (conv: Conversation | null) => void
  deleteConversation: (id: string) => Promise<void>
  addMessage: (convId: string, msg: Message) => Promise<void>
  updateMessage: (convId: string, msgId: string, content: string, patch?: Partial<Message>) => Promise<void>
  setSidebarCollapsed: (v: boolean) => void
  setShowSettings: (v: boolean) => void
  setIsGenerating: (v: boolean) => void
  setActivePage: (page: string) => void
  addTask: (task: Task) => Promise<void>
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  setCurrentTask: (task: Task | null) => void
  setPendingTaskMessage: (msg: string | null) => void
  addTaskMessage: (taskId: string, msg: TaskMessage) => Promise<void>
  setSubtasks: (taskId: string, subtasks: SubTask[]) => Promise<void>
  toggleSubtask: (taskId: string, subtaskId: string) => Promise<void>
  addTokenUsage: (record: TokenUsageRecord) => Promise<void>
  clearTokenUsage: () => Promise<void>
  checkModelStatus: (modelId: string) => Promise<void>
  setModelContextUsage: (modelId: string, used: number, max: number) => void
  // 长期记忆
  addMemory: (entry: MemoryEntry) => Promise<void>
  getRelevantMemories: (query: string, limit?: number) => MemoryEntry[]
  searchMemory: (keyword: string) => MemoryEntry[]
  deleteMemory: (id: string) => Promise<void>
  clearMemory: () => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  loaded: false,
  loadError: null,
  config: { models: defaultModels, language: 'zh', theme: 'light', sidebarCollapsed: false },
  models: defaultModels,
  currentModel: defaultModels[0],
  conversations: [],
  currentConversation: null,
  sidebarCollapsed: false,
  showSettings: false,
  isGenerating: false,
  appInfo: null,
  activePage: 'chat',
  tasks: [],
  currentTask: null,
  pendingTaskMessage: null,
  tokenUsage: [],
  modelStatus: {},
  modelContextUsage: {},
  globalMemory: [],

  loadAll: async () => {
    try {
      const [models, conversations, savedCfg] = await Promise.all([
        loadModelsFromDisk(),
        loadConvsFromDisk(),
        loadConfigFromDisk(),
      ])
      // 旧版本 system 行一次性清洗（2026-09-23）：旧版把引擎状态原文写进会话
      // （「🔧 模型名 正在调用 read...」+「read」成对、「✅ write_file (x)」等），
      // 归一为当前视频样式文案；清洗过的会话回写磁盘，天然幂等。
      const convList = (Array.isArray(conversations) ? conversations : []).map(normalizeConversation)
      const cleaned = convList.map(c => normalizeLegacySystemLines(c.messages))
      for (let i = 0; i < convList.length; i++) {
        if (cleaned[i].changed) {
          convList[i] = { ...convList[i], messages: cleaned[i].messages }
          await saveConvToDisk(convList[i]).catch(() => {})
        }
      }
      const finalModels = (models.length > 0 ? models : []).map(normalizeModel)
      const appInfo = await window.electronAPI?.app.getInfo() ?? null
      const tasks = (await window.electronAPI?.tasks.getAll() ?? []).map(normalizeTask)
      const tokenUsage = await loadTokenUsageFromDisk()
      const memories = await loadMemoryFromDisk()
      set({
        loaded: true,
        loadError: null,
        models: finalModels,
        currentModel: finalModels.find(m => m.enabled) || finalModels[0] || null,
        conversations: convList,
        config: { ...get().config, ...(savedCfg || {}) },
        sidebarCollapsed: savedCfg?.sidebarCollapsed ?? false,
        isGenerating: false,
        appInfo,
        tasks,
      tokenUsage: Array.isArray(tokenUsage) ? tokenUsage.map(normalizeUsage) : [],
      globalMemory: Array.isArray(memories) ? memories : [],
    })
    } catch (e: any) {
      console.error('loadAll failed:', e)
      set({ loaded: true, loadError: e?.message || '本地数据读取失败' })
    }
    // 独立任务界面已删除（轮 K）：把旧任务消息迁移成任务下的对话，历史在对话页可见
    await get().migrateTaskMessages()
  },

  // 任务消息 → 对话消息一次性迁移：user→user、main→assistant、system→system（工具动作行）。
  // 迁移过的任务打 messagesMigrated 标记并清空 messages（原数据仍在 tasks.json 的历史备份里）。
  migrateTaskMessages: async () => {
    try {
      const tasks = get().tasks
      for (const task of tasks) {
        if ((task as any).messagesMigrated) continue
        const msgs = task.messages || []
        if (msgs.length > 0) {
          const convMessages: Message[] = msgs.map(m => {
            if (m.role === 'user') {
              return { id: uuidv4(), role: 'user', content: m.content, timestamp: m.timestamp } as Message
            }
            if (m.role === 'main') {
              return { id: uuidv4(), role: 'assistant', content: m.content, timestamp: m.timestamp, modelId: m.modelId } as Message
            }
            // system：过程卡片/状态消息 → 工具动作行（⏳ 进行中的残留去掉前缀落为完成态）
            const content = (m.content || '').replace(/^⏳\s*/, '')
            return { id: uuidv4(), role: 'system', content, timestamp: m.timestamp } as Message
          })
          const conv: Conversation = {
            id: uuidv4(),
            title: `${task.name} · 任务记录`,
            messages: convMessages,
            createdAt: msgs[0]?.timestamp || Date.now(),
            updatedAt: msgs[msgs.length - 1]?.timestamp || Date.now(),
            taskId: task.id,
          }
          await get().addConversation(conv)
        }
        const updated = { messages: [], messagesMigrated: true }
        set({ tasks: get().tasks.map(t => (t.id === task.id ? { ...t, ...updated } : t)) })
        await get().updateTask(task.id, updated)
      }
    } catch (e) {
      console.warn('任务消息迁移失败（已忽略，下次启动重试）：', e)
    }
  },

  setConfig: (cfg) => {
    const newCfg = { ...get().config, ...cfg }
    set({ config: newCfg })
    saveConfigToDisk(newCfg)
  },

  addModel: async (model) => {
    const models = [...get().models, model]
    set({ models })
    await saveModelsToDisk(models)
  },
  updateModel: async (id, updates) => {
    const models = get().models.map(m => m.id === id ? { ...m, ...updates } : m)
    set({ models })
    await saveModelsToDisk(models)
  },
  deleteModel: async (id) => {
    const wasCurrent = get().currentModel?.id === id
    const models = get().models.filter(m => m.id !== id)
    // 清理任务里对该模型的引用，避免留下失效 id（执行时会静默换成别的模型）
    const tasks = get().tasks.map(t =>
      Array.isArray(t.mainModels) && t.mainModels.includes(id)
        ? { ...t, mainModels: t.mainModels.filter(mid => mid !== id) }
        : t
    )
    set({
      models,
      tasks,
      // 只有删掉的是当前模型时才切换，避免误改用户正在用的模型
      currentModel: wasCurrent ? (models.find(m => m.enabled) || models[0] || null) : get().currentModel,
    })
    await saveModelsToDisk(models)
    await saveTasksToDisk(tasks)
  },
  setCurrentModel: (m) => set({ currentModel: m }),


  addConversation: async (conv) => {
    const conversations = [conv, ...get().conversations]
    set({ conversations, currentConversation: conv })
    await saveConvToDisk(conv)
  },
  updateConversation: async (id, updates) => {
    let targetConv: Conversation | null = null
    const conversations = get().conversations.map(c => {
      if (c.id === id) {
        targetConv = { ...c, ...updates, updatedAt: Date.now() }
        return targetConv
      }
      return c
    })
    const current = get().currentConversation
    set({
      conversations,
      currentConversation: current?.id === id ? targetConv : current,
    })
    if (targetConv) await saveConvToDisk(targetConv)
  },
  setCurrentConversation: (conv) => set({ currentConversation: conv }),
  deleteConversation: async (id) => {
    const conversations = get().conversations.filter(c => c.id !== id)
    set({ conversations, currentConversation: get().currentConversation?.id === id ? null : get().currentConversation })
    await deleteConvFromDisk(id)
  },

  addMessage: async (convId, msg) => {
    let targetConv: Conversation | null = null
    const conversations = get().conversations.map(c => {
      if (c.id === convId) {
        targetConv = { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
        return targetConv
      }
      return c
    })
    const current = get().currentConversation
    set({
      conversations,
      currentConversation: current?.id === convId ? targetConv : current,
    })
    if (targetConv) await saveConvToDisk(targetConv)
  },
  updateMessage: async (convId, msgId, content, patch) => {
    let targetConv: Conversation | null = null
    const conversations = get().conversations.map(c => {
      if (c.id === convId) {
        targetConv = { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, content, ...(patch || {}) } : m) }
        return targetConv
      }
      return c
    })
    const current = get().currentConversation
    set({
      conversations,
      currentConversation: current?.id === convId ? targetConv : current,
    })
    if (targetConv) await saveConvToDisk(targetConv)
  },

  setSidebarCollapsed: (v) => {
    set({ sidebarCollapsed: v })
    const cfg = { ...get().config, sidebarCollapsed: v }
    set({ config: cfg })
    saveConfigToDisk(cfg)
  },
  setShowSettings: (v) => set({ showSettings: v }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setActivePage: (page) => set({ activePage: page }),

  // Task management
  addTask: async (task) => {
    const tasks = [...get().tasks, task]
    set({ tasks })
    await saveTasksToDisk(tasks)
  },
  updateTask: async (id, updates) => {
    const tasks = get().tasks.map(t => t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t)
    set({ tasks })
    if (get().currentTask?.id === id) {
      set({ currentTask: { ...get().currentTask!, ...updates } })
    }
    await saveTasksToDisk(tasks)
  },
  deleteTask: async (id) => {
    const tasks = get().tasks.filter(t => t.id !== id)
    set({ tasks })
    if (get().currentTask?.id === id) {
      set({ currentTask: null })
    }
    // 解绑归属：该任务下的对话保留为独立对话，否则会从侧边栏永久消失
    const orphans = get().conversations.filter(c => c.taskId === id)
    if (orphans.length > 0) {
      const conversations = get().conversations.map(c =>
        c.taskId === id ? { ...c, taskId: undefined } : c
      )
      set({ conversations })
      for (const c of orphans) await saveConvToDisk({ ...c, taskId: undefined })
    }
    await saveTasksToDisk(tasks)
  },
  setCurrentTask: (task) => set({ currentTask: task }),
  setPendingTaskMessage: (msg) => set({ pendingTaskMessage: msg }),
  addTaskMessage: async (taskId, msg) => {
    const tasks = get().tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, messages: [...t.messages, msg], updatedAt: Date.now() }
      }
      return t
    })
    set({ tasks })
    if (get().currentTask?.id === taskId) {
      set({ currentTask: { ...get().currentTask!, messages: [...get().currentTask!.messages, msg] } })
    }
    await saveTasksToDisk(tasks)
  },
  setSubtasks: async (taskId, subtasks) => {
    const tasks = get().tasks.map(t => t.id === taskId ? { ...t, subtasks, updatedAt: Date.now() } : t)
    set({ tasks })
    if (get().currentTask?.id === taskId) {
      set({ currentTask: { ...get().currentTask!, subtasks } })
    }
    await saveTasksToDisk(tasks)
  },
  toggleSubtask: async (taskId, subtaskId) => {
    const tasks = get().tasks.map(t => {
      if (t.id === taskId) {
        return { ...t, subtasks: t.subtasks.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s), updatedAt: Date.now() }
      }
      return t
    })
    set({ tasks })
    if (get().currentTask?.id === taskId) {
      const task = tasks.find(t => t.id === taskId)
      if (task) set({ currentTask: task })
    }
    await saveTasksToDisk(tasks)
  },

  addTokenUsage: async (record) => {
    const tokenUsage = [...get().tokenUsage, record]
    set({ tokenUsage })
    await saveTokenUsageToDisk(tokenUsage)
  },
  clearTokenUsage: async () => {
    set({ tokenUsage: [] })
    await saveTokenUsageToDisk([])
  },
  checkModelStatus: async (modelId: string) => {
    const model = get().models.find(m => m.id === modelId)
    if (!model) return

    set({ modelStatus: { ...get().modelStatus, [modelId]: { online: false, lastChecked: Date.now(), error: '检测中...' }}})

    try {
      let online = false
      const baseUrl = model.baseUrl || ''
      const apiKey = model.apiKey || ''
      if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        // Check local Ollama
        const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(3000) })
        online = res.ok
      } else {
        // Check OpenAI-compatible API
        const res = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000)
        })
        online = res.ok
      }
      set({ modelStatus: { ...get().modelStatus, [modelId]: { online, lastChecked: Date.now() }}})
    } catch (e) {
      set({ modelStatus: { ...get().modelStatus, [modelId]: { online: false, lastChecked: Date.now(), error: String(e).slice(0, 100) }}})
    }
  },
  // 更新模型上下文用量（仅内存，供侧边栏环形指示器显示）
  setModelContextUsage: (modelId: string, used: number, max: number) => {
    set({ modelContextUsage: { ...get().modelContextUsage, [modelId]: { used, max } } })
  },
  // 长期记忆：添加记忆条目
  addMemory: async (entry: MemoryEntry) => {
    const memories = [entry, ...get().globalMemory].slice(0, 200) // 最多保留 200 条
    set({ globalMemory: memories })
    await saveMemoryToDisk(memories)
    // 同步副本到 <工作目录>/.deepwork/memory.md（fire-and-forget，失败静默）
    persistMemoryMd(undefined, memories).catch(() => {})
  },
  // 检索相关记忆（简单关键词匹配 + 时间衰减）
  getRelevantMemories: (query: string, limit: number = 5) => {
    const memories = get().globalMemory
    if (!memories.length) return []
    const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(Boolean)
    if (!keywords.length) return memories.slice(0, limit)
    const scored = memories.map(m => {
      let score = 0
      const text = `${m.summary} ${(m.keywords || []).join(' ')} ${(m.files || []).join(' ')}`.toLowerCase()
      for (const kw of keywords) {
        if (text.includes(kw)) score += 2
      }
      // 时间衰减：最近的记忆权重更高
      const daysOld = (Date.now() - m.timestamp) / (1000 * 60 * 60 * 24)
      score *= Math.max(0.3, 1 - daysOld / 30)
      return { entry: m, score }
    })
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry)
  },
  deleteMemory: async (id: string) => {
    const memories = get().globalMemory.filter(m => m.id !== id)
    set({ globalMemory: memories })
    await saveMemoryToDisk(memories)
    persistMemoryMd(undefined, memories).catch(() => {})
  },
  clearMemory: async () => {
    set({ globalMemory: [] })
    await saveMemoryToDisk([])
    persistMemoryMd(undefined, []).catch(() => {})
  },
  searchMemory: (keyword: string) => {
    const kw = keyword.toLowerCase()
    return get().globalMemory.filter(m =>
      (m.summary || '').toLowerCase().includes(kw) ||
      (m.keywords || []).some((k: string) => k.toLowerCase().includes(kw)) ||
      (m.files || []).some((f: string) => f.toLowerCase().includes(kw))
    )
  },
}))

// 跨窗口配置同步（2026-09-26 修复）：设置是独立窗口，改配置只更新「本窗口」store 并落盘，
// 主进程会把 config:changed('appConfig', cfg) 广播给「其他」窗口；此前渲染进程没监听，
// 导致主窗口要重启才生效（壁纸/主题/人格等所有跨窗口配置）。这里注册一次，收到即合并进本地 store。
// 主进程已排除发送者自身，故不会回环；发送者本地 setConfig 已即时更新，这里只同步接收方。
if (typeof window !== 'undefined') {
  const ea: any = (window as any).electronAPI
  // 注意：preload 暴露的是 config.onChange（不是 onChanged）
  if (ea?.config?.onChange) {
    ea.config.onChange((key: string, value: any) => {
      if (key === 'appConfig' && value && typeof value === 'object') {
        const cur = (useAppStore.getState().config as any) || {}
        useAppStore.setState({ config: { ...cur, ...value } })
      }
    })
  }
}
