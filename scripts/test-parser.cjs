// parseToolCall / parseDoneResponse 解析测试：确认模型各种真实输出格式都能被识别
// 直接从源码抽取这两个纯函数转译后测试（避免压缩产物难以解析）
// 用法：node scripts/test-parser.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}${extra ? ' \u2192 ' + extra : ''}`) }
}

const srcPath = path.join(__dirname, '..', 'src', 'services', 'agentEngine.ts')
const src = fs.readFileSync(srcPath, 'utf8')
const lines = src.split('\n')

function grab(name) {
  const start = lines.findIndex((l) => l.includes('export function ' + name))
  if (start === -1) return null
  // 逐字符扫描并跳过字符串与正则字面量，否则函数体里的 { } 会破坏配平
  let depth = 0
  let started = false
  let i = start
  let text = ''
  let inString = null
  let inRegex = false
  let escape = false
  let inLineComment = false
  let inBlockComment = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    for (let k = 0; k < line.length; k++) {
      const c = line[k]
      const next = line[k + 1]
      if (escape) { escape = false; continue }
      if (inLineComment) break
      if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; k++ }
        continue
      }
      if (inString) {
        if (c === '\\') { escape = true; continue }
        if (c === inString) inString = null
        continue
      }
      if (inRegex) {
        if (c === '\\') { escape = true; continue }
        if (c === '[') continue
        if (c === '/') inRegex = false
        continue
      }
      if (c === '/' && next === '/') { inLineComment = true; k++; continue }
      if (c === '/' && next === '*') { inBlockComment = true; k++; continue }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue }
      if (c === '/' && !started === false && k > 0 && /[=(,:[]\s*$/.test(line.slice(0, k))) { inRegex = true; continue }
      if (c === '{') { depth++; started = true }
      else if (c === '}') { depth-- }
    }
    text += line + '\n'
    inLineComment = false
    if (started && depth === 0) return text
  }
  return null
}

const fn1 = grab('parseToolCall')
const fn2 = grab('parseDoneResponse')
if (!fn1) { console.log('未找到 parseToolCall 源码'); process.exit(1) }

const code =
  fn1.replace('export ', '') + '\n' +
  (fn2 || '').replace('export ', '') + '\n' +
  'module.exports = { parseToolCall, parseDoneResponse }\n'
const js = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

const tmp = path.join(__dirname, '..', '.temp-parser.cjs')
fs.writeFileSync(tmp, js)
let parseToolCall, parseDoneResponse
try {
  ;({ parseToolCall, parseDoneResponse } = require(tmp))
} finally {
  fs.unlinkSync(tmp)
}

console.log('\n===== parseToolCall 各种模型输出格式 =====')
const cases = [
  ['标准两行', 'TOOL: write_file\nARGS: {"path":"a.txt","content":"hi"}', 'write_file'],
  ['全角冒号', 'TOOL： write_file\nARGS： {"path":"a.txt","content":"hi"}', 'write_file'],
  ['小写 tool', 'tool: write_file\nargs: {"path":"a.txt","content":"hi"}', 'write_file'],
  ['TOOL 与 ARGS 同行', 'TOOL: write_file ARGS: {"path":"a.txt","content":"hi"}', 'write_file'],
  ['前面有说明文字', '我来创建文件：\nTOOL: write_file\nARGS: {"path":"a.txt","content":"hi"}', 'write_file'],
  ['代码块包裹', '```\nTOOL: write_file\nARGS: {"path":"a.txt","content":"hi"}\n```', 'write_file'],
  ['嵌嵌套 JSON', 'TOOL: write_file\nARGS: {"path":"a.txt","content":"{\\"nested\\":true}"}', 'write_file'],
  ['content 含换行转义', 'TOOL: write_file\nARGS: {"path":"a.js","content":"line1\\nline2"}', 'write_file'],
  ['content 含大括号', 'TOOL: write_file\nARGS: {"path":"a.css","content":"body { color: red; }"}', 'write_file'],
  ['ARGS 后有多余文字', 'TOOL: write_file\nARGS: {"path":"a.txt","content":"hi"}\n请执行。', 'write_file'],
  ['多空格缩进', 'TOOL:   write_file\nARGS:   {"path":"a.txt","content":"hi"}', 'write_file'],
  ['带 markdown 加粗', '**TOOL:** write_file\n**ARGS:** {"path":"a.txt","content":"hi"}', 'write_file'],
  ['edit_file 调用', 'TOOL: edit_file\nARGS: {"path":"a.txt","old_str":"x","new_str":"y"}', 'edit_file'],
  ['run_command 调用', 'TOOL: run_command\nARGS: {"command":"npm run build"}', 'run_command'],
  ['create_dir 调用', 'TOOL: create_dir\nARGS: {"path":"src/new"}', 'create_dir'],
]

for (const [name, input, expectTool] of cases) {
  const r = parseToolCall(input)
  ok(name, r && r.tool === expectTool, r ? '得到 ' + r.tool : '未识别')
}

