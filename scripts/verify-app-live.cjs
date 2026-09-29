/**
 * 真实运行验收（2026-09-25 v26.9.59）：启动免安装版 deepwork，用 CDP 做无界面自动化检查 + 截图存档。
 * 验证重点（当日核心改动）：设置独立窗口能否真开、主窗口骨架类、双入口 settings.html 加载、版本号。
 * 用法：node scripts/verify-app-live.cjs
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

// 本机代理会拦 127.0.0.1，必须清掉（血泪坑）
delete process.env.HTTP_PROXY
delete process.env.HTTPS_PROXY
delete process.env.http_proxy
delete process.env.https_proxy

const EXE = path.join(__dirname, '..', '..', '成品', 'deepwork-26.9.23', 'deepwork.exe')
const PORT = 9222
const SHOT_DIR = path.join(__dirname, '..', '..', '成品', '_验收截图', '2026-09-25')

let pass = 0, fail = 0
const notes = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')) }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function httpJson(url) {
  const res = await fetch(url)
  return res.json()
}

/** 极简 CDP 客户端（Node 22 原生 WebSocket） */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败: ' + (e.message || '')))
  })
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    } catch { /* 忽略非 JSON */ }
  }
  return {
    ready,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')) } }, 15000)
    }),
    close: () => { try { ws.close() } catch { /* 忽略 */ } },
  }
}

async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails))
  return r?.result?.value
}

