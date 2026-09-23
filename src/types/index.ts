export interface Model {
  id: string
  name: string
  baseUrl: string           // API 端点，如 https://open.bigmodel.cn/api/paas/v4
  apiKey: string
  enabled: boolean
  parameterSize?: string    // 模型参数量，如 "7B", "14B", "70B"
  contextWindow?: number    // 上下文窗口大小（tokens），如 4096, 32768, 128000
  advanced: {
    functionCall: boolean
    imageInput: boolean
    reasoning: boolean
    customProtocol: boolean
    inputPrice?: number
    outputPrice?: number
  }
}

// 随消息持久化的附件元数据：用于在气泡内回显缩略图、点击预览原文件
export interface MessageAttachment {
  path: string
  name: string
  kind: string
  size?: number
  icon: 'image' | 'video' | 'text' | 'file'
}

/**
 * 工具动作行的可展开详情（2026-09-23，严格按照用户视频样例）：
 * 编辑类展开显示红绿 diff（+N -M 统计），命令类展开显示命令本体 + 运行状态，
 * 搜索/读取类展开显示结果文本。旧消息无此字段 → 纯行不可展开，正常兼容。
 */
export interface ToolDetail {
  kind: 'edit' | 'command' | 'text'
  /** 编辑类：增/删行数统计（显示在动作行尾部 +N -M） */
  stat?: { added: number; removed: number }
  /** 编辑类：行级 diff（t=+/-/空格，s=行文本），渲染红/绿/原色 */
  diff?: Array<{ t: '+' | '-' | ' '; s: string }>
  /** 面板主文本：命令本体 / 内容片段 / 结果列表（已截断） */
  text?: string
  /** 命令类：执行输出（单独展示） */
  output?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  modelId?: string
  thinking?: string
  attachments?: MessageAttachment[]
  duration?: number  // 生成耗时（毫秒），流式结束时写入
  toolDetail?: ToolDetail  // 工具动作行的展开详情（system 消息专用）
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  modelId?: string
  taskId?: string   // 归属任务：存在时在侧边栏嵌套显示在该任务下
}

export interface AppConfig {
  models: Model[]
  currentModelId?: string
  currentConversationId?: string
  language: 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  // 主题色（accent）：决定整体色相，界面所有位置（含原本的白色）都会被该色系晕染
  accent?: 'sky' | 'deepblue' | 'navy' | 'violet' | 'emerald' | 'teal' | 'lime' | 'rose' | 'amber'
  sidebarCollapsed: boolean
  // 智能体设置
  agentSystemPrompt?: string
  agentTemperature?: number
  agentStreaming?: boolean
  agentAutoScroll?: boolean
  // 长期记忆
  memoryEnabled?: boolean
  autoMemory?: boolean
  // 个性化
  fontSize?: 'small' | 'medium' | 'large'
  showTimestamp?: boolean
  sendKey?: 'enter' | 'ctrlEnter'
  // 快捷键
  shortcutNewChat?: string
  shortcutOpenSettings?: string
  shortcutToggleSidebar?: string
  // 安全中心
  maskApiKeys?: boolean
  confirmBeforeDelete?: boolean
  sandboxEnabled?: boolean
  deleteProtection?: boolean
  batchDeleteThreshold?: number
  autoBackup?: boolean
  backupMaxSize?: number
  systemTools?: 'disabled' | 'enabled'
  // 单模型任务备用模型：''=不启用 'auto'=自动选择 其他=指定模型id
  fallbackModelId?: string
  // 新建任务的默认命令执行权限（历史遗留，现由 chatPermission 下拉同时决定）
  taskDefaultPermission?: 'default' | 'enabled' | 'disabled'
  // 对话页权限档位（输入框左下下拉）：default=按安全中心执行；full=完全访问（绕过安全中心与删除保护，allowExec 强制开启）
  chatPermission?: 'default' | 'full'
  // 对话页（ChatArea）工具链的工作目录：文件读写/命令执行的根目录
  // 为空时由主进程返回系统「文档」目录
  chatWorkDir?: string
  // 对话页是否启用工具（读写文件 / 执行命令）。默认开启
  chatToolsEnabled?: boolean
  // 对话页是否允许执行命令（关闭时仍可读写文件）
  chatAllowExec?: boolean
  // 沙箱细分策略
  fileWhitelist?: string
  fileBlacklist?: string
  cmdAllowList?: string
  cmdAskList?: string
  netAllowedDomains?: string
  netBlockedDomains?: string
  // AI 工具（图片/视频生成与理解）
  aiTools?: AIToolConfig[]
}

