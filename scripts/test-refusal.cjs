// 对话输出清洗测试：
//   1) stripCapabilityDenial —— 能力误报替换
//   2) dropCodeBlocks —— 移除代码块，只留一句状态提示（用户要求「对话里不要出现代码」）
// 两者都必须「命中目标 + 零误伤正常回复」
// 用法：node scripts/test-refusal.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}${extra ? ' \u2192 ' + extra : ''}`) }
}

// ---------- 从源码抽取函数（跳过字符串/注释，避免大括号配平走偏） ----------
function grabFn(src, name) {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.includes('function ' + name))
  if (start === -1) return null
  let depth = 0, started = false
  const out = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    let inS = null, esc = false, inRe = false
    for (let k = 0; k < line.length; k++) {
      const c = line[k]
      if (esc) { esc = false; continue }
      if (inS) {
        if (c === '\\') { esc = true; continue }
        if (c === inS) inS = null
        continue
      }
      if (inRe) {
        if (c === '\\') { esc = true; continue }
        if (c === '/') inRe = false
        continue
      }
      if (c === '/' && line[k + 1] === '/') break
      if (c === '"' || c === "'" || c === '`') { inS = c; continue }
      if (c === '/' && /[=(,:[]\s*$/.test(line.slice(0, k))) { inRe = true; continue }
      if (c === '{') { depth++; started = true }
      else if (c === '}') depth--
    }
    out.push(line)
    if (started && depth === 0) break
  }
  return out.join('\n')
}

