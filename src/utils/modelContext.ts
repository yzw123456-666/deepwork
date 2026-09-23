// 模型上下文窗口自动评估：按模型名匹配内置知识库，返回 token 数；未知返回 null
// 数值来源：各官方文档公开的上下文长度（2026-09），仅作为默认值，用户可手动修改

interface CtxEntry {
  match: string[]          // 模型名包含任一关键字（小写）即命中，按顺序优先匹配
  contextWindow: number
}

const KB: CtxEntry[] = [
  // 智谱 GLM
  { match: ['glm-5.3-flash'], contextWindow: 1000000 },
  { match: ['glm-5.3'], contextWindow: 1000000 },
  { match: ['glm-5-air'], contextWindow: 200000 },
  { match: ['glm-5'], contextWindow: 1000000 },
  { match: ['glm-4.7-flash'], contextWindow: 200000 },
  { match: ['glm-4.7'], contextWindow: 200000 },
  { match: ['glm-4.6'], contextWindow: 200000 },
  { match: ['glm-4.5-air'], contextWindow: 131072 },
  { match: ['glm-4.5-flash'], contextWindow: 128000 },
  { match: ['glm-4.5'], contextWindow: 131072 },
  { match: ['glm-4-plus', 'glm-4-0520'], contextWindow: 128000 },
  { match: ['glm-4-flash'], contextWindow: 128000 },
  { match: ['glm-4-long'], contextWindow: 1000000 },
  { match: ['glm-4'], contextWindow: 128000 },
  // DeepSeek
  { match: ['deepseek-chat', 'deepseek-v3'], contextWindow: 64000 },
  { match: ['deepseek-reasoner', 'deepseek-r1'], contextWindow: 64000 },
  // OpenAI
  { match: ['gpt-4.1'], contextWindow: 1000000 },
  { match: ['gpt-4o'], contextWindow: 128000 },
  { match: ['gpt-4-turbo'], contextWindow: 128000 },
  { match: ['gpt-4'], contextWindow: 8192 },
  { match: ['gpt-3.5'], contextWindow: 16385 },
  { match: ['o1', 'o3', 'o4-mini'], contextWindow: 200000 },
  // Anthropic
  { match: ['claude'], contextWindow: 200000 },
  // 通义千问
  { match: ['qwen-long'], contextWindow: 10000000 },
  { match: ['qwen-turbo'], contextWindow: 1000000 },
  { match: ['qwen-plus'], contextWindow: 131072 },
  { match: ['qwen-max'], contextWindow: 32768 },
  { match: ['qwen3'], contextWindow: 131072 },
  { match: ['qwen2.5'], contextWindow: 32768 },
  // Moonshot / Kimi
  { match: ['kimi'], contextWindow: 131072 },
  // Google
  { match: ['gemini-1.5-pro'], contextWindow: 2000000 },
  { match: ['gemini-1.5-flash'], contextWindow: 1000000 },
  { match: ['gemini'], contextWindow: 1048576 },
  // Meta
  { match: ['llama-3.1', 'llama-3.3'], contextWindow: 131072 },
  { match: ['llama-3'], contextWindow: 8192 },
  // Mistral
  { match: ['mistral', 'mixtral'], contextWindow: 32768 },
]

// 从模型名中解析显式标注的窗口大小，如 "chat-128k" → 128000、"model-1m" → 1000000
function parseInlineSize(name: string): number | null {
  const k = name.match(/(\d+)\s*k\b/)
  if (k) return parseInt(k[1]) * 1000
  const m = name.match(/(\d+)\s*m\b/)
  if (m) return parseInt(m[1]) * 1000000
  return null
}

export function guessContextWindow(modelName: string): number | null {
  const name = (modelName || '').toLowerCase().trim()
  if (!name) return null
  for (const entry of KB) {
    if (entry.match.some(keyword => name.includes(keyword))) return entry.contextWindow
  }
  return parseInlineSize(name)
}
