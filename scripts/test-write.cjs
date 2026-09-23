// 写入工具端到端测试：验证 agent:writeFile / editFile / appendFile 是否能真正落盘
// 思路：mock 'electron' 主模块 → 加载真实 dist-electron/main.js → 直接调用 IPC handler
// 运行前需先 tsc -p electron/tsconfig.json 生成 dist-electron/
// 用法：node scripts/test-write.cjs

const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dist = path.join(__dirname, '..', 'dist-electron')

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; failures.push(name); console.log(`  \u2717 ${name}${extra ? ' \u2192 ' + extra : ''}`) }
}

const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-write-user-'))
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-ws-'))
const handlers = {}

let allowNextConfirm = true
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
    showMessageBox: () => Promise.resolve({ response: allowNextConfirm ? 0 : 1 }),
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

console.log('\n===== 加载真实主进程 main.js =====')
;(async () => {
  try {
    require(path.join(dist, 'main.js'))
    await new Promise((r) => setTimeout(r, 50))
    const call = (ch, ...args) => handlers[ch](null, ...args)

    console.log('\n===== 1. 通道注册 =====')
    for (const ch of ['agent:writeFile', 'agent:editFile', 'agent:appendFile', 'agent:readFile']) {
      ok(`已注册 ${ch}`, !!handlers[ch])
    }

    console.log('\n===== 2. 关闭沙箱：基础写入 =====')
    // 写一份配置，显式关闭沙箱，排除策略干扰，先测纯 I/O
    const cfgPath = path.join(tmpUser, 'config.json')
    fs.writeFileSync(cfgPath, JSON.stringify({ sandboxEnabled: false }))

    const rel = 'hello.txt'
    const r1 = await call('agent:writeFile', workspace, rel, 'hello deepwork')
    console.log('    writeFile 返回:', JSON.stringify(r1))
    ok('writeFile 返回 ok', !!(r1 && r1.ok), r1 && r1.error)
    const absFile = path.join(workspace, rel)
    ok('文件真的落盘了', fs.existsSync(absFile))
    if (fs.existsSync(absFile)) {
      ok('内容一致', fs.readFileSync(absFile, 'utf8') === 'hello deepwork')
    }

    console.log('\n===== 3. 子目录自动创建 =====')
    const r2 = await call('agent:writeFile', workspace, 'sub/dir/nested.txt', 'nested content')
    ok('子目录写入返回 ok', !!(r2 && r2.ok), r2 && r2.error)
    ok('子目录被自动创建', fs.existsSync(path.join(workspace, 'sub', 'dir', 'nested.txt')))

    console.log('\n===== 4. 中文路径与中文内容 =====')
    const r3 = await call('agent:writeFile', workspace, '中文目录/说明.md', '# 你好世界\n\n这是中文内容测试。')
    ok('中文路径写入返回 ok', !!(r3 && r3.ok), r3 && r3.error)
    const cnFile = path.join(workspace, '中文目录', '说明.md')
    ok('中文路径文件存在', fs.existsSync(cnFile))
    if (fs.existsSync(cnFile)) {
      ok('中文内容一致', fs.readFileSync(cnFile, 'utf8').includes('你好世界'))
    }

    console.log('\n===== 5. 覆盖写入 =====')
    const r4 = await call('agent:writeFile', workspace, rel, 'overwritten')
    ok('覆盖写入返回 ok', !!(r4 && r4.ok), r4 && r4.error)
    ok('内容已被覆盖', fs.readFileSync(absFile, 'utf8') === 'overwritten')

    console.log('\n===== 6. edit_file 精准替换 =====')
    await call('agent:writeFile', workspace, 'edit.txt', 'alpha\nbeta\ngamma')
    const r5 = await call('agent:editFile', workspace, 'edit.txt', 'beta', 'BETA')
    console.log('    editFile 返回:', JSON.stringify(r5))
    ok('editFile 返回 ok', !!(r5 && r5.ok), r5 && r5.error)
    ok('替换生效', fs.readFileSync(path.join(workspace, 'edit.txt'), 'utf8') === 'alpha\nBETA\ngamma')

    console.log('\n===== 7. append_file 追加 =====')
    const r6 = await call('agent:appendFile', workspace, 'append.txt', 'line1\n')
    ok('appendFile 返回 ok', !!(r6 && r6.ok), r6 && r6.error)
    await call('agent:appendFile', workspace, 'append.txt', 'line2\n')
    const ap = fs.readFileSync(path.join(workspace, 'append.txt'), 'utf8')
    ok('两次追加都在', ap === 'line1\nline2\n', JSON.stringify(ap))

    console.log('\n===== 8. 开启沙箱：写入仍应成功（工作区内） =====')
    fs.writeFileSync(cfgPath, JSON.stringify({ sandboxEnabled: true }))
    const r7 = await call('agent:writeFile', workspace, 'sandbox-on.txt', 'ok with sandbox')
    console.log('    writeFile(沙箱开) 返回:', JSON.stringify(r7))
    ok('沙箱开启时工作区内写入成功', !!(r7 && r7.ok), r7 && r7.error)
    ok('沙箱开启时文件落盘', fs.existsSync(path.join(workspace, 'sandbox-on.txt')))

    console.log('\n===== 9. 沙箱拒绝工作区外的写入 =====')
    const outside = path.join(os.tmpdir(), 'dw-outside-' + Date.now() + '.txt')
    const r8 = await call('agent:writeFile', workspace, outside, 'should be blocked')
    console.log('    writeFile(越界) 返回:', JSON.stringify(r8))
    ok('越界写入被拒绝', !!(r8 && r8.ok === false), '居然成功了：' + r8)
    ok('越界文件未创建', !fs.existsSync(outside))

    console.log('\n===== 10. 空内容与特殊字符 =====')
    const r9 = await call('agent:writeFile', workspace, 'empty.txt', '')
    ok('空内容写入返回 ok', !!(r9 && r9.ok), r9 && r9.error)
    const r10 = await call('agent:writeFile', workspace, 'special.txt', 'a"b\\c\'d\n\ttab\n$var `cmd` ${x}')
    ok('特殊字符写入返回 ok', !!(r10 && r10.ok), r10 && r10.error)
    const sp = fs.readFileSync(path.join(workspace, 'special.txt'), 'utf8')
    ok('特殊字符原样保存', sp === 'a"b\\c\'d\n\ttab\n$var `cmd` ${x}', JSON.stringify(sp))

    console.log('\n===== 11. 大文件写入 =====')
    const big = 'x'.repeat(2_000_000)
    const r11 = await call('agent:writeFile', workspace, 'big.txt', big)
    ok('2MB 写入返回 ok', !!(r11 && r11.ok), r11 && r11.error)
    if (fs.existsSync(path.join(workspace, 'big.txt'))) {
      ok('2MB 内容完整', fs.statSync(path.join(workspace, 'big.txt')).size === 2_000_000)
    }

    console.log('\n===== 12. 读回验证 =====')
    const r12 = await call('agent:readFile', workspace, rel)
    ok('readFile 返回 ok', !!(r12 && r12.ok), r12 && r12.error)
    ok('读回内容正确', !!(r12 && r12.content === 'overwritten'), r12 && r12.content)

    fs.rmSync(workspace, { recursive: true, force: true })
  } catch (e) {
    console.log('\n测试执行异常：', e && e.stack ? e.stack : e)
    fail++
    failures.push('执行异常: ' + (e && e.message))
  }

  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
  if (failures.length) console.log('失败项：\n - ' + failures.join('\n - '))
  process.exit(fail > 0 ? 1 : 0)
})()
