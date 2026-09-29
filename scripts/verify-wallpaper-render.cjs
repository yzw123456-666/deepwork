/**
 * 壁纸层渲染验证（2026-09-25 v26.9.59）：jsdom 真实渲染 WallpaperLayer 的全部类型，
 * 验证 DOM 输出（file:// URL / 静音循环视频 / iframe / 内置动态壁纸 / 暗化遮罩）。
 * 用法：node scripts/verify-wallpaper-render.cjs
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))
const { JSDOM } = require('C:/Users/ytzsy/.workbuddy/binaries/node/workspace/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
const React = require(path.join(__dirname, '..', 'node_modules', 'react'))
const ReactDOM = require(path.join(__dirname, '..', 'node_modules', 'react-dom/client'))
const lucide = require(path.join(__dirname, '..', 'node_modules', 'lucide-react'))

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')) }
}

const root = path.join(__dirname, '..')
// 真实纯函数：toFileUrl / findBuiltinWallpaper（无外部依赖，转译即 require）
const fileJs = ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'services', 'wallpaperFile.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const tmpFile = path.join(root, '.temp-wf.cjs')
fs.writeFileSync(tmpFile, fileJs)
const { toFileUrl } = require(tmpFile)
const builtinJs = ts.transpileModule(fs.readFileSync(path.join(root, 'src', 'services', 'builtinWallpapers.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText
const tmpBuiltin = path.join(root, '.temp-wb.cjs')
fs.writeFileSync(tmpBuiltin, builtinJs)
const { findBuiltinWallpaper, BUILTIN_WALLPAPERS } = require(tmpBuiltin)

// 抽取 WallpaperLayer 组件源码（与其他 verify 脚本同款：从 const 截到下一段声明前）
const layerSrc = fs.readFileSync(path.join(root, 'src', 'components', 'WallpaperLayer.tsx'), 'utf8')
const start = layerSrc.indexOf('const WallpaperLayer')
const rest = layerSrc.slice(start + 6)
const mEnd = rest.match(/\n\n(?:const |function |\/\*|\/\/)/)
// 去掉文件末尾的 export default（vm 里不需要，且会报 SyntaxError）
const componentSrc = layerSrc.slice(start, mEnd ? start + 6 + mEnd.index : layerSrc.length).replace(/export default[\s\S]*$/, '')

const code = `
const { useState, useMemo, useEffect, useRef } = React;
const { ChevronRight } = lucide;
const toFileUrl = __toFileUrl;
const findBuiltinWallpaper = __findBuiltin;
const useAppStore = (sel) => sel({ config: __cfg });
${componentSrc}
this.api = { WallpaperLayer };
`
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'React.createElement' } }).outputText

function renderWith(wallpaper) {
  const ctx = { React, lucide, console, __toFileUrl: toFileUrl, __findBuiltin: findBuiltinWallpaper, __cfg: { wallpaper }, window: dom.window, document: dom.window.document }
  vm.createContext(ctx)
  vm.runInContext(js, ctx)
  // JSDOM 实例没有 .document 属性，必须走 window
  const el = dom.window.document.getElementById('root')
  el.innerHTML = ''
  const r = ReactDOM.createRoot(el)
  r.render(React.createElement(ctx.api.WallpaperLayer))
  return new Promise(resolve => setTimeout(() => resolve({ html: el.innerHTML, text: el.textContent }), 120))
}

;(async () => {
  console.log('===== 1. 图片壁纸 =====')
  {
    const { html } = await renderWith({ type: 'image', value: 'D:\\wall\\a b.png', dim: 0.35, blur: 18 })
    ok('渲染 img 且走 file:// URL（含空格编码）', /<img[^>]+src="file:\/\/\/D:\/wall\/a%20b\.png"/.test(html), html.slice(0, 200))
    ok('object-cover 铺满', /object-cover/.test(html))
    ok('暗化遮罩层存在（opacity .35）', /opacity:\s*0?\.35/.test(html))
  }

  console.log('===== 2. 视频壁纸 =====')
  {
    const { html } = await renderWith({ type: 'video', value: 'D:\\wall\\bg.mp4', dim: 0.2, blur: 20 })
    ok('渲染 video 且 file:// URL', /<video[^>]+src="file:\/\/\/D:\/wall\/bg\.mp4"/.test(html))
    // 注意：React 的 muted 走 DOM property（不出现在 innerHTML），必须查 property 而非字符串
    const v = dom.window.document.querySelector('video')
    ok('自动播放 + 循环（壁纸行为）', /autoplay/i.test(html) && /loop/i.test(html))
    ok('静音（React 走 property，查 DOM 对象）', !!v && v.muted === true)
  }

  console.log('===== 3. HTML 壁纸 =====')
  {
    const { html } = await renderWith({ type: 'html', value: 'D:\\wall\\p.html', dim: 0.3, blur: 10 })
    ok('渲染 iframe 指向本地 html', /<iframe[^>]+src="file:\/\/\/D:\/wall\/p\.html"/.test(html))
  }

  console.log('===== 4. 网址壁纸 =====')
  {
    const { html } = await renderWith({ type: 'url', value: 'https://example.com/live', dim: 0.4, blur: 12 })
    ok('渲染 iframe 指向网址', /<iframe[^>]+src="https:\/\/example\.com\/live"/.test(html))
  }

  console.log('===== 5. 内置动态壁纸（8 个逐个渲染） =====')
  {
    let allOk = true
    let emptyCount = 0
    for (const b of BUILTIN_WALLPAPERS) {
      const { html } = await renderWith({ type: 'builtin', value: b.id, dim: 0.35, blur: 18 })
      if (!html || html.length < 60) { emptyCount++; allOk = false; console.log('   空白: ' + b.id) }
    }
    ok('8 个内置壁纸全部渲染出 DOM', allOk && emptyCount === 0, `空白 ${emptyCount} 个`)
    const { html } = await renderWith({ type: 'builtin', value: 'aurora', dim: 0.35, blur: 18 })
    ok('极光壁纸含渐变与动画样式', /linear-gradient|radial-gradient/.test(html) && /animation/.test(html))
  }

  console.log('===== 6. 兜底分支 =====')
  {
    const r1 = await renderWith({ type: 'none', value: '' })
    ok('关闭壁纸 → 不渲染任何层', (r1.html || '').length === 0, r1.html)
    const r2 = await renderWith(undefined)
    ok('无配置 → 不渲染（不崩）', (r2.html || '').length === 0)
    const r3 = await renderWith({ type: 'builtin', value: '不存在的id', dim: 0.35, blur: 18 })
    ok('内置 id 无效 → 静默不渲染', (r3.html || '').length === 0)
  }

  console.log(`\n===== 结果: 通过 ${pass} 项, 失败 ${fail} 项 =====`)
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.error('致命错误: ' + e.stack); process.exit(1) })
