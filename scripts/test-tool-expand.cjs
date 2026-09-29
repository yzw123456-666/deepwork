/**
 * 展开点击实验（2026-09-23）：用 jsdom + 项目真实 react/react-dom/lucide-react
 * 挂载 ChatArea 的 ToolActionLine（从源码提取转译），模拟真实 click，
 * 验证「已读取 xxx」行点击后详情面板是否出现——一锤定音排查用户反馈的「没法展开」。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))

// 1. jsdom 全局
const { JSDOM } = require('C:/Users/ytzsy/.workbuddy/binaries/node/workspace/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.MouseEvent = dom.window.MouseEvent

// 2. 项目真实依赖（用项目自己的 react/react-dom/lucide-react，与运行时同版本）
const React = require('react')
const ReactDOM = require('react-dom/client')
const lucide = require('lucide-react')

// 3. 提取 ToolActionLine 及其依赖链源码
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ChatArea.tsx'), 'utf8')
function grab(name) {
  const i = src.indexOf('function ' + name + '(')
  if (i === -1) throw new Error('找不到函数 ' + name)
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
  const end = m ? i + 6 + m.index : src.length
  return src.slice(i, end)
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
]
const raw = `
const { useState } = React;
const { CheckCircle2, XCircle, Loader2, ChevronRight } = lucide;
${parts.join('\n')}
this.api = { ToolActionLine };
`

const js = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' } }).outputText
const ctx = { React, lucide, console, window: dom.window, document: dom.window.document, navigator: dom.window.navigator }
vm.createContext(ctx)
vm.runInContext(js, ctx)
const ToolActionLine = ctx.api.ToolActionLine

// 4. 渲染「读取 围棋.html」行（detail 与真实落盘数据同构：kind=text, 2019 字符）
const detail = { kind: 'text', text: 'A'.repeat(2019) }
const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(React.createElement(ToolActionLine, { content: '读取 围棋.html', detail }))

setTimeout(() => {
  const html0 = document.getElementById('root').innerHTML
  console.log('== 渲染后（点击前）==')
  console.log('含行文字:', html0.includes('读取 围棋.html'))
  console.log('含展开面板内容:', html0.includes('A'.repeat(50)))
  console.log('含 chevron(svg):', html0.includes('svg'))

  // 5. 模拟真实点击（bubbles 冒泡，落在行 div 上）
  const lineEl = document.querySelector('#root .cursor-pointer')
  console.log('找到可点击行:', !!lineEl)
  if (lineEl) {
    lineEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  }
  setTimeout(() => {
    const html1 = document.getElementById('root').innerHTML
    console.log('== 点击后 ==')
    console.log('面板出现（2019 字符内容）:', html1.includes('A'.repeat(100)))
    console.log('chevron 旋转(rotate-90):', html1.includes('rotate-90'))
    console.log('根节点长度变化:', html0.length, '->', html1.length)
    process.exit(0)
  }, 100)
}, 100)