function loadFns(srcPath, names) {
  const src = fs.readFileSync(srcPath, 'utf8')
  // dropCodeBlocks 引用模块级常量 CODE_NOTE（'📄 代码草稿（未写入文件）'），提取函数时必须一并带上
  const codeNote = src.match(/const CODE_NOTE = .+/)?.[0] || "const CODE_NOTE = '📄 代码草稿（未写入文件）'"
  const parts = names.map((n) => grabFn(src, n)).filter(Boolean)
  const js = ts.transpileModule(
    codeNote + '\n\n' + parts.join('\n\n') + '\nmodule.exports = { ' + names.join(', ') + ' }',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText
  const tmp = path.join(__dirname, '..', '.temp-polish.cjs')
  fs.writeFileSync(tmp, js)
  try { return require(tmp) } finally { fs.unlinkSync(tmp) }
}

const chatPath = path.join(__dirname, '..', 'src', 'components', 'ChatArea.tsx')
const { stripCapabilityDenial, dropCodeBlocks } = loadFns(chatPath, [
  'stripCapabilityDenial', 'dropCodeBlocks', 'escapeRegExp',
])

// ---------- 1. 能力误报 ----------
// 注意：对话页现在已挂载真实工具链，因此「替换后不应再引导用户去任务视图」——
// 替换文案必须承诺直接执行（再发一次我就动手），而不是把用户支开。
console.log('\n===== 1. 能力误报必须被替换 =====')
const denials = [
  '抱歉，是我表述有误 —— 我在当前对话中没有实际的文件写入权限，无法直接在您的电脑上创建文件，之前说“已创建”是不准确的，向您道歉。',
  '抱歉，我没有文件写入权限，无法创建文件。',
  '我无法直接访问您的电脑来创建文件。',
  '作为 AI，我无法直接在您的电脑上创建文件。',
  '我不具备文件读写能力，抱歉。',
]
for (const d of denials) {
  const r = stripCapabilityDenial(d)
  const replaced = r !== d
  // 新文案：承诺直接落盘，且**不得**再把用户支到「任务」视图
  const promisesAction = /写入工具|落到磁盘|落盘|直接调用/.test(r) && !/切到|去「任务」|到「任务」/.test(r)
  ok('已替换: ' + d.slice(0, 18) + '…', replaced && promisesAction, replaced ? '仍引导去任务视图' : '未替换')
}

console.log('\n===== 1b. 折叠提示样式（2026-09-22 用户指定「📄 代码草稿（未写入文件）」一行取代） =====')
const bigCodeForTip = '```js\n' + Array.from({ length: 30 }, (_, i) => `const line${i} = ${i}`).join('\n') + '\n```'
const droppedWithFile = dropCodeBlocks('帮你写好了：\n\n' + bigCodeForTip, ['index.html'])
ok('替换为一行「📄 代码草稿（未写入文件）」', droppedWithFile.includes('📄 代码草稿（未写入文件）'), droppedWithFile.slice(0, 120))

console.log('\n===== 2. 正常回复不得被改动 =====')
const normalDenials = [
  '这个报错通常是因为端口被占用，你可以换个端口试试。',
  '好的，我来解释一下 useEffect 的执行时机。',
  '抱歉，我没听懂你的意思，能再说明一下吗？',
  'React 的 useEffect 会在渲染提交后执行。',
]
for (const n of normalDenials) {
  ok('未改动: ' + n.slice(0, 18) + '…', stripCapabilityDenial(n) === n, '被误改')
}
const longReply = '关于你说的文件创建，我先解释一下原理。' + '这段是实质性的技术说明内容。'.repeat(20) + '我无法直接访问您的电脑。'
ok('长回复不整体替换', stripCapabilityDenial(longReply) === longReply)
ok('空串安全', stripCapabilityDenial('') === '')

// ---------- 3. 代码块必须被彻底移除（不是折叠） ----------
console.log('\n===== 3. 代码块必须被移除，只留一句状态提示 =====')
const bigCode = '```js\n' + Array.from({ length: 30 }, (_, i) => `const line${i} = ${i}`).join('\n') + '\n```'
const withBigCode = '我来帮你实现这个功能。\n\n' + bigCode + '\n\n完成。'
const dropped = dropCodeBlocks(withBigCode)
ok('大代码块被移除', !dropped.includes('const line29'), '仍含代码')
ok('没有任何围栏残留', !dropped.includes('```'), dropped.slice(0, 120))
ok('保留了说明文字', dropped.includes('我来帮你实现这个功能'), dropped.slice(0, 60))
ok('替换为「📄 代码草稿（未写入文件）」提示', /📄 代码草稿（未写入文件）/.test(dropped), dropped.slice(0, 150))

console.log('\n===== 4. 小段代码同样移除（用户不要任何代码） =====')
const smallCode = '```js\narr.sort((a, b) => a - b)\n```'
const withSmall = '排序这样写就行：\n\n' + smallCode
ok('短代码块也被移除', !dropCodeBlocks(withSmall).includes('arr.sort'), '仍含代码')

const inlineOnly = '用 `useMemo` 包一下就行了，这样能避免重复计算，性能会好很多，其余逻辑保持不变即可。'
ok('行内 code 保留（不是代码块）', dropCodeBlocks(inlineOnly) === inlineOnly)

const noCode = '这个问题的根因是端口被占用了，换个端口重启即可，不需要改代码。'
ok('无代码回复原样', dropCodeBlocks(noCode) === noCode)
ok('空串安全', dropCodeBlocks('') === '')

console.log('\n===== 4b. 替换文案统一为「📄 代码草稿（未写入文件）」 =====')
const named = dropCodeBlocks('写好了：\n\n' + bigCode, ['index.html'])
ok('替换为「📄 代码草稿（未写入文件）」', named.includes('📄 代码草稿（未写入文件）'), named.slice(0, 150))
ok('不再使用旧文案「正在写入文件」', !/正在写入文件/.test(named), named.slice(0, 150))

console.log('\n===== 4c. 未落盘时同样用「📄 代码草稿（未写入文件）」 =====')
const neutral = dropCodeBlocks('思路如下：\n\n' + bigCode)
ok('替换为「📄 代码草稿（未写入文件）」', /📄 代码草稿（未写入文件）/.test(neutral), neutral.slice(0, 150))

console.log('\n===== 4d. 裸 HTML 文档（不带围栏）也要清除 =====')
const rawHtml = '做好了：\n\n<!DOCTYPE html>\n<html>\n<body><p>x</p></body>\n</html>\n\n完成。'
const strippedHtml = dropCodeBlocks(rawHtml)
ok('完整 HTML 文档被移除', !strippedHtml.includes('<body>'), strippedHtml.slice(0, 150))
ok('留下「📄 代码草稿（未写入文件）」提示', /📄 代码草稿（未写入文件）/.test(strippedHtml), strippedHtml.slice(0, 150))
const unclosedHtml = '如下：\n<html>\n<head>xxx'
ok('未闭合的整行 HTML 也移除', !/<head>/.test(dropCodeBlocks(unclosedHtml)), dropCodeBlocks(unclosedHtml).slice(0, 150))
const mentionHtml = '在 HTML 里，<html> 标签是根元素，所有其他元素都嵌套在它里面，这是规范要求。'
ok('句中提及 <html> 不误伤', dropCodeBlocks(mentionHtml) === mentionHtml, dropCodeBlocks(mentionHtml).slice(0, 150))

console.log('\n===== 5. 引擎层：代码块阈值 + 兜底剥离 =====')
const engineSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'agentEngine.ts'), 'utf8')
const fnSrc = grabFn(engineSrc, 'hasUnsavedCodeBlock') + '\n' + grabFn(engineSrc, 'stripCodeBlocks')
const ejs = ts.transpileModule(fnSrc + '\nmodule.exports = { hasUnsavedCodeBlock, stripCodeBlocks }', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const etmp = path.join(__dirname, '..', '.temp-engine.cjs')
fs.writeFileSync(etmp, ejs)
let hasUnsavedCodeBlock, stripCodeBlocks
try { ({ hasUnsavedCodeBlock, stripCodeBlocks } = require(etmp)) } finally { fs.unlinkSync(etmp) }

ok('30 行代码块 → 判定违规', hasUnsavedCodeBlock(bigCode))
ok('5 行代码块(>120字符) → 判定违规', hasUnsavedCodeBlock('```js\n' + Array.from({ length: 6 }, (_, i) => `const v${i} = ${i} * 1000`).join('\n') + '\n```'))
ok('行内 code → 不违规', !hasUnsavedCodeBlock('用 `useMemo` 包一下就好'))
ok('纯文字 → 不违规', !hasUnsavedCodeBlock('任务已完成，改了两个文件。'))

const stripped = stripCodeBlocks('改好了。\n\n' + bigCode + '\n\n以上。')
ok('兜底剥离后无代码', !stripped.includes('const line'), stripped.slice(0, 60))
ok('兜底剥离保留文字', stripped.includes('改好了'), stripped)
ok('全代码时给出兜底文案', stripCodeBlocks(bigCode).includes('已写入文件'))
// 引擎层裸 HTML 兜底
const eHtml = 'DONE: 做好了\n<!DOCTYPE html><html><body>big</body></html>'
ok('引擎剥离裸 HTML', !stripCodeBlocks(eHtml).includes('<body>'), stripCodeBlocks(eHtml).slice(0, 120))

console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '))
process.exit(fail > 0 ? 1 : 0)
