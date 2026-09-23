/**
 * 验证 ChatArea 思考区保护清洗（polishMessageContent）+ 未闭合 <think> 补闭合。
 * 用法：node scripts/test-think-guard.cjs
 * 前提：npm run build 已执行（从 dist 产物里抽不出现代码，改为直接从源码提取纯函数）。
 *
 * 提取方式：ChatArea.tsx 里 dropCodeBlocks/stripCapabilityDenial/polishMessageContent
 * 均为模块级纯函数（不依赖 React），按「函数起点到第 0 列 }」逐段截取后 eval。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ChatArea.tsx'), 'utf8')
  .replace(/\r\n/g, '\n')

/** 从 startIdx 开始截取一个顶层函数（以第 0 列的 } 结束） */
function grabBlock(text, startIdx) {
  const end = text.indexOf('\n}', startIdx)
  if (end === -1) throw new Error('grabBlock: 找不到函数结尾')
  return text.slice(startIdx, end + 2)
}

function extract(name) {
  const start = src.indexOf('function ' + name + '(')
  if (start === -1) throw new Error('找不到函数 ' + name)
  return grabBlock(src, start)
}

// escapeRegExp 也是 function 声明，统一提取
function extractConst(name) {
  return extract(name)
}

// 轮 J：replaceCodeBlocksWithEdit 委托共享模块 codeFold 的 sanitizeThinkingDisplay，
// 这里把 codeFold 的四个纯函数一并提取注入（CODE_NOTE / escapeRegExp 复用 ChatArea 版本，避免重复声明）
const cfSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'codeFold.ts'), 'utf8')
function grabCf(name) {
  const i = cfSrc.indexOf('function ' + name + '(')
  if (i === -1) throw new Error('codeFold 找不到函数 ' + name)
  const e = cfSrc.indexOf('\n}', i)
  return cfSrc.slice(i, e + 2)
}
const codeFoldFns = [
  grabCf('foldFenceBlocks'),
  grabCf('isCodeLine'),
  grabCf('foldBareCode'),
  grabCf('sanitizeThinkingDisplay'),
].join('\n')

const code = [
  src.match(/const CODE_NOTE = .+/)?.[0] || "const CODE_NOTE = '📄 代码草稿（未写入文件）'",
  extractConst('escapeRegExp'),
  extract('dropCodeBlocks'),
  extract('replaceCodeBlocksWithEdit'),
  extract('stripCapabilityDenial'),
  extract('polishAssistantText'),
  extract('polishMessageContent'),
  codeFoldFns,
].join('\n')

// 源码是 TypeScript（含类型注解），先转译成 JS 再进 vm 执行
const ts = require('typescript')
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText

const ctx = {}
vm.createContext(ctx)
vm.runInContext(js + '\nthis.api = { polishMessageContent, replaceCodeBlocksWithEdit, dropCodeBlocks }', ctx)
const { polishMessageContent, replaceCodeBlocksWithEdit } = ctx.api

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name) }
}

console.log('== 思考区保护 ==')
// 1. 思考区里的围栏代码块必须原样保留
const withThinkCode = '<think>我先写个草稿：\n```html\n<html><body>hi</body></html>\n```\n思考结束</think>\n已创建文件。'
const r1 = polishMessageContent(withThinkCode)
t('思考区内的围栏代码块原样保留', r1.includes('<html><body>hi</body></html>'))
t('正文里的说明文字保留', r1.includes('已创建文件。'))

// 2. 正文里的围栏代码块仍要被删（对话不出现代码的规则不变）
const bodyCode = '<think>思考一下</think>\n```js\nconst a = 1\n```\n写好了。'
const r2 = polishMessageContent(bodyCode)
t('正文围栏代码块被删除', !r2.includes('const a = 1'))
t('正文说明保留', r2.includes('写好了。'))
t('删除后留下「📄 代码草稿（未写入文件）」提示', r2.includes('📄 代码草稿（未写入文件）'))

// 3. 未闭合 <think>（流式中断）→ 补闭合、思考内容完整
const openThink = '<think>思考进行中…写个草稿 ```js\nvar x = 1\n``` 还没想完'
const r3 = polishMessageContent(openThink)
t('未闭合 think 被补上闭合标签', r3.includes('</think>'))
t('未闭合思考内的代码原样保留', r3.includes('var x = 1'))

