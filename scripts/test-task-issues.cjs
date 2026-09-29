/**
 * 轮 J 专项实测（2026-09-22 用户反馈 4 项 + 要求「测试完成再给我」）：
 *
 *   1. 写入文件失败（「无法创建，写入文件」）——根因：模型给绝对路径时
 *      path.join(root, 'D:\\x') 拼出含中间冒号的非法路径，写盘必败。
 *      修复：渲染层 normalizeToolPath + 主进程 resolveInsideRoot 双层归一。
 *      实测走「真实 executeTool → 真实 IPC handler → 真实 fs 落盘」全链路。
 *
 *   2. 未执行完成就开始最终汇报——根因：模型输出纯文本计划（非 TOOL/DONE）
 *      被引擎直接当 result 返回。修复：中途开讲检测 → 纠正继续。
 *      实测：mock 模型先输出计划文本，断言引擎不结束、纠正后继续写文件。
 *
 *   3. 思考区出现代码（围栏块 + 无围栏裸代码）——codeFold 折叠验证。
 *
 *   4. 完成式文案「修改：（路径）」——静态断言 ChatArea.describeToolDone。
 *
 * 架构沿用 test-chat-e2e：mock electron → 加载真实 dist-electron/main.js 拿 handler
 * → 桥接 window.electronAPI → mock fetch 脚本化模型回复 → 装载真实（转译后）agentEngine。
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const ts = require('typescript')
const Module = require('module')

let pass = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name) }
  else { fails.push(name + (extra ? ' \u2192 ' + extra : '')); console.log('  \u2717 ' + name + (extra ? ' \u2192 ' + extra : '')) }
}

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist-electron')

const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-j-user-'))
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-j-ws-'))
const handlers = {}

const fakeElectron = {
  app: {
    requestSingleInstanceLock: () => true,
    getPath: (name) => (name === 'userData' ? tmpUser : name === 'appData' ? tmpUser : path.join(tmpUser, name)),
    getName: () => 'deepwork',
    getVersion: () => '1.0.0',
    whenReady: () => Promise.resolve(),
    on: () => {}, quit: () => {}, isReady: () => true,
  },
  BrowserWindow: class {
    constructor() {}
    loadFile() {} loadURL() {} on() {} show() {} close() {} minimize() {} maximize() {}
    restore() {} focus() {} isMinimized() { return false } isMaximized() { return false }
    webContents = { send() {}, on() {}, setWindowOpenHandler() {}, session: { setPermissionRequestHandler() {} } }
  },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn }, on: () => {} },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
    showMessageBox: () => Promise.resolve({ response: 0 }),
    showErrorBox: () => {},
  },
  shell: { openExternal: () => {}, openPath: () => Promise.resolve(''), showItemInFolder: () => {}, trashItem: (fp) => { try { fs.rmSync(fp, { recursive: true, force: true }) } catch {} return Promise.resolve() } },
  Notification: class { constructor() {} show() {} static isSupported() { return false } },
  nativeTheme: { themeSource: '' },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  webUtils: { getPathForFile: (f) => (f && f.__filePath) || '' },
  Tray: class { constructor() {} setContextMenu() {} },
  Menu: { setApplicationMenu() {}, buildFromTemplate: (t) => t },
}

const origLoad = Module._load
Module._load = function (request) {
  if (request === 'electron') return fakeElectron
  return origLoad.apply(this, arguments)
}

;(async () => {
  console.log('\n===== 0. 加载真实主进程（安全策略 + 写入 handler） =====')
  require(path.join(dist, 'main.js'))
  await new Promise((r) => setTimeout(r, 50))
  fs.writeFileSync(path.join(tmpUser, 'config.json'), JSON.stringify({ sandboxEnabled: false }))
  const call = (ch, ...args) => handlers[ch](null, ...args)
  ok('已注册 agent:writeFile', !!handlers['agent:writeFile'])

  // 主进程 security.js 的 resolveInsideRoot 直测
  const sec = require(path.join(dist, 'security.js'))
  ok('security 导出 resolveInsideRoot', typeof sec.resolveInsideRoot === 'function')

  console.log('\n===== 1. 主进程 resolveInsideRoot 归一化 =====')
  const winRoot = workspace.replace(/\//g, '\\')
  const inAbs = path.join(winRoot, 'a.html')
  ok('root 内绝对路径 → 原样返回', path.resolve(sec.resolveInsideRoot(winRoot, inAbs)) === path.resolve(inAbs))
  ok('POSIX 风格 /x → root 下', path.resolve(sec.resolveInsideRoot(winRoot, '/go.html')) === path.resolve(path.join(winRoot, 'go.html')))
  ok('相对路径 → join', path.resolve(sec.resolveInsideRoot(winRoot, 'go.html')) === path.resolve(path.join(winRoot, 'go.html')))
  let threw = ''
  try { sec.resolveInsideRoot(winRoot, 'D:\\other\\evil.html') } catch (e) { threw = e.message }
  ok('root 外绝对路径 → 抛越界错误', threw.includes('越界') || threw.includes('相对路径'), threw)
  // 关键回归：修复前 path.join 会产出「root\D:\x」非法路径
  const legacy = path.join(winRoot, 'D:\\other\\x.html')
  ok('path.join 非法拼接确实存在（修复对象确认）', /D:/.test(legacy.slice(winRoot.length)), legacy)

  // ---------- 桥接 window.electronAPI ----------
  const W = (ch) => (...args) => call(ch, ...args)
  global.window = {
    electronAPI: {
      agent: {
        readFile: W('agent:readFile'),
        writeFile: W('agent:writeFile'),
        editFile: W('agent:editFile'),
        appendFile: W('agent:appendFile'),
        deleteFile: W('agent:deleteFile'),
        listDir: W('agent:listDir'),
        findFiles: W('agent:findFiles'),
        searchFiles: W('agent:searchFiles'),
        runCommand: W('agent:runCommand'),
        webSearch: W('agent:webSearch'),
        webFetch: W('agent:webFetch'),
      },
      skills: { list: async () => ({ skills: [] }) },
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  }
  global.navigator = { platform: 'Win32', userAgent: 'Windows' }
  global.document = { addEventListener: () => {}, removeEventListener: () => {} }

  // ---------- 装载真实 agentEngine ----------
  console.log('\n===== 2. 装载真实 agentEngine（转译） =====')
  const engineSrc = fs.readFileSync(path.join(root, 'src', 'services', 'agentEngine.ts'), 'utf8')
  const patched = engineSrc
    .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/types'/, '')
    .replace(/import\s*\{\s*v4 as uuidv4\s*\}\s*from\s*'uuid'/, "const uuidv4 = () => 'id-' + Math.random().toString(36).slice(2)")
  const js = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const enginePath = path.join(root, '.temp-engine-j.cjs')
  fs.writeFileSync(enginePath, js)
  let engine
  try { engine = require(enginePath) } catch (e) {
    console.log('  \u2717 agentEngine 装载失败:', e.message)
    fs.unlinkSync(enginePath); process.exit(1)
  }
  ok('导出了 runAgentLoop', typeof engine.runAgentLoop === 'function')
  ok('导出了 normalizeToolPath', typeof engine.normalizeToolPath === 'function')

  console.log('\n===== 3. normalizeToolPath 纯函数 =====')
  const n1 = engine.normalizeToolPath(winRoot, inAbs)
  ok('root 内绝对路径 → 转相对', n1.ok && path.resolve(path.join(winRoot, n1.rel)) === path.resolve(inAbs), JSON.stringify(n1))
  const n2 = engine.normalizeToolPath(winRoot, '/go.html')
  ok('POSIX 风格 → 相对', n2.ok && n2.rel === 'go.html', JSON.stringify(n2))
  const n3 = engine.normalizeToolPath(winRoot, 'go.html')
  ok('相对路径 → 原样', n3.ok && n3.rel === 'go.html', JSON.stringify(n3))
  const n4 = engine.normalizeToolPath(winRoot, 'D:\\other\\evil.html')
  ok('root 外绝对路径 → 拒绝并提示用相对路径', !n4.ok && n4.error.includes('相对路径'), n4.ok ? '' : String(n4.error).slice(0, 90))
  const n5 = engine.normalizeToolPath(winRoot, '')
  ok('空路径 → 放行空串', n5.ok && n5.rel === '')

  // ---------- mock fetch ----------
  const sseText = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n'
  const sseOf = (text) => ({
    ok: true, status: 200, headers: { get: () => 'text/event-stream' },
    body: { getReader() { let d = false; const enc = new TextEncoder(); const payload = sseText(text); return { read: async () => (d ? { done: true } : (d = true, { done: false, value: enc.encode(payload) })) } } },
    text: async () => '', json: async () => ({}),
  })
  const model = { id: 'm1', name: 'fake-model', enabled: true, baseUrl: 'http://localhost:1/v1', apiKey: 'k', contextWindow: 32768 }

  console.log('\n===== 4. 实测：模型给绝对路径（root 内）→ 文件必须真的落盘 =====')
  const absTarget = path.join(winRoot, '绝对路径测试.html')
  {
    let callIdx = 0
    const replies = [
      `TOOL: write_file\nARGS: {"file_path": "${absTarget.replace(/\\/g, '\\\\')}", "content": "<h1>绝对路径写入成功</h1>"}`,
      'DONE: 已写入绝对路径测试.html',
    ]
    global.fetch = async () => sseOf(replies[Math.min(callIdx++, replies.length - 1)])
    const steps = []
    const result = await engine.runAgentLoop(
      model, workspace, '把页面写到 绝对路径测试.html',
      '你是助手。', false,
      { onStatus: async () => {}, onToolUse: async (t, a, r) => steps.push({ t, ok: r.ok, out: r.output }), onThinking: () => {} },
      [], undefined, { thinkingDepth: 'low' }
    )
    const w = steps.find(s => s.t === 'write_file')
    ok('write_file 执行成功', !!(w && w.ok), w ? String(w.out).slice(0, 120) : '未调用')
    ok('文件真实落盘', fs.existsSync(absTarget), absTarget)
    ok('内容正确', fs.existsSync(absTarget) && fs.readFileSync(absTarget, 'utf8') === '<h1>绝对路径写入成功</h1>')
    ok('任务是 DONE 结束而非中途文本', String(result).includes('已写入'), String(result).slice(0, 80))
  }

  console.log('\n===== 5. 实测：绝对路径在工作目录外 → 明确报错引导，而非 ENOENT =====')
  {
    let callIdx = 0
    const replies = [
      'TOOL: write_file\nARGS: {"file_path": "D:\\\\other\\\\outside.html", "content": "x"}',
      'DONE: 已了解路径限制',
    ]
    global.fetch = async () => sseOf(replies[Math.min(callIdx++, replies.length - 1)])
    const steps = []
    await engine.runAgentLoop(
      model, workspace, '写到 D:\\other\\outside.html',
      '你是助手。', false,
      { onStatus: async () => {}, onToolUse: async (t, a, r) => steps.push({ t, ok: r.ok, out: r.output }), onThinking: () => {} },
      [], undefined, { thinkingDepth: 'low' }
    )
    const w = steps.find(s => s.t === 'write_file')
    ok('执行失败（安全边界）', !!(w && !w.ok))
    ok('错误信息引导用相对路径（不是 ENOENT）', !!(w && /相对路径/.test(String(w.out))), w ? String(w.out).slice(0, 100) : '')
    ok('root 外文件没有落盘', !fs.existsSync('D:\\other\\outside.html'))
  }

  console.log('\n===== 6. 实测：edit/append/move 的路径归一化 =====')
  {
    const editTarget = path.join(winRoot, 'edit-me.txt')
    fs.writeFileSync(editTarget, 'hello world')
    let callIdx = 0
    const replies = [
      `TOOL: edit_file\nARGS: {"file_path": "${editTarget.replace(/\\/g, '\\\\')}", "old_string": "world", "new_string": "deepwork"}`,
      `TOOL: append_file\nARGS: {"file_path": "edit-me.txt", "content": "\\n追加行"}`,
      'DONE: 编辑完成',
    ]
    global.fetch = async () => sseOf(replies[Math.min(callIdx++, replies.length - 1)])
    const steps = []
    await engine.runAgentLoop(
      model, workspace, '编辑 edit-me.txt',
      '你是助手。', false,
      { onStatus: async () => {}, onToolUse: async (t, a, r) => steps.push({ t, ok: r.ok, out: r.output }), onThinking: () => {} },
      [], undefined, { thinkingDepth: 'low' }
    )
    const content = fs.readFileSync(editTarget, 'utf8')
    ok('edit_file 绝对路径生效', content.includes('hello deepwork'), JSON.stringify(content))
    ok('append_file 相对路径生效', content.includes('追加行'), JSON.stringify(content))
    ok('两步都成功', steps.length >= 2 && steps.every(s => s.ok), JSON.stringify(steps.map(s => [s.t, s.ok])))
  }

  console.log('\n===== 7. 实测：中途开讲（未完成就汇报）→ 纠正继续 =====')
  {
    let callIdx = 0
    const replies = [
      '我先看一下现有的五子棋实现，保持风格一致，然后动手写围棋页面。',
      'TOOL: write_file\nARGS: {"file_path": "围棋.html", "content": "<h1>围棋</h1>"}',
      'DONE: 已创建围棋.html。',
    ]
    global.fetch = async () => sseOf(replies[Math.min(callIdx++, replies.length - 1)])
    const steps = []
    const result = await engine.runAgentLoop(
      model, workspace, '参考五子棋写一个围棋页面',
      '你是助手。', false,
      { onStatus: async () => {}, onToolUse: async (t, a, r) => steps.push({ t, ok: r.ok, out: r.output }), onThinking: () => {} },
      [], undefined, { thinkingDepth: 'low' }
    )
    ok('计划文本没有终止任务（继续调用工具）', steps.length >= 1, 'steps=' + steps.length)
    ok('文件落盘', fs.existsSync(path.join(workspace, '围棋.html')))
    ok('最终返回 DONE 总结', String(result).includes('围棋'), String(result).slice(0, 80))
    // 引擎发给模型的纠正消息可见性：第二次调用 messages 里应含「还没有完成」
  }

  console.log('\n===== 8. 实测：知识型任务的纯文本回答不受中途开讲检测误伤 =====')
  {
    let callIdx = 0
    global.fetch = async () => sseOf('首先，光合作用是植物将光能转化为化学能的过程。（完整回答）')
    const result = await engine.runAgentLoop(
      model, workspace, '解释光合作用',
      '你是助手。', false,
      { onStatus: async () => {}, onToolUse: async () => {}, onThinking: () => {} },
      [], undefined, { thinkingDepth: 'low' }
    )
    ok('纯文本回答原样返回', String(result).includes('光合作用是植物'), String(result).slice(0, 80))
  }

  console.log('\n===== 9. codeFold：思考区代码折叠 =====')
  {
    // codeFold.ts 是纯 TS 无依赖，直接转译加载
    const src = fs.readFileSync(path.join(root, 'src', 'services', 'codeFold.ts'), 'utf8')
    const js2 = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const cfPath = path.join(root, '.temp-codefold.cjs')
    fs.writeFileSync(cfPath, js2)
    const cf = require(cfPath)
    ok('导出 sanitizeThinkingDisplay', typeof cf.sanitizeThinkingDisplay === 'function')

    const fence = '计划如下：\n```js\nlet SIZE = 19;\nlet board = [];\n```\n然后开始写。'
    ok('围栏代码块折叠成一行', cf.sanitizeThinkingDisplay(fence) === '计划如下：\n📄 代码草稿（未写入文件）\n然后开始写。', JSON.stringify(cf.sanitizeThinkingDisplay(fence)))

    const unclosed = '写代码：\n```js\nconst a = 1;'
    ok('未闭合围栏也折叠', !cf.sanitizeThinkingDisplay(unclosed).includes('const a'), JSON.stringify(cf.sanitizeThinkingDisplay(unclosed)))

    const bare = [
      '分析布局：',
      'const CSS_SIZE = 640; // 逻辑边长',
      '',
      'function cellSize() { return CSS_SIZE / (SIZE + 1); }',
      '',
      'function idxToXY(i, j) {',
      '  const c = cellSize();',
      '  return [c * (i + 1), c * (j + 1)];',
      '}',
      '',
      '按这个写。',
    ].join('\n')
    const folded = cf.sanitizeThinkingDisplay(bare)
    ok('无围栏裸代码整段折叠', !folded.includes('const CSS_SIZE') && !folded.includes('idxToXY'), JSON.stringify(folded))
    ok('裸代码折叠保留正文', folded.includes('分析布局：') && folded.includes('按这个写。'), JSON.stringify(folded))

    const prose = '这里 let SIZE = 19 是棋盘边长；另外 return 语句在函数末尾。所以逻辑是对的。'
    ok('单行代码提及不误伤', cf.sanitizeThinkingDisplay(prose) === prose, JSON.stringify(cf.sanitizeThinkingDisplay(prose)))

    const html = '<!DOCTYPE html>\n<html><body>x</body></html>'
    ok('裸 HTML 文档折叠', !cf.sanitizeThinkingDisplay('内容：\n' + html).includes('<html'), JSON.stringify(cf.sanitizeThinkingDisplay('内容：\n' + html)))

    const multi = '第一段思考。\n\n第二段思考。'
    ok('多段思考保留空行分隔', cf.sanitizeThinkingDisplay(multi) === multi)
  }

  console.log('\n===== 9b. codeFold：parseThinkingUnits（代码草稿可展开单元，2026-09-24） =====')
  {
    // codeFold.ts 是纯 TS 无依赖，直接转译加载
    const src = fs.readFileSync(path.join(root, 'src', 'services', 'codeFold.ts'), 'utf8')
    const js2 = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const cfPath = path.join(root, '.temp-codefold.cjs')
    fs.writeFileSync(cfPath, js2)
    const cf = require(cfPath)
    ok('导出 parseThinkingUnits', typeof cf.parseThinkingUnits === 'function')

    const pu1 = cf.parseThinkingUnits('计划如下：\n```js\nlet SIZE = 19;\nlet board = [];\n```\n然后开始写。')
    ok('围栏块解析为 code 单元（含原文，内容不丢）', pu1.some(u => u.kind === 'code' && u.code.includes('let SIZE = 19;')))
    ok('围栏块前后思考文字为 text 单元', pu1.some(u => u.kind === 'text' && u.text.includes('计划如下：')) && pu1.some(u => u.kind === 'text' && u.text.includes('然后开始写。')))

    const pu2 = cf.parseThinkingUnits('写代码：\n```js\nconst a = 1;')
    ok('未闭合围栏（流式中）也是 code 单元', pu2.some(u => u.kind === 'code' && u.code.includes('const a = 1;')))

    const pu3 = cf.parseThinkingUnits('分析布局：\nconst CSS_SIZE = 640; // 逻辑边长\n\nfunction cellSize() { return CSS_SIZE / (SIZE + 1); }\nfunction idxToXY(i, j) {\n  return [cellSize() * (i + 1), cellSize() * (j + 1)];\n}\n\n按这个写。')
    ok('无围栏裸代码 ≥3 行解析为 code 单元', pu3.some(u => u.kind === 'code' && u.code.includes('const CSS_SIZE = 640;')), JSON.stringify(pu3.map(u => u.kind)))
    ok('裸代码前后正文为 text 单元', pu3.some(u => u.kind === 'text' && u.text.includes('分析布局：')) && pu3.some(u => u.kind === 'text' && u.text.includes('按这个写。')))

    const pu4 = cf.parseThinkingUnits('这里 let SIZE = 19 是棋盘边长；另外 return 语句在函数末尾。所以逻辑是对的。')
    ok('单行代码提及不产生 code 单元', pu4.length === 1 && pu4[0].kind === 'text')

    // 边界一致性：code 单元替换回占位行拼回去 ≙ sanitizeThinkingDisplay 的折叠结果
    const sample = '计划如下：\n```js\nlet SIZE = 19;\n```\n然后开始写。'
    const joined = cf.parseThinkingUnits(sample).map(u => u.kind === 'text' ? u.text : '📄 代码草稿（未写入文件）').join('')
    ok('单元拼回与 sanitizeThinkingDisplay 折叠边界一致', joined === cf.sanitizeThinkingDisplay(sample), JSON.stringify(joined))
  }

  console.log('\n===== 10. 完成式文案「动作：（路径）」格式 =====')
  {
    const chat = fs.readFileSync(path.join(root, 'src', 'components', 'ChatArea.tsx'), 'utf8')
    ok('edit_file → 编辑 路径（2026-09-23 视频格式，无冒号）', /case\s*'edit_file':\s*return\s*`编辑 \$\{p\}`/.test(chat))
    ok('write_file → 写入 路径（视频格式）', /case\s*'write_file':\s*return\s*`写入 \$\{p\}`/.test(chat))
    ok('search_files → 搜索 路径 关键词', /case\s*'search_files':\s*return\s*`搜索 \$\{p\} \$\{String\(args\?\.pattern/.test(chat))
    ok('run_command → 运行命令', /case\s*'run_command':\s*return\s*`运行命令`/.test(chat))
    ok('完成态线性图标（绿勾 CheckCircle2 / 红叉 XCircle / 灰 spinner，无彩色 emoji）', /CheckCircle2/.test(chat) && /XCircle/.test(chat) && /text-green-600/.test(chat) && !/function\s+inferToolEmoji\(/.test(chat))
    ok('工具行单行截断（truncate，超宽悬停看全文）', /text-\[13px\] truncate/.test(chat) && !/leading-5 break-all \$\{state/.test(chat))
    ok('元信息行「已处理」（12:11 视频，替代「已完成」）', /已处理/.test(chat) && !/text-xs">已完成</.test(chat))
    ok('完成式不再截短文件名（用完整路径）', !/已修改文件 \$\{short\}/.test(chat))
    // 独立任务界面已删除（轮 K）：原 TaskWorkspace 断言改为 ChatArea（任务 UI 已同步到对话页）
    ok('ChatArea 思考区接入 parseThinkingUnits（代码草稿可展开，2026-09-24）', chat.includes('parseThinkingUnits'))
    ok('ChatArea 思考区分段渲染（多次思考）', /segments\.map/.test(chat))
    ok('ChatArea onStatus 封段（工具动作打断思考流）', chat.includes('fullThinkingRef.current += ') && chat.includes('\\n\\n'))
    ok('ChatArea 任务会话用任务工作目录', chat.includes('currentConversation?.taskId'))
    ok('ChatArea 完成后自动沉淀记忆', chat.includes('autoSummarizeMemory'))
    ok('ChatArea 消费 pendingTaskMessage（新任务首条不丢）', chat.includes('pendingTaskMessage') && chat.includes('setPendingTaskMessage(null)'))
    // 独立任务界面彻底删除断言
    ok('TaskWorkspace.tsx 文件已删除', !fs.existsSync(path.join(root, 'src', 'components', 'TaskWorkspace.tsx')))
    ok('TaskChecklist.tsx 文件已删除', !fs.existsSync(path.join(root, 'src', 'components', 'TaskChecklist.tsx')))
    const app = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8')
    ok('App.tsx 不再引用 taskWorkspace', !/taskWorkspace/i.test(app))
    ok('App.tsx openTask 打开任务最新会话', /taskConvs|taskId: task\.id/.test(app))
    const sidebar = fs.readFileSync(path.join(root, 'src', 'components', 'Sidebar.tsx'), 'utf8')
    ok('Sidebar.tsx 不再引用 taskWorkspace', !/taskWorkspace/i.test(sidebar))
    const ctd = fs.readFileSync(path.join(root, 'src', 'components', 'CreateTaskDialog.tsx'), 'utf8')
    ok('新建任务后进对话页而非任务界面', ctd.includes("setActivePage('chat')") && !/taskWorkspace/i.test(ctd))
    const eng = fs.readFileSync(path.join(root, 'src', 'services', 'agentEngine.ts'), 'utf8')
    ok('引擎中途开讲检测存在', eng.includes('中途开讲检测') && eng.includes('planTalkCount'))
    ok('引擎路径归一化接入 executeTool', eng.includes('normalizeToolPath(root'))
    // 只读不写防线（2026-09-23 用户反馈「写入文件时没有真正的写入文件」：弱模型反复读同一文件从不动手写）
    ok('引擎「只读不写」防线存在（反复读同一文件未写 → 催促动手）', eng.includes('rereadPromptCount') && eng.includes('你已经读取'))
    ok('提示词要求「同一个文件读一次就够了」', eng.includes('同一个文件读一次就够了'))
    // 2026-09-23 用户要求「出现写入就是真的开始写」：思考区代码草稿不再误判 + 未写文件拒绝结束
    ok('思考区草稿豁免 + 完整文件藏思考区判违规（防逃避落盘静默终止）',
      /function hasUnsavedCodeBlock/.test(eng) &&
      eng.includes('inThink') &&
      /(?:b\.length > 400|codeLines >= 10)/.test(eng) &&
      /<think>/.test(eng))
    ok('写入意图兜底（任务要求写文件但整轮未写 → 拒绝结束逼它动手）', eng.includes('isWriteIntentTask') && eng.includes('writeIntentCount') && eng.includes('内容停留在思考或回复里等于零'))
    // 「智商」优化（2026-09-23）：同文件重复读取的结果不再全文重塞上下文
    ok('重复读取去重（同内容省略，省上下文防迷失）', eng.includes('lastReadOutput') && eng.includes('内容与上一次读取完全相同'))
    // 写入/编辑行 UI 规格（视频 f1992：✏️ 图标 + 路径绿色高亮）
    ok('写入/编辑行 ✏️ 图标 + 绿色路径（视频规格）', /✏️<\/span>/.test(chat) && /editMatch\[2\]/.test(chat))
  }

  // 2026-09-24 用户反馈「300 秒内没有收到任何数据」：长工具/思考期间 ChatArea 无数据超时误触发
  {
    const chat = fs.readFileSync(path.join(root, 'src', 'components', 'ChatArea.tsx'), 'utf8')
    ok('工具执行状态 ref 存在', /const toolInProgressRef = useRef\(false\)/.test(chat))
    ok('onToolUse 工具完成后恢复 stall 检测', /onToolUse = async \([^)]*\) => \{[\s\S]{0,220}?toolInProgressRef\.current = false\s*\n\s*armStallTimer\(controller, stallSeconds\)/.test(chat))
    ok('onStatus 工具调用开始时暂停 stall 检测', /onStatus = async \([^)]*\) => \{[\s\S]{0,120}?if \(toolCall\) \{[\s\S]{0,220}?toolInProgressRef\.current = true\s*\n\s*if \(stallTimerRef\.current\) \{ clearTimeout\(stallTimerRef\.current\); stallTimerRef\.current = null \}/.test(chat))
    ok('onThinking 思考输出时重置 stall 检测', /onThinking: \(delta\) => \{[\s\S]{0,120}?if \(!toolInProgressRef\.current\) armStallTimer\(controller, stallSeconds\)/.test(chat))
    ok('finally 兜底重置 toolInProgressRef', /stallReasonRef\.current = ''\s*\n\s*toolInProgressRef\.current = false/.test(chat))
  }

  // 清理
  try { fs.unlinkSync(enginePath) } catch {}
  try { fs.unlinkSync(path.join(root, '.temp-codefold.cjs')) } catch {}

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fails.length} 项 =====`)
  if (fails.length) { fails.forEach(f => console.log(' - ' + f)); process.exit(1) }
})().catch(e => { console.error('测试执行异常:', e); process.exit(1) })