console.log('\n===== 参数解析正确性 =====')
const r1 = parseToolCall('TOOL: write_file\nARGS: {"path":"a.txt","content":"hello"}')
ok('path 参数正确', r1 && r1.args.path === 'a.txt', JSON.stringify(r1 && r1.args))
ok('content 参数正确', r1 && r1.args.content === 'hello', JSON.stringify(r1 && r1.args))

const r2 = parseToolCall('TOOL: write_file\nARGS: {"path":"a.js","content":"if (a) { b }"}')
ok('含大括号 content 完整', r2 && r2.args.content === 'if (a) { b }', JSON.stringify(r2 && r2.args))

const r3 = parseToolCall('TOOL: write_file\nARGS: {"path":"a.txt","content":"{\\"k\\":\\"v\\"}"}')
ok('嵌套 JSON 字符串内容正确', r3 && r3.args.content === '{"k":"v"}', JSON.stringify(r3 && r3.args))

console.log('\n===== 非法输入应返回 null =====')
ok('纯文本 → null', parseToolCall('这是一段普通回复，没有工具调用') === null)
ok('只有 TOOL 没有 ARGS → null', parseToolCall('TOOL: write_file') === null)
ok('ARGS 不是 JSON → null', parseToolCall('TOOL: write_file\nARGS: not json') === null)
ok('空字符串 → null', parseToolCall('') === null)

console.log('\n===== parseDoneResponse =====')
ok('标准 DONE', parseDoneResponse('DONE: 已完成') === '已完成')
ok('全角冒号 DONE', parseDoneResponse('DONE： 已完成') === '已完成')
ok('加粗 DONE', parseDoneResponse('**DONE:** 已完成') === '已完成')
ok('末尾 DONE（前有说明）', parseDoneResponse('我做了这些事。\nDONE: 总结') === '总结')
ok('普通文本 → null', parseDoneResponse('这是一段普通回复') === null)

console.log('\n===== ZCode 风格工具名与参数名 =====')
// executeTool 内的别名归一化表（与 agentEngine.ts 的 TOOL_ALIAS / ARG_ALIAS 保持一致）
const TOOL_ALIAS = {
  read: 'read_file', write: 'write_file', edit: 'edit_file', glob: 'find_files',
  grep: 'search_files', bash: 'run_command', webfetch: 'web_fetch',
  websearch: 'web_search', ls: 'list_files', list: 'list_files', todo_write: 'todo',
}
const ARG_ALIAS = {
  file_path: 'path', filepath: 'path', file: 'path',
  old_string: 'old_str', new_string: 'new_str', timeout: 'timeout_ms', cmd: 'command',
}
function normalize(tool, args) {
  const t = TOOL_ALIAS[String(tool || '').toLowerCase()] || String(tool || '').toLowerCase()
  const a = { ...(args || {}) }
  for (const [from, to] of Object.entries(ARG_ALIAS)) {
    if (a[from] !== undefined && a[to] === undefined) a[to] = a[from]
  }
  return { tool: t, args: a }
}

for (const [zcodeName, implName] of [
  ['Write', 'write_file'], ['Read', 'read_file'], ['Edit', 'edit_file'],
  ['Glob', 'find_files'], ['Grep', 'search_files'], ['Bash', 'run_command'],
  ['WebFetch', 'web_fetch'], ['WebSearch', 'web_search'],
]) {
  const r = normalize(zcodeName, {})
  ok(`${zcodeName} → ${implName}`, r.tool === implName, '得到 ' + r.tool)
}

const n1 = normalize('Write', { file_path: 'a.txt', content: 'hi' })
ok('file_path → path', n1.args.path === 'a.txt', JSON.stringify(n1.args))
const n2 = normalize('Edit', { file_path: 'a.txt', old_string: 'x', new_string: 'y' })
ok('old_string → old_str', n2.args.old_str === 'x', JSON.stringify(n2.args))
ok('new_string → new_str', n2.args.new_str === 'y', JSON.stringify(n2.args))
const n3 = normalize('Bash', { command: 'ls', timeout: 5000 })
ok('timeout → timeout_ms', n3.args.timeout_ms === 5000, JSON.stringify(n3.args))
const n4 = normalize('write_file', { path: 'a.txt', content: 'hi' })
ok('原生命名保持可用', n4.tool === 'write_file' && n4.args.path === 'a.txt', JSON.stringify(n4))

console.log('\n===== 端到端：ZCode 风格调用能被解析 =====')
const z1 = parseToolCall('TOOL: Write\nARGS: {"file_path":"hello.txt","content":"hi"}')
ok('解析出 Write 调用', z1 && z1.tool === 'write', z1 && z1.tool)
const z1n = normalize(z1.tool, z1.args)
ok('归一化后指向 write_file', z1n.tool === 'write_file', z1n.tool)
ok('归一化后 path 正确', z1n.args.path === 'hello.txt', JSON.stringify(z1n.args))

console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '))
process.exit(fail > 0 ? 1 : 0)
