// ---------- 思考区显示层的代码折叠（2026-09-22 轮 J） ----------
// 用户三次反馈「思考过程中出现代码」（截图：```js 围栏块、无围栏的 const/function 裸代码）。
// 根因：轮 G 只给对话页 ThinkingBlock 接了清洗，任务视图（TaskWorkspace）的思考区没有；
// 且 dropCodeBlocks 只认围栏与 HTML 文档，模型输出不带 ``` 的裸代码（const/function 逐行）
// 完全漏网。
// 原则：落盘保留思考原文（完整推理可回溯），**显示层**一律把代码折叠成一行「📄 代码草稿（未写入文件）」。
// 本模块为 ChatArea 与 TaskWorkspace 共用，避免两份实现漂移。

export const CODE_NOTE = '📄 代码草稿（未写入文件）'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 围栏代码块（含流式中未闭合的 ```）→ 一行提示；裸 HTML 文档同样处理。
 * 与 ChatArea.dropCodeBlocks 的围栏/HTML 部分语义一致。
 */
export function foldFenceBlocks(content: string): string {
  if (!content) return content
  const hasFence = content.includes('```')
  const hasHtmlDoc = /<!DOCTYPE[^>]*>|<html[\s>]/i.test(content)
  if (!hasFence && !hasHtmlDoc) return content
  let out = content.replace(/```[^\n]*\n[\s\S]*?```/g, CODE_NOTE).replace(/```[^\n]*\n[\s\S]*$/, CODE_NOTE)
  out = out
    .replace(/<!DOCTYPE[^>]*>[\s\S]*?<\/html\s*>/gi, CODE_NOTE)
    .replace(/<html[^>]*>[\s\S]*?<\/html\s*>/gi, CODE_NOTE)
    .replace(/(^|\n)\s*<!DOCTYPE[^>]*>[\s\S]*$/i, CODE_NOTE)
    .replace(/(^|\n)\s*<html[^>]*>[\s\S]*$/i, CODE_NOTE)
  out = out.replace(new RegExp(`(?:${escapeRegExp(CODE_NOTE)}\\s*){2,}`, 'g'), CODE_NOTE)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * 单行是否像代码（裸代码启发式的一环）。
 * 必须多行连续命中才折叠（foldBareCode），单行命中不折叠——防止误伤
 * 「const x = 1 的写法」「return 之后判断」这类正文提及。
 */
export function isCodeLine(line: string): boolean {
  const s = line.trim()
  if (!s) return false
  if (/^(?:const\s|let\s|var\s|function\s+|class\s|import\s|export\s)/.test(s)) return true
  if (/^(?:if|for|while|switch|catch|else)\s*[({]/.test(s)) return true
  if (/^return\b/.test(s)) return true
  if (/^\}/.test(s)) return true
  if (/[{};]\s*$/.test(s) && /[=(){}[\]<>]|=>/.test(s)) return true
  if (/\)\s*\{\s*$/.test(s)) return true
  return false
}

/**
 * 无围栏裸代码：连续 ≥3 行代码特征行（允许中间空行）整段折叠成一行提示。
 * 「const CSS_SIZE = 640; … function cellSize() { … } …」这类思考草稿没有 ``` 围栏，
 * 只能靠行特征识别。阈值 3 行：两行以内的零星代码样文本不折叠（防误伤）。
 */
export function foldBareCode(content: string): string {
  if (!content) return content
  const lines = content.split('\n')
  const out: string[] = []
  let buf: string[] = []
  let codeCount = 0
  const flush = () => {
    if (codeCount >= 3) out.push(CODE_NOTE)
    else out.push(...buf)
    buf = []
    codeCount = 0
  }
  for (const line of lines) {
    if (isCodeLine(line)) {
      buf.push(line)
      codeCount++
      continue
    }
    if (!line.trim()) {
      // 空行：在代码段缓冲内则暂存（段内空行），否则直接输出
      if (buf.length) buf.push(line)
      else out.push(line)
      continue
    }
    flush()
    out.push(line)
  }
  flush()
  const joined = out.join('\n')
  // 折叠后可能产生重复提示行与堆积空行，清一遍
  return joined
    .replace(new RegExp(`(?:^|\\n)${escapeRegExp(CODE_NOTE)}(?:\\s*\\n${escapeRegExp(CODE_NOTE)})+`, 'g'), '\n' + CODE_NOTE)
    .replace(/\n{3,}/g, '\n\n')
}

/** 思考区显示层总入口：围栏 + HTML 文档 + 无围栏裸代码 全部折叠成一行「📄 代码草稿（未写入文件）」 */
export function sanitizeThinkingDisplay(content: string): string {
  if (!content) return content
  return foldBareCode(foldFenceBlocks(content))
}
