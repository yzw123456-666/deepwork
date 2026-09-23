// ---------- 长期记忆 md 落盘（2026-09-22 升级） ----------
// 用户要求：长期记忆存到「项目根目录」的 .deepwork 文件夹中的 md 文件里。
// 这里「项目根目录」= 当前对话/任务的工作目录（root），文件为 <root>/.deepwork/memory.md。
// 设计：
//   - store.globalMemory（config.json）仍是主数据（注入提示词用它，同步、快）；
//   - 本模块把记忆全量渲染成人类可读的 markdown，作为**可带走的副本**写到工作目录，
//     用户可以查看/备份/提交进仓库；
//   - 不依赖 store（由调用方传入 memories），避免与 stores/index.ts 循环引用。
import { MemoryEntry } from '../types'

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const OUTCOME_TEXT: Record<string, string> = { success: '成功', partial: '部分完成', failed: '失败' }

/** 把记忆列表渲染成 markdown（按日期分组，新日期在上） */
export function renderMemoryMd(memories: MemoryEntry[]): string {
  const list = (memories || []).slice().sort((a, b) => b.timestamp - a.timestamp)
  const head = [
    '# deepwork 长期记忆',
    '',
    `> 本文件由 deepwork 自动维护（最近更新：${new Date().toLocaleString('zh-CN')}）。`,
    '> AI 完成任务后自动沉淀一条记忆；应用内的注入与检索以应用内数据为准，这里是人类可读的完整副本。',
    '',
  ]
  if (list.length === 0) {
    return [...head, '_还没有任何记忆。完成任务或手动添加后会出现在这里。_', ''].join('\n')
  }
  const byDate = new Map<string, MemoryEntry[]>()
  for (const m of list) {
    const day = fmtDate(m.timestamp)
    if (!byDate.has(day)) byDate.set(day, [])
    byDate.get(day)!.push(m)
  }
  const body: string[] = []
  for (const [day, entries] of byDate) {
    body.push(`## ${day}`, '')
    for (const m of entries) {
      const bits: string[] = []
      if (m.taskName) bits.push(`**${m.taskName}**`)
      if (m.outcome) bits.push(`（${OUTCOME_TEXT[m.outcome] || m.outcome}）`)
      body.push(`- ${[...bits, m.summary].filter(Boolean).join(' ')}`)
      const meta: string[] = []
      if (m.keywords && m.keywords.length) meta.push(`关键词：${m.keywords.join('、')}`)
      if (m.files && m.files.length) meta.push(`文件：${m.files.slice(0, 6).join('、')}`)
      if (meta.length) body.push(`  - ${meta.join('；')}`)
    }
    body.push('')
  }
  return [...head, ...body].join('\n')
}

/**
 * 把记忆写入 <root>/.deepwork/memory.md。
 * root 缺省时走 app:getDefaultWorkDir（documents → desktop → downloads → userData 回退）。
 * 任何失败都静默忽略——记忆落盘绝不能影响主流程。
 */
export async function persistMemoryMd(root: string | undefined, memories: MemoryEntry[]): Promise<void> {
  try {
    let dir = String(root || '').trim()
    if (!dir) {
      const res: any = await window.electronAPI?.app.getDefaultWorkDir()
      // handler 直接返回字符串（test-chat-e2e 验证过）；兼容 { dir } 包装
      dir = typeof res === 'string' ? res : String(res?.dir || '')
    }
    if (!dir) return
    const md = renderMemoryMd(memories)
    await window.electronAPI?.agent.writeFile(dir, '.deepwork/memory.md', md)
  } catch {
    // 静默：写不进去（比如策略拦截/磁盘只读）也不影响主流程
  }
}
