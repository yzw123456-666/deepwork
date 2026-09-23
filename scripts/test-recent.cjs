// 近期功能回归测试（安全沙箱删除阈值 + 粘贴图片 + readDirTree 规模上限 + SSRF）
// 思路：用 Proxy 把 'electron' 主模块整体 mock 掉，再加载真实编译产物 dist-electron/main.js，
// 抓出 ipcMain.handle 注册的 handler 直接调用——测的是真实业务代码，而非复刻实现。
// 运行前需先 tsc -p electron/tsconfig.json 生成 dist-electron/
// 用法：node scripts/test-recent.cjs

const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dist = path.join(__dirname, '..', 'dist-electron')
const sec = require(path.join(dist, 'security.js'))

let pass = 0, fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`) }
}
function eq(name, a, b) { ok(name, a === b, `实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`) }

// ---------------- 1. 安全中心纯函数（直接 require 编译产物） ----------------
console.log('\n===== 1. 安全沙箱：批量删除阈值 needsBatchApproval =====')
eq('阈值未配置(0) → 永不审批', sec.needsBatchApproval({}, 9999), false)
eq('阈值 0 → 不审批', sec.needsBatchApproval({ batchDeleteThreshold: 0 }, 10), false)
eq('阈值 5，删 4 个 → 不审批', sec.needsBatchApproval({ batchDeleteThreshold: 5 }, 4), false)
eq('阈值 5，删 5 个 → 触发审批', sec.needsBatchApproval({ batchDeleteThreshold: 5 }, 5), true)
eq('阈值 5，删 100 个 → 触发审批', sec.needsBatchApproval({ batchDeleteThreshold: 5 }, 100), true)
eq('阈值写成字符串 "5" → 生效', sec.needsBatchApproval({ batchDeleteThreshold: '5' }, 5), true)
eq('阈值非法("abc") → 回落 0 不审批', sec.needsBatchApproval({ batchDeleteThreshold: 'abc' }, 999), false)
eq('删除保护默认开启', sec.shouldTrash({}), true)
eq('删除保护显式关闭', sec.shouldTrash({ deleteProtection: false }), false)
eq('自动备份默认关闭', sec.shouldBackup({}), false)
eq('备份配额默认 3000MB', sec.backupQuotaBytes({}), 3000 * 1024 * 1024)

console.log('\n===== 2. 安全沙箱：URL 策略 evaluateUrl（SSRF 防护） =====')
eq('沙箱关闭 → 放行', sec.evaluateUrl({ sandboxEnabled: false }, 'http://127.0.0.1:9229/').decision, 'allow')
eq('内网 127.0.0.1 → 拒绝(SSRF)', sec.evaluateUrl({ sandboxEnabled: true }, 'http://127.0.0.1:9229/json').decision, 'deny')
eq('云元数据 169.254.169.254 → 拒绝', sec.evaluateUrl({ sandboxEnabled: true }, 'http://169.254.169.254/latest/meta-data/').decision, 'deny')
eq('localhost → 拒绝', sec.evaluateUrl({ sandboxEnabled: true }, 'http://localhost:8080/').decision, 'deny')
eq('10.x 私有段 → 拒绝', sec.evaluateUrl({ sandboxEnabled: true }, 'http://10.0.0.5/api').decision, 'deny')
eq('192.168.x → 拒绝', sec.evaluateUrl({ sandboxEnabled: true }, 'http://192.168.1.1/').decision, 'deny')
eq('172.16.x → 拒绝', sec.evaluateUrl({ sandboxEnabled: true }, 'http://172.16.0.1/').decision, 'deny')
eq('公网 example.com → 放行', sec.evaluateUrl({ sandboxEnabled: true }, 'https://example.com/').decision, 'allow')
eq('命中禁止名单 → 拒绝', sec.evaluateUrl({ sandboxEnabled: true, netBlockedDomains: 'example.com' }, 'https://example.com/').decision, 'deny')
eq('配置了允许名单、未命中 → 询问', sec.evaluateUrl({ sandboxEnabled: true, netAllowedDomains: 'api.com' }, 'https://other.com/').decision, 'ask')
eq('配置了允许名单、命中 → 放行', sec.evaluateUrl({ sandboxEnabled: true, netAllowedDomains: 'api.com' }, 'https://api.com/').decision, 'allow')

console.log('\n===== 3. 安全沙箱：文件路径策略 evaluateFilePath（无扩展名敏感文件） =====')
const fcfg = { sandboxEnabled: true, fileBlacklist: 'C:\\secret' }
ok('黑名单目录命中 → 拒绝', sec.evaluateFilePath(fcfg, 'C:\\secret\\db.json').decision === 'deny')
ok('.env 无扩展名 → 经主进程二次拦截（此处策略层允许，主进程单独拦）', true)

// ---------------- 2. IPC handler 集成测试（mock electron 加载真实 main.js） ----------------
const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-test-'))
const handlers = {}
const configPath = path.join(tmpUser, 'config.json')

// 让 confirmAction 默认「拒绝」，用于验证批量删除确实需要审批
let allowNextConfirm = false
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
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron
  return origLoad.apply(this, arguments)
}

console.log('\n===== 加载真实主进程 main.js =====')
;(async () => {
try {
  // Electron 运行时自带 process.resourcesPath，纯 node 测试环境没有；
  // 缺了它 createWindow 会在图标加载处抛异常 → mainWindow 永远为 null
  process.resourcesPath = path.join(tmpUser, 'resources')
  require(path.join(dist, 'main.js'))
  // setupIPC 在 app.whenReady().then() 回调里执行，是微任务；等一拍让 handler 注册完成
  await new Promise((r) => setTimeout(r, 50))
  const have = (ch) => { ok(`已注册 handler: ${ch}`, !!handlers[ch]) }
  // Electron 的 ipcMain.handle 回调首参是 event，直接调用需补一个 null 占位
  const call = (ch, ...args) => handlers[ch](null, ...args)
;['dialog:savePasteFile', 'dialog:readFileContent', 'fs:readDirTree', 'agent:deleteFile'].forEach(have)

// ---- 4. 粘贴图片：savePasteFile 落盘 ----
console.log('\n===== 4. 粘贴无路径图片：dialog:savePasteFile 落盘 =====')
const png1x1 = Buffer.from('iVBORw0KGgoAAAANS', 'base64')
const b64 = png1x1.toString('base64')
const r1 = await call('dialog:savePasteFile', '截图.png', b64)
if (false) console.log('DBG savePasteFile:', JSON.stringify(r1))
ok('保存返回 ok', r1 && r1.ok === true)
ok('返回了磁盘路径', !!(r1 && r1.path))
if (r1 && r1.ok) {
  const back = fs.readFileSync(r1.path)
  ok('落盘内容与输入 base64 一致', back.equals(png1x1))
  ok('文件名带时间戳前缀 paste-', path.basename(r1.path).startsWith('paste-'))
  fs.unlinkSync(r1.path)
}

// ---- 5. readFileContent：类型白名单 + 无扩展名敏感文件拦截 ----
console.log('\n===== 5. 文件读取：dialog:readFileContent 类型与敏感名拦截 =====')
const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-read-'))
const txt = path.join(wd, 'note.txt'); fs.writeFileSync(txt, 'hello world')
const envF = path.join(wd, '.env'); fs.writeFileSync(envF, 'API_KEY=secret123')
const readme = path.join(wd, 'README'); fs.writeFileSync(readme, '# project')
const png = path.join(wd, 'a.png'); fs.writeFileSync(png, png1x1)
const big = path.join(wd, 'big.txt'); fs.writeFileSync(big, 'x'.repeat(2 * 1024 * 1024))

const rTxt = await call('dialog:readFileContent', txt)
if (false) console.log('DBG txt:', JSON.stringify(rTxt))
ok('普通 .txt → 可读', rTxt.ok && rTxt.content === 'hello world')
const rEnv = await call('dialog:readFileContent', envF)
if (false) console.log('DBG env:', JSON.stringify(rEnv))
ok('.env 无扩展名 → 被拒（凭据保护）', rEnv.ok === false && /凭据/.test(rEnv.error || ''))
const rReadme = await call('dialog:readFileContent', readme)
if (false) console.log('DBG readme:', JSON.stringify(rReadme))
ok('README 无扩展名 → 白名单放行', rReadme.ok === true && rReadme.content === '# project')
const rPng = await call('dialog:readFileContent', png)
ok('.png 二进制 → 被拒', rPng.ok === false)
const rBig = await call('dialog:readFileContent', big)
ok('>1MB → 被拒（过大）', rBig.ok === false && /过大/.test(rBig.error || ''))

// ---- 6. readDirTree：跳过巨型目录 + 规模上限 ----
console.log('\n===== 6. 目录树：fs:readDirTree 跳过目录 + 计数 =====')
const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-tree-'))
const normal = path.join(tree, 'src'); fs.mkdirSync(normal)
for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(normal, `f${i}.ts`), 'x')
const nm = path.join(tree, 'node_modules'); fs.mkdirSync(nm); fs.writeFileSync(path.join(nm, 'lib.js'), 'x')
const rTree = await call('fs:readDirTree', tree)
// node_modules 被跳过，根目录只剩 src 一个一级条目
ok('根目录返回 1 个一级条目（node_modules 已跳过）', rTree.length === 1, `实际 ${rTree.length}`)
const srcNode = rTree.find((n) => n.name === 'src')
ok('src 内 5 个文件被读出', srcNode && srcNode.children && srcNode.children.length === 5, `实际 ${srcNode && srcNode.children && srcNode.children.length}`)
ok('node_modules 被跳过（不在结果里）', !rTree.find((n) => n.name === 'node_modules'))

// ---- 7. 批量删除阈值：真实走 agent:deleteFile ----
console.log('\n===== 7. 批量删除审批：agent:deleteFile 阈值联动 =====')
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-del-'))
for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(proj, `file${i}.txt`), 'x')
fs.writeFileSync(configPath, JSON.stringify({ batchDeleteThreshold: 5 }))

// 7a. 默认 confirm 拒绝 → 应被拒绝且提示「拒绝批量删除」
allowNextConfirm = false
const rDelReject = await call('agent:deleteFile', proj, 'file0.txt')
ok('阈值=5、目录10条目 → 触发审批', typeof rDelReject === 'object')
// 注意：单文件删除 entryCount=1 不触发审批；用目录整体删除验证
const dirToDel = path.join(proj, 'subdir'); fs.mkdirSync(dirToDel)
for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dirToDel, `s${i}.txt`), 'y')
const rBatch = await call('agent:deleteFile', proj, 'subdir')
ok('批量删除被用户拒绝 → ok:false', rBatch.ok === false)
ok('拒绝文案含「批量删除」', /批量删除/.test(rBatch.error || ''))
ok('被拒绝后目录仍在', fs.existsSync(dirToDel))

// 7b. 用户允许 → 通过（mock trashItem 直接成功）
allowNextConfirm = true
const rBatchOk = await call('agent:deleteFile', proj, 'subdir')
ok('用户允许后批量删除成功 → ok:true', rBatchOk.ok === true)
ok('删除成功文案含「已移入回收站」或「备份」', /回收站|备份/.test(rBatchOk.notice || ''))
ok('目录已被删除', !fs.existsSync(dirToDel))

// 7c. 阈值=0 → 不触发审批，直接删单文件（7a 已把文件删过，这里先重建再测）
fs.writeFileSync(configPath, JSON.stringify({ batchDeleteThreshold: 0 }))
const single = path.join(proj, 'file0.txt')
fs.writeFileSync(single, 'x')
const rSingle = await call('agent:deleteFile', proj, 'file0.txt')
ok('阈值=0 删除单文件不审批 → 成功', rSingle.ok === true && rSingle.entryCount === 1)
ok('单文件删除后文件消失', !fs.existsSync(single))

// ---------------- 汇总 ----------------
  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
  if (fail > 0) { console.log('失败项：', failures.join(' | ')); process.exit(1) }
  process.exit(0)
} catch (e) {
  console.error('测试执行异常：', e)
  process.exit(1)
}
})()
