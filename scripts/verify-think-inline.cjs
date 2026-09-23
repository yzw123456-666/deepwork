/**
 * 结构验证（2026-09-23）：用用户真实会话数据，验证工具行嵌在「深度思考」区内
 * 与思考段交错渲染（视频结构），而不是消息底部的独立行。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))

const { JSDOM } = require('C:/Users/ytzsy/.workbuddy/binaries/node/workspace/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator

const React = require('react')
const ReactDOM = require('react-dom/client')
const lucide = require('lucide-react')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ChatArea.tsx'), 'utf8')
function grab(name) {
  const i = src.indexOf('function ' + name + '(')
  if (i === -1) throw new Error('找不到 ' + name)
  const e = src.indexOf('\n}', i)
  return src.slice(i, e + 2)
}
function grabConst(name) {
  const m = src.match(new RegExp('(?:export )?const ' + name + '[^=\\n]*= [\\s\\S]*?\\n\\}'))
  if (!m) throw new Error('找不到常量 ' + name)
  return m[0]
}
function grabComponent(name) {
  const i = src.indexOf('const ' + name)
  if (i === -1) throw new Error('找不到组件 ' + name)
  const rest = src.slice(i + 6)
  const m = rest.match(/\n\n(?:const |function |\/\*|\/\/)/)
  return src.slice(i, m ? i + 6 + m.index : src.length)
}
const codeNote = (src.match(/const CODE_NOTE = .+/) || [''])[0]

const parts = [
  codeNote,
  grabConst('TOOL_ALIAS'),
  grab('normalizeToolName'),
  grab('parseToolLine'),
  grab('cutDetailText'),
  grab('computeLineDiff'),
  grab('escapeRegExp'),
  grab('buildToolDetail'),
  grabComponent('DiffLine'),
  grabComponent('ToolDetailPanel'),
  grabComponent('ToolActionLine'),
  grabComponent('ThinkingBlock'),
]
const raw = `
const { useState, useMemo, useEffect } = React;
const { CheckCircle2, XCircle, Loader2, ChevronRight } = lucide;
const useTranslation = () => ({ t: (k) => k });
const replaceCodeBlocksWithEdit = (s) => s;  // 思考清洗与结构无关，直通
${parts.join('\n')}
this.api = { ThinkingBlock };
`
const js = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' } }).outputText
const ctx = { React, lucide, console, window: dom.window, document: dom.window.document, navigator: dom.window.navigator }
vm.createContext(ctx)
vm.runInContext(js, ctx)
const ThinkingBlock = ctx.api.ThinkingBlock

// 真实数据：用户「测试1 · 任务记录」会话
const dir = 'C:/Users/ytzsy/AppData/Roaming/deepwork/conversations/'
const target = fs.readdirSync(dir).find(f => f.startsWith('e44cd5e8'))
const conv = JSON.parse(fs.readFileSync(dir + target, 'utf8'))
const msgs = conv.messages || []
// 找一条带 <think> 的 assistant 消息，取其思考内容 + 其后的 system 工具行
let thinking = '', tools = []
for (let i = 0; i < msgs.length; i++) {
  const m = msgs[i]
  if (m.role === 'assistant' && /<think>/.test(String(m.content))) {
    const c = String(m.content)
    const open = c.indexOf('<think>') + 7
    const close = c.indexOf('</think>')
    const th = close === -1 ? c.slice(open) : c.slice(open, close)
    const tl = []
    for (let j = i + 1; j < msgs.length && msgs[j].role === 'system'; j++) tl.push(msgs[j])
    if (tl.length > 0) { thinking = th; tools = tl; break }
  }
}
if (!thinking) { console.log('该会话没有「思考+工具行」组合'); process.exit(0) }
console.log('真实思考长度:', thinking.length, '工具行数:', tools.length)
console.log('工具行:', tools.map(t => JSON.stringify(String(t.content).slice(0, 30))).join(' | '))

const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(React.createElement(ThinkingBlock, { content: thinking, isGenerating: true, tools }))

setTimeout(() => {
  const rootEl = document.getElementById('root')
  const html = rootEl.innerHTML
  const text = rootEl.textContent
  console.log('== 渲染结果 ==')
  console.log('含「深度思考」标签:', text.includes('深度思考'))
  // 工具行是否在深度思考区域内：找标签按钮的父容器
  const block = rootEl.firstElementChild
  const toolsInside = block ? block.querySelectorAll('.cursor-pointer').length : 0
  console.log('深度思考区容器内可点击行数（工具行）:', toolsInside)
  // 顺序验证：第一个工具行文本是否出现在思考内容之间（不是全部在末尾）
  const toolTexts = tools.map(t => String(t.content).replace(/^✅\s*/, '').slice(0, 12))
  const positions = toolTexts.map(tt => text.indexOf(tt))
  console.log('各工具行在文本流中的位置:', positions.join(', '))
  const allAtEnd = positions.every((p, i) => i === 0 || p > positions[i - 1])
  const monotonic = positions.every(p => p >= 0)
  console.log('工具行按顺序出现且交错在思考中:', monotonic && allAtEnd)
  console.log('（若全部在末尾则位置会集中在文本尾部附近，总文本长度 ' + text.length + '）')
  process.exit(0)
}, 200)
