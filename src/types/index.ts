export interface Model {
  id: string
  name: string
  provider: string
  apiKey?: string
  baseUrl?: string
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
  capability?: string    // 用户描述的擅长能力
}

export interface Provider {
  id: string
  name: string
  icon?: string
  color?: string
  baseUrl: string
  models: string[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  modelId?: string
  thinking?: string
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  modelId?: string
}

export interface AppConfig {
  models: Model[]
  providers: Provider[]
  currentModelId?: string
  currentConversationId?: string
  language: 'zh' | 'en'
  theme: 'light' | 'dark'
  sidebarCollapsed: boolean
  // 智能体设置
  agentSystemPrompt?: string
  agentTemperature?: number
  agentStreaming?: boolean
  agentAutoScroll?: boolean
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
  // 沙箱细分策略
  fileWhitelist?: string
  fileBlacklist?: string
  cmdAllowList?: string
  cmdAskList?: string
  netAllowedDomains?: string
  netBlockedDomains?: string
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

export interface AICapability {
  modelId: string
  strengths: string[]    // 擅长领域（自动询问 + 用户描述）
  weaknesses: string[]   // 不擅长领域
  rating: number         // 综合评分 1-10
  compositeScore: number // 综合能力分（结合参数量+评分+成功率，用于任务分配排序）
  taskCount: number      // 完成任务数
  successRate: number    // 成功率
  failureCount: number   // 连续/累计失败次数（用于重复失败检测）
  lastError?: string     // 最近一次失败原因
  autoAssessed: boolean  // 是否已自动询问过
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
