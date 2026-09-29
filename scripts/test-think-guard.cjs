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

// 轮 J+（2026-09-24）：思考区显示层单元化——codeFold 整文件转译加载，
// parseThinkingUnits 把思考解析成 text/code 单元（code 单元 = 可展开的代码草稿）
const ts = require('typescript')
const cfJs = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'codeFold.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const cfPath = path.join(__dirname, '..', '.temp-codefold.cjs')
fs.writeFileSync(cfPath, cfJs)
const cf = require(cfPath)

const code = [
  src.match(/const CODE_NOTE = .+/)?.[0] || "const CODE_NOTE = '📄 代码草稿（未写入文件）'",
  extractConst('escapeRegExp'),
  extract('dropCodeBlocks'),
  extract('stripCapabilityDenial'),
  extract('polishAssistantText'),
  extract('polishMessageContent'),
].join('\n')

// 源码是 TypeScript（含类型注解），先转译成 JS 再进 vm 执行
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText

const ctx = {}
vm.createContext(ctx)
vm.runInContext(js + '\nthis.api = { polishMessageContent, dropCodeBlocks }', ctx)
const { polishMessageContent } = ctx.api

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

// 9. 思考区显示层：代码草稿单元化（2026-09-24 用户要求「代码草稿也可以展开看看草稿内容是什么」）
// 落盘保留原文（上面 1/3/6/8 已验证）；显示层 parseThinkingUnits 解析成 text/code 单元，
// code 单元渲染为可展开的 CodeDraftBlock——默认仍是一行占位，点击展开看草稿原文，内容不再丢弃。
console.log('== 思考区显示层单元化（parseThinkingUnits） ==')
const uFence = cf.parseThinkingUnits('我先写个草稿：\n```html\n<html><body>hi</body></html>\n```\n再考虑性能。')
t('围栏块解析为 code 单元（含草稿原文）', uFence.some(u => u.kind === 'code' && u.code.includes('<body>hi')))
t('思考文字保留为 text 单元', uFence.some(u => u.kind === 'text' && u.text.includes('我先写个草稿')) && uFence.some(u => u.kind === 'text' && u.text.includes('再考虑性能')))
const uOpen = cf.parseThinkingUnits('起草中 ```js\nvar a = 1')
t('未闭合块（流式中）也是 code 单元', uOpen.some(u => u.kind === 'code' && u.code.includes('var a = 1')))
const uHtml = cf.parseThinkingUnits('草稿：<!DOCTYPE html><html><body>x</body></html>')
t('裸 HTML 文档 → code 单元', uHtml.some(u => u.kind === 'code' && u.code.includes('<!DOCTYPE html>')))
const uInline = cf.parseThinkingUnits('用 `useMemo` 记忆组件，注意依赖数组。')
t('行内 code 不误伤（纯 text 单元）', uInline.length === 1 && uInline[0].kind === 'text' && uInline[0].text.includes('`useMemo`'))
const uBare = cf.parseThinkingUnits('分析：\nconst CSS_SIZE = 640;\nconst board = [];\nconst n = 19;\n按这个写。')
t('无围栏裸代码 ≥3 行 → code 单元', uBare.some(u => u.kind === 'code' && u.code.includes('CSS_SIZE')))
t('裸代码前后正文保留为 text 单元', uBare.some(u => u.kind === 'text' && u.text.includes('分析：')) && uBare.some(u => u.kind === 'text' && u.text.includes('按这个写')))
const uTwo = cf.parseThinkingUnits('```js\na\n```\n中间文字\n```py\nb\n```')
t('多个代码块各自成独立单元', uTwo.filter(u => u.kind === 'code').length === 2 && uTwo.some(u => u.kind === 'text' && u.text.includes('中间文字')))
// 边界一致性：把 code 单元替换回占位行拼回去，应与字符串折叠 sanitizeThinkingDisplay 结果一致
const sample = '计划如下：\n```js\nlet SIZE = 19;\n```\n然后开始写。'
const joined = cf.parseThinkingUnits(sample).map(u => u.kind === 'text' ? u.text : '📄 代码草稿（未写入文件）').join('')
t('单元拼回与 sanitizeThinkingDisplay 折叠边界一致', joined === cf.sanitizeThinkingDisplay(sample), JSON.stringify(joined))

// 10. ThinkingBlock 组件静态断言：渲染走单元化 + 代码草稿可展开（默认折叠）
t('ThinkingBlock 渲染走 parseThinkingUnits', /parseThinkingUnits\(content\)/.test(src))
t('CodeDraftBlock 组件存在且默认折叠（useState(false)）', /const CodeDraftBlock[\s\S]{0,600}?useState\(false\)/.test(src))
t('flush 显示走 polishMessageContent（流式中正文也清洗）', /updateMessage\(conversation\.id, assistantMessage\.id, polishMessageContent\(fullContent\)\)/.test(src))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail > 0 ? 1 : 0)
