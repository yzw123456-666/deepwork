/**
 * 端到端测试：跑真实 runAgentLoop，验证「AI 说要建文件 → 文件真的出现在磁盘上」。
 *
 * 这是用户反复反馈的那个 bug 的回归测试：
 *   对话页原本只做单轮 chat，AI 会如实回答「我没有文件写入权限」。
 *   现在 ChatArea 直连 runAgentLoop，本测试走一遍真实链路：
 *     parseToolCall → executeTool → IPC handler → fs 写盘
 *
 * 做法：mock 'electron' → 加载真实 dist-electron/main.js 拿 handler
 *       → 全局 mock fetch 返回脚本化的模型回复 → 调用真实（转译后的）agentEngine
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

const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-chat-user-'))
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-chat-ws-'))
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

console.log('\n===== 0. 加载真实主进程（拿工具 handler） =====')
;(async () => {
  require(path.join(dist, 'main.js'))
  await new Promise((r) => setTimeout(r, 50))

  // 关闭沙箱，排除策略干扰，专测「链路是否真的能落盘」
  fs.writeFileSync(path.join(tmpUser, 'config.json'), JSON.stringify({ sandboxEnabled: false }))

  const call = (ch, ...args) => handlers[ch](null, ...args)
  ok('已注册 agent:writeFile', !!handlers['agent:writeFile'])
  ok('已注册 app:getDefaultWorkDir', !!handlers['app:getDefaultWorkDir'])

  console.log('\n===== 0b. app:getDefaultWorkDir 返回有效目录 =====')
  const wd = await call('app:getDefaultWorkDir')
  ok('返回非空字符串', typeof wd === 'string' && wd.length > 0, String(wd))
  ok('返回的目录真实存在', fs.existsSync(wd), String(wd))

  // ---------- 桥接 window.electronAPI → IPC handler ----------
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
  console.log('\n===== 1. 装载真实 agentEngine =====')
  const engineSrc = fs.readFileSync(path.join(root, 'src', 'services', 'agentEngine.ts'), 'utf8')
  const patched = engineSrc
    .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/types'/, '')
    .replace(/import\s*\{\s*v4 as uuidv4\s*\}\s*from\s*'uuid'/, "const uuidv4 = () => 'id-' + Math.random().toString(36).slice(2)")
  const js = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const enginePath = path.join(root, '.temp-engine.cjs')
  fs.writeFileSync(enginePath, js)
  let engine
  try { engine = require(enginePath) } catch (e) {
    console.log('  \u2717 agentEngine 装载失败:', e.message)
    fs.unlinkSync(enginePath); process.exit(1)
  }
  ok('导出了 runAgentLoop', typeof engine.runAgentLoop === 'function')

  // ---------- mock fetch：脚本化模型回复 ----------
  const replies = [
    '我来创建这个文件。\n\nTOOL: write_file\nARGS: {"file_path": "hello.txt", "content": "你好，deepwork"}',
    'DONE: 已创建 hello.txt，内容为问候语。',
  ]
  let callIdx = 0
  const seenBodies = []
  global.fetch = async (url, init) => {
    seenBodies.push(JSON.parse(init.body))
    const text = replies[Math.min(callIdx, replies.length - 1)]
    callIdx++
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    return {
      ok: true, status: 200,
      headers: { get: () => 'text/event-stream' },
      body: {
        getReader() {
          let done = false
          const enc = new TextEncoder()
          return { read: async () => (done ? { done: true } : (done = true, { done: false, value: enc.encode(sse) })) }
        },
      },
      text: async () => '', json: async () => ({}),
    }
  }

  console.log('\n===== 2. 跑真实 Agent Loop：模型说 Write → 断言磁盘 =====')
  const model = { id: 'm1', name: 'fake-model', enabled: true, baseUrl: 'http://localhost:1/v1', apiKey: 'k', contextWindow: 32768 }
  const steps = []
  const result = await engine.runAgentLoop(
    model, workspace,
    '帮我建一个 hello.txt，内容是「你好，deepwork」',
    '你是 deepwork 的对话助手，拥有真实的文件读写与命令执行工具。',
    false,
    { onStatus: async () => {}, onToolUse: async (tool, args, r) => steps.push({ tool, args, ok: r.ok, out: r.output }), onThinking: () => {} },
    [], undefined, { thinkingDepth: 'low' }
  )

  console.log('\n===== 3. 工具确实被执行 =====')
  ok('至少调用一次工具', steps.length >= 1, 'steps=' + steps.length)
  const w = steps.find(s => s.tool === 'write_file')
  ok('调用了 write_file', !!w)
  ok('write_file 成功', !!(w && w.ok), w ? String(w.out).slice(0, 140) : '')

  console.log('\n===== 4. 文件真的落到了磁盘 =====')
  const target = path.join(workspace, 'hello.txt')
  ok('文件存在', fs.existsSync(target), target)
  const content = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  ok('内容完全正确', content === '你好，deepwork', JSON.stringify(content))

  console.log('\n===== 5. 返回的是总结，不含代码块 =====')
  ok('返回 DONE 总结', result.includes('已创建'), result.slice(0, 100))
  ok('总结里没有代码块', !result.includes('```'))

  console.log('\n===== 5b. 模型硬贴代码时也必须被清掉 =====')
  // 场景：模型不听话，DONE 总结里塞了一大坨代码。引擎的纠正在 3 次后耗尽，
  // 兜底 stripCodeBlocks 必须把代码剥掉，只留结论文字。
  const stubborn = [
    'TOOL: write_file\nARGS: {"file_path": "stubborn.js", "content": "console.log(1)"}',
    'DONE: 已创建 stubborn.js。\n\n```js\n' + Array.from({ length: 30 }, (_, i) => `const x${i} = ${i}`).join('\n') + '\n```\n\n完成。',
  ]
  let i3 = 0
  global.fetch = async () => {
    const text = stubborn[Math.min(i3, stubborn.length - 1)]
    i3++
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    return {
      ok: true, status: 200, headers: { get: () => 'text/event-stream' },
      body: { getReader() { let d = false; const enc = new TextEncoder(); return { read: async () => (d ? { done: true } : (d = true, { done: false, value: enc.encode(sse) })) } } },
      text: async () => '', json: async () => ({}),
    }
  }
  const r3 = await engine.runAgentLoop(
    model, workspace, '建一个 stubborn.js',
    '你是 deepwork 的对话助手。',
    false,
    { onStatus: async () => {}, onToolUse: async () => {}, onThinking: () => {} },
    [], undefined, { thinkingDepth: 'low' }
  )
  ok('文件仍然落盘', fs.existsSync(path.join(workspace, 'stubborn.js')))
  ok('回复里没有代码块', !r3.includes('```'), r3.slice(0, 200))
  ok('回复里没有代码正文', !r3.includes('const x29'), r3.slice(0, 200))

  console.log('\n===== 6. 系统提示词声明了真实工具能力 =====')
  const sys = (seenBodies[0]?.messages || []).find(m => m.role === 'system')?.content || ''
  ok('含「拥有真实的文件读写」', sys.includes('拥有真实的文件读写'))
  ok('含工作目录', sys.includes('工作目录'))
  ok('不再宣称不挂载工具', !sys.includes('此模式不挂载文件读写工具'))
  ok('不再引导去任务视图', !/切到左侧|切到「任务」/.test(sys))

  console.log('\n===== 7. 多步：先读后改也要真的生效 =====')
  const multiPath = path.join(workspace, 'multi.txt')
  fs.writeFileSync(multiPath, 'v1')
  const replies2 = [
    'TOOL: read_file\nARGS: {"file_path": "multi.txt"}',
    'TOOL: edit_file\nARGS: {"file_path": "multi.txt", "old_string": "v1", "new_string": "v2"}',
    'DONE: 已把 multi.txt 从 v1 改成 v2。',
  ]
  let i2 = 0
  global.fetch = async (url, init) => {
    const text = replies2[Math.min(i2, replies2.length - 1)]
    i2++
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
    return {
      ok: true, status: 200, headers: { get: () => 'text/event-stream' },
      body: { getReader() { let d = false; const enc = new TextEncoder(); return { read: async () => (d ? { done: true } : (d = true, { done: false, value: enc.encode(sse) })) } } },
      text: async () => '', json: async () => ({}),
    }
  }
  const r2 = await engine.runAgentLoop(
    model, workspace, '把 multi.txt 里的 v1 改成 v2',
    '你是 deepwork 的对话助手，拥有真实的文件读写与命令执行工具。',
    false,
    { onStatus: async () => {}, onToolUse: async () => {}, onThinking: () => {} },
    [], undefined, { thinkingDepth: 'low' }
  )
  ok('edit 后内容为 v2', fs.readFileSync(multiPath, 'utf8') === 'v2', fs.readFileSync(multiPath, 'utf8'))
  ok('返回总结', r2.includes('v2') || r2.includes('DONE') || r2.length > 0)

  // 清理
  try { fs.unlinkSync(enginePath) } catch {}
  try { fs.rmSync(tmpUser, { recursive: true, force: true }) } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true }) } catch {}

  console.log('\n===== 结果：通过 ' + pass + ' 项，失败 ' + fails.length + ' 项 =====')
  if (fails.length) {
    console.log('失败项：')
    fails.forEach(f => console.log(' - ' + f))
    process.exit(1)
  }
})().catch(e => {
  console.log('\n致命错误:', (e && e.stack) || e)
  process.exit(1)
})