export interface Skill {
  id: string
  name: string
  description: string
  category: string
  enabled: boolean
  prompt: string
}

export interface Tool {
  id: string
  name: string
  description: string
  parameters: Record<string, any>
  execute: (params: any) => Promise<any>
}

// AI 工具（更多 → AI 工具）：可开启的扩展能力，每个工具可配置专用 API
export type AIToolId = 'image-gen' | 'video-gen' | 'image-understand' | 'video-understand'

export interface AIToolConfig {
  id: AIToolId
  enabled: boolean
  baseUrl: string      // 专用 API 端点，如 https://open.bigmodel.cn/api/paas/v4
  apiKey: string
  model: string        // 专用模型名
}

export interface Task {
  id: string
  name: string
  folderPath: string           // 工作文件夹（必选）
  mainModels: string[]         // 执行模型ID列表（第一个主用，其余备用）
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: number
  updatedAt: number
  messages: TaskMessage[]
  subtasks: SubTask[]          // 子任务清单
  execPermission?: 'default' | 'enabled' | 'disabled'  // 任务级命令执行权限：default 跟随安全中心
  thinkingDepth?: 'low' | 'high' | 'max'               // 思考深度：低/高/最高（默认高）
  messagesMigrated?: boolean                            // 轮 K：旧任务消息已迁移为对话（独立任务界面已删除，历史在 AI 助理对话页查看）
}

export interface SubTask {
  id: string
  text: string
  completed: boolean
}

export interface TaskMessage {
  id: string
  role: 'user' | 'main' | 'system'
  content: string
  modelId?: string             // 执行此消息的模型
  assignedTo?: string          // 分配给哪个模型
  timestamp: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  /** 工具调用步骤的结构化数据：用于「过程时间线」按类型渲染图标/副标题/可展开详情，
   *  不再靠正则解析 content 字符串（旧数据无此字段时回退字符串解析） */
  step?: TaskStep
}

// 单个工具调用步骤（思考过程时间线的一行）
export interface TaskStep {
  tool: string                 // 原始工具名，如 read_file / run_command / web_search
  kind: 'read' | 'edit' | 'command' | 'search' | 'skill' | 'other'
  title: string                // 主标题，如「已读取 src/App.tsx」
  /** 文件路径 / 命令 / 关键词等附加定位信息（用于等宽字体高亮显示） */
  detail?: string
  /** 次级说明，如「5 results」「替换 2 处」「退出码 0」 */
  meta?: string
  /** 编辑类：新增/删除行数（来自 old_str/new_str 的行数差） */
  added?: number
  removed?: number
  /** 展开后的详情正文（命令输出、搜索结果、抓取内容等） */
  output?: string
  ok: boolean
  notice?: string
  durationMs?: number          // 该步骤耗时
}

export interface TokenUsageRecord {
  id: string
  modelId: string
  modelName: string
  timestamp: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// 长期记忆条目（跨任务）
export interface MemoryEntry {
  id: string
  timestamp: number
  taskId?: string       // 来源任务
  taskName?: string
  summary: string       // 核心摘要（如：创建了五子棋项目，文件 index.html/style.css）
  keywords: string[]    // 关键词用于检索（如：["五子棋", "HTML", "Canvas", "游戏逻辑"]）
  files: string[]       // 涉及的关键文件
  outcome: 'success' | 'partial' | 'failed'
}