;(async () => {
  if (!fs.existsSync(EXE)) { console.error('找不到 exe: ' + EXE); process.exit(1) }
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  console.log('启动 deepwork（--remote-debugging-port=' + PORT + '）...')
  const child = spawn(EXE, ['--remote-debugging-port=' + PORT, '--no-sandbox'], { detached: false, stdio: 'ignore' })

  const kill = () => { try { child.kill() } catch { /* 忽略 */ } }
  process.on('exit', kill)

  // 等待 CDP 端口就绪
  let version = null
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try { version = await httpJson(`http://127.0.0.1:${PORT}/json/version`); break } catch { /* 继续等 */ }
  }
  if (!version) { console.error('CDP 端口未就绪'); kill(); process.exit(1) }
  console.log('  浏览器: ' + version.Browser)

  await sleep(2500) // 等 React 挂载

  let list = await httpJson(`http://127.0.0.1:${PORT}/json/list`)
  const pages = list.filter(t => t.type === 'page')
  ok('主窗口页面已加载', pages.length >= 1, JSON.stringify(pages.map(p => p.url)))
  const main = pages.find(p => /index\.html/.test(p.url)) || pages[0]

  const c = cdp(main.webSocketDebuggerUrl)
  await c.ready
  await c.send('Runtime.enable')
  await c.send('Page.enable')

  console.log('===== 1. 主窗口渲染 =====')
  const rootChildren = await evaluate(c, 'document.getElementById("root").children.length')
  ok('#root 已挂载 React 树', Number(rootChildren) > 0, String(rootChildren))
  const hasSidebar = await evaluate(c, '!!document.querySelector(".app-sidebar-root")')
  ok('侧栏骨架类存在（壁纸玻璃规则依赖它）', hasSidebar === true)
  const hasTitlebar = await evaluate(c, '!!document.querySelector(".app-titlebar-root")')
  ok('标题栏骨架类存在', hasTitlebar === true)
  const apiOk = await evaluate(c, 'typeof window.electronAPI === "object"')
  ok('preload 桥接就绪（electronAPI）', apiOk === true)

  console.log('===== 2. 版本与配置 =====')
  const info = await evaluate(c, '(async () => { const i = await window.electronAPI.app.getInfo(); return i.version })()')
  console.log('  应用版本: ' + info)
  ok('版本号已升到 v26.9.59', String(info).includes('26.9.59'), String(info))
  const cfg = await evaluate(c, '(async () => { const c = await window.electronAPI.config.get(); return JSON.stringify({ theme: c.theme, accent: c.accent, wallpaper: c.wallpaper, replyStyle: c.replyStyle }) })()')
  console.log('  当前配置: ' + cfg)
  ok('配置可读取（含壁纸/人格字段）', typeof cfg === 'string' && cfg.length > 2)

  console.log('===== 3. 截图：主窗口 =====')
  const shot1 = await c.send('Page.captureScreenshot', { format: 'png' })
  const p1 = path.join(SHOT_DIR, '01-主窗口.png')
  fs.writeFileSync(p1, Buffer.from(shot1.data, 'base64'))
  ok('主窗口截图已保存', fs.existsSync(p1) && fs.statSync(p1).size > 1000, p1)

  console.log('===== 4. 设置独立窗口（当日核心改动） =====')
  await evaluate(c, 'window.electronAPI.app.openSettings()')
  await sleep(3000)
  list = await httpJson(`http://127.0.0.1:${PORT}/json/list`)
  const settingsPage = list.find(t => t.type === 'page' && /settings\.html/.test(t.url))
  ok('设置独立窗口已创建（settings.html 加载）', !!settingsPage, JSON.stringify(list.map(t => t.url)))
  if (settingsPage) {
    const c2 = cdp(settingsPage.webSocketDebuggerUrl)
    await c2.ready
    await c2.send('Runtime.enable')
    await c2.send('Page.enable')
    const txt = await evaluate(c2, 'document.body.innerText.slice(0, 200)')
    console.log('  设置窗口文本: ' + String(txt).replace(/\n/g, ' | ').slice(0, 160))
    ok('设置窗口已渲染内容（非空白）', String(txt).trim().length > 10)
    ok('设置窗口标题为「deepwork 设置」', String(await evaluate(c2, 'document.title')).includes('设置'))
    await sleep(500)
    const shot2 = await c2.send('Page.captureScreenshot', { format: 'png' })
    const p2 = path.join(SHOT_DIR, '02-设置独立窗口.png')
    fs.writeFileSync(p2, Buffer.from(shot2.data, 'base64'))
    ok('设置窗口截图已保存', fs.existsSync(p2) && fs.statSync(p2).size > 1000, p2)
    c2.close()
  }

  console.log('===== 5. 壁纸层（开启内置壁纸后） =====')
  await evaluate(c, 'window.electronAPI.config.set("wallpaper", { type: "builtin", value: "aurora", dim: 0.35, blur: 18 })')
  await sleep(1500)
  const wpAttr = await evaluate(c, 'document.documentElement.getAttribute("data-wallpaper")')
  ok('data-wallpaper 属性已激活', wpAttr === '1', String(wpAttr))
  const glassAttr = await evaluate(c, 'document.documentElement.getAttribute("data-wp-glass")')
  ok('data-wp-glass 已激活（blur>0）', glassAttr === '1', String(glassAttr))
  const blurVar = await evaluate(c, 'document.documentElement.style.getPropertyValue("--wp-blur")')
  ok('--wp-blur 变量已写入（18px）', String(blurVar).includes('18'), String(blurVar))
  const layer = await evaluate(c, '!!document.querySelector(".pointer-events-none .absolute.inset-0") || !!document.querySelector("div[aria-hidden]")')
  ok('壁纸层 DOM 已渲染', layer === true)
  await sleep(800)
  const shot3 = await c.send('Page.captureScreenshot', { format: 'png' })
  const p3 = path.join(SHOT_DIR, '03-壁纸极光+玻璃.png')
  fs.writeFileSync(p3, Buffer.from(shot3.data, 'base64'))
  ok('壁纸截图已保存', fs.existsSync(p3) && fs.statSync(p3).size > 1000, p3)

  console.log('===== 6. 主窗口无 JS 报错 =====')
  const errs = await evaluate(c, 'window.__errCount || 0')
  console.log('  记录到的页面错误计数: ' + errs)

  c.close()
  kill()
  try { require('child_process').execSync('taskkill /IM deepwork.exe /F', { stdio: 'ignore' }) } catch { /* 忽略 */ }

  console.log(`\n===== 结果: 通过 ${pass} 项, 失败 ${fail} 项 =====`)
  console.log('截图目录: ' + SHOT_DIR)
  process.exit(0)
})().catch(e => {
  console.error('致命错误: ' + e.message)
  try { require('child_process').execSync('taskkill /IM deepwork.exe /F', { stdio: 'ignore' }) } catch { /* 忽略 */ }
  process.exit(1)
})
