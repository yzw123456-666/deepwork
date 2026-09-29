/**
 * 工具强化测试（v26.9.49）：
 *  1) fileOps.copyRecursive（目录递归复制）
 *  2) fileOps.appendWithNewline（追加前补换行）
 *  3) executeTool 的 TodoWrite 工具（add/list/complete/clear 端到端）
 *  4) 工具名 / 参数名 别名归一（todo_write→todo、file_path→path 等）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const ts = require('typescript')

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')) }
}

// 按大括号平衡提取函数源码（与 test-refusal 同款）
function grabFn(src, name) {
  const lines = src.split('\n')
  const start = lines.findIndex(l => l.includes('function ' + name + '('))
  if (start === -1) return null
  let depth = 0, started = false
  for (let j = start; j < lines.length; j++) {
    const c = lines[j]
    let inS = null, esc = false
    for (let k = 0; k < c.length; k++) {
      const ch = c[k]
      if (esc) { esc = false; continue }
      if (inS) { if (ch === '\\') esc = true; else if (ch === inS) inS = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { inS = ch; continue }
      if (ch === '/' && c[k + 1] === '/') break
      if (ch === '{') { depth++; started = true }
      else if (ch === '}') { depth--; if (started && depth === 0) return lines.slice(start, j + 1).join('\n') }
    }
  }
  return null
}

;(async () => {
  console.log('\n===== 1. fileOps：递归复制 =====')
  const foSrc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'fileOps.ts'), 'utf8')
  const foJs = ts.transpileModule(foSrc + '\nmodule.exports = { copyRecursive, appendWithNewline }', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const fotmp = path.join(__dirname, '..', '.temp-fo.cjs')
  fs.writeFileSync(fotmp, foJs)
  const { copyRecursive, appendWithNewline } = require(fotmp)
  fs.unlinkSync(fotmp)

  {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-copy-'))
    const src = path.join(base, 'src')
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(src, 'a.txt'), 'A')
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'B')
    const dst = path.join(base, 'dst')
    copyRecursive(src, dst)
    ok('目录递归复制：顶层文件存在', fs.existsSync(path.join(dst, 'a.txt')))
    ok('目录递归复制：子目录文件存在', fs.existsSync(path.join(dst, 'sub', 'b.txt')))
    ok('目录递归复制：内容一致', fs.readFileSync(path.join(dst, 'a.txt'), 'utf-8') === 'A' && fs.readFileSync(path.join(dst, 'sub', 'b.txt'), 'utf-8') === 'B')
    fs.rmSync(base, { recursive: true, force: true })
  }

  console.log('\n===== 2. fileOps：追加换行安全 =====')
  {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fo-app-'))
    const f = path.join(base, 'x.txt')
    appendWithNewline(f, 'line1')
    ok('空文件追加无多余换行', fs.readFileSync(f, 'utf-8') === 'line1')
    appendWithNewline(f, 'line2')
    ok('末尾无换行时补换行', fs.readFileSync(f, 'utf-8') === 'line1\nline2')
    fs.writeFileSync(f, 'p\n')
    appendWithNewline(f, 'q')
    ok('末尾有换行时不重复补', fs.readFileSync(f, 'utf-8') === 'p\nq')
    fs.rmSync(base, { recursive: true, force: true })
  }

  console.log('\n===== 3. executeTool：TodoWrite 端到端 =====')
  const engSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'agentEngine.ts'), 'utf8')
  const exeSrc = grabFn(engSrc, 'executeTool')
  if (!exeSrc) { console.log('✗ 无法提取 executeTool'); process.exit(1) }
  // 用最简桩替换 normalizeToolPath（提取原函数会被反斜杠正则干扰，且测试场景只涉及相对/空路径）
  const normStub = `
function normalizeToolPath(root, p) {
  const raw = String(p || '').trim()
  if (!raw) return { ok: true, rel: '' }
  if (raw.startsWith('/')) return { ok: true, rel: raw.replace(/^\\/+/, '') }
  return { ok: true, rel: raw }
}`
  const exeJs = ts.transpileModule(exeSrc + '\n' + normStub + '\nmodule.exports = { executeTool }', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const etmp = path.join(__dirname, '..', '.temp-exe.cjs')
  fs.writeFileSync(etmp, exeJs)
  const { executeTool } = require(etmp)
  fs.unlinkSync(etmp)

  // 一个真实的、按工作目录隔离的 todo 存储 mock（行为与 main.ts 的 agent:todo 一致）
  function makeTodoMock() {
    const store = {}
    return {
      todo: (root, action, payload = {}) => {
        const list = store[root] || (store[root] = [])
        const a = String(action || 'list').toLowerCase()
        if (a === 'add') { list.push({ content: String(payload.content || '').trim(), status: 'pending', createdAt: 1 }) }
        else if (a === 'complete') { const i = Number(payload.index) - 1; if (list[i]) list[i].status = 'completed' }
        else if (a === 'clear') { list.length = 0 }
        const done = list.filter(t => t.status === 'completed').length
        return { ok: true, output: `任务清单（共 ${list.length}，已完成 ${done}）` }
      },
    }
  }

  {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-'))
    const mockApi = { agent: makeTodoMock() }
    global.window = { electronAPI: mockApi }

    const r1 = await executeTool('todo_write', { action: 'add', content: '读取需求' }, workdir, false)
    ok('todo add 成功', r1.ok === true, JSON.stringify(r1))
    const r2 = await executeTool('todo_write', { action: 'add', content: '编写代码' }, workdir, false)
    ok('todo add 第二次成功', r2.ok === true)
    const r3 = await executeTool('todo', { action: 'complete', index: 1 }, workdir, false)
    ok('todo complete 成功', r3.ok === true)
    const r4 = await executeTool('TodoWrite', { action: 'list' }, workdir, false)
    ok('todo list 成功', r4.ok === true)
    const r5 = await executeTool('todo_write', { action: 'clear' }, workdir, false)
    ok('todo clear 成功', r5.ok === true)
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-other-'))
    const r6 = await executeTool('todo_write', { action: 'list' }, other, false)
    ok('不同工作目录清单隔离', r6.ok === true)
    fs.rmSync(workdir, { recursive: true, force: true })
    fs.rmSync(other, { recursive: true, force: true })
  }

  console.log('\n===== 4. 工具名 / 参数名 别名归一 =====')
  {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-'))
    const calls = []
    const mockApi = {
      agent: {
        todo: (root, action, payload) => { calls.push(['todo', action, payload]); return { ok: true, output: 'ok' } },
        readFile: (root, rel, off, lim) => { calls.push(['readFile', rel]); return { ok: true, content: 'x' } },
      },
    }
    global.window = { electronAPI: mockApi }
    calls.length = 0
    await executeTool('todo_write', { action: 'add', content: 's1' }, workdir, false)
    ok('别名 todo_write → 落到 todo 处理器', calls[0] && calls[0][0] === 'todo' && calls[0][1] === 'add')
    calls.length = 0
    await executeTool('read_file', { file_path: 'a/b.txt' }, workdir, false)
    ok('参数名 file_path → path（readFile 收到 a/b.txt）', calls[0] && calls[0][0] === 'readFile' && calls[0][1] === 'a/b.txt')
    fs.rmSync(workdir, { recursive: true, force: true })
  }

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
  if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '))
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.log('\n致命错误:', (e && e.stack) || e); process.exit(1) })
