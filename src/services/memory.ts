// ---------- 长期记忆：提示词注入 ----------
// 记忆数据在 store 里（持久化到 userData/config.json 的 globalMemory），
// 这里只负责把它整理成一小段系统提示词，供普通对话与 Agent 任务共同使用。
import { useAppStore } from '../stores'
import { MemoryEntry, Model } from '../types'
import { callModel } from './agentEngine'

export function memoryEnabled(): boolean {
  const cfg = useAppStore.getState().config as any
  return cfg?.memoryEnabled !== false
}

export function autoMemoryEnabled(): boolean {
  const cfg = useAppStore.getState().config as any
  return cfg?.autoMemory !== false
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 取与当前输入相关的历史记忆，整理成系统提示片段。
 * 没有相关记忆或功能被关闭时返回空串，调用方直接拼接即可。
 */
export function buildMemoryBlock(query: string, limit = 5): string {
  if (!memoryEnabled()) return ''
  const store = useAppStore.getState()
  const memories: MemoryEntry[] = (store.globalMemory || []).slice()
  if (memories.length === 0) return ''

  const relevant = store.getRelevantMemories(query, limit)
  const list = relevant.length > 0 ? relevant : memories.slice(0, Math.min(limit, 3))

  const outcomeText: Record<string, string> = { success: '成功', partial: '部分完成', failed: '失败' }
  const lines = list.map(m => {
    const bits = [`[${fmtDate(m.timestamp)}]`]
    if (m.taskName) bits.push(`任务「${m.taskName}」`)
    if (m.outcome) bits.push(`（${outcomeText[m.outcome] || m.outcome}）`)
    bits.push(m.summary)
    if (m.files && m.files.length) bits.push(`涉及文件：${m.files.slice(0, 6).join('、')}`)
    return `- ${bits.join(' ')}`
  })

  return `\n\n## 关于用户的历史记忆（来自以往任务，默认可信；与当前输入冲突时以用户当前说法为准）\n${lines.join('\n')}`
}

// ---------- 自动沉淀记忆 ----------
// 任务成功收尾后，让模型把这次做了什么压成一条结构化记忆，供以后检索。
// 失败/超时一律静默放弃，绝不影响任务主流程。

/** 从可能被 ```json 包裹的回复里抠出第一个 JSON 对象 */
function extractJsonObject(raw: string): any | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function autoSummarizeMemory(
  model: Model,
  taskName: string,
  userRequest: string,
  result: string,
  taskId: string,
  outcome: 'success' | 'partial' | 'failed' = 'success',
  signal?: AbortSignal
): Promise<MemoryEntry | null> {
  if (!autoMemoryEnabled()) return null
  const prompt = `把下面这次已完成的 AI 任务，压缩成一条长期记忆，供以后的对话检索。

任务名：${taskName}
用户需求：${String(userRequest || '').slice(0, 1200)}
执行结果：${String(result || '').slice(0, 2000)}

只输出一个 JSON 对象，不要任何解释，不要代码块：
{"summary":"一句话说清做了什么（40 字以内，含关键技术/产物名）","keywords":["3-6 个检索关键词"],"files":["涉及的关键文件名，没有就空数组"]}

要求：summary 用中文；keywords 要能覆盖用户以后可能的问法；files 只写文件名或相对路径，最多 6 个。`

  try {
    const { content: raw } = await callModel(model, [{ role: 'user', content: prompt }], 0.2, signal)
    const data = extractJsonObject(raw)
    if (!data || typeof data.summary !== 'string' || !data.summary.trim()) return null
    const summary = data.summary.trim().slice(0, 300)
    const keywords = Array.isArray(data.keywords)
      ? data.keywords.filter((k: any) => typeof k === 'string' && k.trim()).slice(0, 8).map((k: string) => k.trim().slice(0, 40))
      : []
    const files = Array.isArray(data.files)
      ? data.files.filter((f: any) => typeof f === 'string' && f.trim()).slice(0, 6).map((f: string) => f.trim().slice(0, 160))
      : []
    return {
      id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      timestamp: Date.now(),
      taskId,
      taskName,
      summary,
      keywords,
      files,
      outcome,
    }
  } catch {
    return null
  }
}