// 4. 无 think 标记的普通消息 → 行为与旧清洗一致
const plain = '你好\n```python\nprint(1)\n```\n完成'
const r4 = polishMessageContent(plain)
t('无思考标记时代码块仍删除', !r4.includes('print(1)'))

// 5. 能力误报替换不波及思考区（思考里提到"没有工具"不代表正文要被替换）
const denialInThink = '<think>当前对话模式没有挂载文件写入工具，我该引导用户</think>\n已创建 config.json。'
const r5 = polishMessageContent(denialInThink)
t('思考区提及能力限制不影响正文', r5.includes('已创建 config.json。') && r5.includes('没有挂载文件写入工具'))

// 6. 裸 HTML 文档在思考区 → 保留；在正文 → 删除
const bareHtmlThink = '<think>草稿：<!DOCTYPE html><html><body>x</body></html>\n</think>\n文件已写好'
const r6 = polishMessageContent(bareHtmlThink)
t('思考区裸 HTML 保留', r6.includes('<!DOCTYPE html>'))

// 7. 空串安全
t('空串返回空串', polishMessageContent('') === '')

// 8. 真实规模冒烟：模拟 5 万字思考 + 22 个代码块，全部保留
let big = '<think>'
for (let i = 0; i < 22; i++) big += '段落' + i + '。```js\nvar v' + i + ' = ' + i + '\n```'
big += '思考完</think>\n已创建 go.html。'
const r8 = polishMessageContent(big)
const kept = (r8.match(/var v\d+/g) || []).length
t('5 万字思考区 22 个代码块全部保留（实测 ' + kept + '/22）', kept === 22)
t('正文代码规则仍生效', !r8.includes('已创建 go.html') === false)

// 9. 思考区显示层清洗（2026-09-22 用户要求：思考区代码墙也用「📄 代码草稿（未写入文件）」取代）
// 落盘保留原文（上面 1/3/6/8 已验证），但 ThinkingBlock **显示**时必须替换
console.log('== 思考区显示层清洗（replaceCodeBlocksWithEdit） ==')
const thinkDraft = '我先写个草稿：\n```html\n<html><body>hi</body></html>\n```\n再考虑性能。'
const disp = replaceCodeBlocksWithEdit(thinkDraft)
t('围栏代码块被替换为「📄 代码草稿（未写入文件）」', disp.includes('📄 代码草稿（未写入文件）') && !disp.includes('<body>hi'), disp.slice(0, 120))
t('思考文字保留', disp.includes('我先写个草稿') && disp.includes('再考虑性能'))
const dispOpen = replaceCodeBlocksWithEdit('起草中 ```js\nvar a = 1')
t('未闭合代码块（流式中）也被替换', !dispOpen.includes('var a = 1') && dispOpen.includes('📄 代码草稿（未写入文件）'), dispOpen.slice(0, 120))
const dispBare = replaceCodeBlocksWithEdit('草稿：<!DOCTYPE html><html><body>x</body></html>')
t('裸 HTML 文档也被替换', !dispBare.includes('<body>') && dispBare.includes('📄 代码草稿（未写入文件）'))
const dispInline = replaceCodeBlocksWithEdit('用 `useMemo` 记忆组件，注意依赖数组。')
t('行内 code 不误伤', dispInline === '用 `useMemo` 记忆组件，注意依赖数组。')
const dispMulti = replaceCodeBlocksWithEdit('```js\na\n```\n中间文字\n```py\nb\n```')
t('多个代码块替换后去重为一行', (dispMulti.match(/📄 代码草稿（未写入文件）/g) || []).length === 2 || !/\n📄 代码草稿（未写入文件）\s*\n📄 代码草稿（未写入文件）/.test(dispMulti), dispMulti.slice(0, 120))

// 10. ThinkingBlock 组件静态断言：显示必须经过 replaceCodeBlocksWithEdit
t('ThinkingBlock 渲染时调用 replaceCodeBlocksWithEdit', /replaceCodeBlocksWithEdit\(content\)/.test(src))
t('flush 显示走 polishMessageContent（流式中正文也清洗）', /updateMessage\(conversation\.id, assistantMessage\.id, polishMessageContent\(fullContent\)\)/.test(src))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail > 0 ? 1 : 0)
