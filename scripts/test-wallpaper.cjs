/**
 * 壁纸功能回归（2026-09-25 v26.9.51）：
 * 1. toFileUrl 路径转换（Windows/UNC/POSIX/file:// 中文编码）
 * 2. 内置壁纸库完整性（8 个、id 唯一、字段齐全）
 * 3. 三端接线静态断言（main IPC / preload / d.ts）与 UI 接入（App/骨架类/设置面板/CSS）
 * 用法：node scripts/test-wallpaper.cjs
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))

const root = path.join(__dirname, '..')
let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')) }
}
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8')

console.log('===== 1. toFileUrl 路径转换 =====')
{
  const js = ts.transpileModule(read('src', 'services', 'wallpaperFile.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const tmp = path.join(root, '.temp-wallpaper-file.cjs')
  fs.writeFileSync(tmp, js)
  const { toFileUrl } = require(tmp)

  ok('Windows 盘符反斜杠', toFileUrl('D:\\a\\b.png') === 'file:///D:/a/b.png', toFileUrl('D:\\a\\b.png'))
  ok('Windows 盘符正斜杠', toFileUrl('D:/a/b.png') === 'file:///D:/a/b.png', toFileUrl('D:/a/b.png'))
  ok('POSIX 绝对路径', toFileUrl('/home/u/b.png') === 'file:///home/u/b.png', toFileUrl('/home/u/b.png'))
  ok('UNC 路径', toFileUrl('\\\\srv\\share\\b.png') === 'file://srv/share/b.png', toFileUrl('\\\\srv\\share\\b.png'))
  ok('已是 file:// 原样返回', toFileUrl('file:///x/y.png') === 'file:///x/y.png')
  ok('中文与空格编码', toFileUrl('D:\\壁 纸\\a.png').includes('%E5%A3%81'), toFileUrl('D:\\壁 纸\\a.png'))
  ok('空串安全', toFileUrl('') === '' && toFileUrl('   ') === '')
}

console.log('===== 2. 内置壁纸库 =====')
{
  const js = ts.transpileModule(read('src', 'services', 'builtinWallpapers.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText
  const tmp = path.join(root, '.temp-wallpaper-builtin.cjs')
  fs.writeFileSync(tmp, js)
  const { BUILTIN_WALLPAPERS, findBuiltinWallpaper } = require(tmp)

  ok('共 8 个内置壁纸', BUILTIN_WALLPAPERS.length === 8, String(BUILTIN_WALLPAPERS.length))
  ok('id 无重复', new Set(BUILTIN_WALLPAPERS.map(b => b.id)).size === 8)
  ok('每个都有 name/css/render', BUILTIN_WALLPAPERS.every(b => b.name && b.css && typeof b.render === 'function'))
  ok('findBuiltinWallpaper 命中与未命中', findBuiltinWallpaper('aurora')?.name === '极光流转' && findBuiltinWallpaper('nope') === undefined)
}

console.log('===== 3. 三端接线（IPC / preload / d.ts） =====')
{
  const main = read('electron', 'main.ts')
  const preload = read('electron', 'preload.ts')
  const dts = read('src', 'types', 'electron.d.ts')
  ok('main: wallpaper:chooseFile（含三类过滤器）', main.includes("wallpaper:chooseFile'") && main.includes("kind === 'video'") && main.includes("kind === 'html'"))
  ok('main: wallpaper:list / wallpaper:remove', main.includes("wallpaper:list'") && main.includes("wallpaper:remove'"))
  ok('main: 导入目录 userData/wallpapers', main.includes("'wallpapers'"))
  ok('main: remove 用 basename 防目录穿越', /wallpaper:remove[\s\S]{0,400}path\.basename/.test(main))
  ok('preload: 三个方法接线', preload.includes("wallpaper:chooseFile'") && preload.includes("wallpaper:list'") && preload.includes("wallpaper:remove'"))
  ok('d.ts: wallpaper 类型声明', dts.includes('chooseFile: (kind') && dts.includes('wallpaper:list') === false && dts.includes('remove: (name: string)'))
}

console.log('===== 4. 渲染层接入 =====')
{
  const app = read('src', 'App.tsx')
  const layer = read('src', 'components', 'WallpaperLayer.tsx')
  const titlebar = read('src', 'components', 'TitleBar.tsx')
  const sidebar = read('src', 'components', 'Sidebar.tsx')
  const chat = read('src', 'components', 'ChatArea.tsx')
  const css = read('src', 'index.css')
  const settings = read('src', 'components', 'SettingsPanel.tsx')
  const types = read('src', 'types', 'index.ts')

  ok('App: 引入并挂载 WallpaperLayer', app.includes("from './components/WallpaperLayer'") && app.includes('<WallpaperLayer />'))
  ok('App: data-wallpaper 属性 + --wp-blur 变量', app.includes("setAttribute('data-wallpaper', '1')") && app.includes("--wp-blur"))
  ok('App: 根容器 app-root-bg', app.includes('app-root-bg'))
  ok('骨架类: TitleBar/Sidebar/ChatArea', titlebar.includes('app-titlebar-root') && sidebar.includes('app-sidebar-root') && chat.includes('app-content-root'))
  ok('CSS: 壁纸激活规则与骨架透明', css.includes('html[data-wallpaper="1"] .app-root-bg') && css.includes('.app-sidebar-root'))
  ok('CSS: 全局玻璃三件套（titlebar/sidebar/content 同 blur 变量）', css.includes('[data-wp-glass="1"] .app-titlebar-root') && css.includes('[data-wp-glass="1"] .app-sidebar-root') && css.includes('[data-wp-glass="1"] .app-content-root') && (css.match(/var\(--wp-blur/g) || []).length >= 3)
  ok('CSS: blur=0 纯透明分支（无玻璃）', css.includes('html[data-wallpaper="1"] .app-titlebar-root,\nhtml[data-wallpaper="1"] .app-sidebar-root,\nhtml[data-wallpaper="1"] .app-content-root { background: transparent'))
  ok('App: data-wp-glass 状态（blur>0 开玻璃）', app.includes("setAttribute('data-wp-glass'"))
  ok('CSS: 六组动画 keyframes', ['wp-hue', 'wp-pulse', 'wp-drift', 'wp-drift2', 'wp-wave', 'wp-grid'].every(k => css.includes('@keyframes ' + k)))
  ok('Layer: 图片/视频/HTML/网址/内置五类渲染', ['builtin', 'image', 'video', 'html', 'url'].every(t => layer.includes(`type === '${t}'`)))
  ok('Layer: 视频自动静音循环播放', layer.includes('autoPlay loop muted playsInline'))
  ok('Layer: 加载失败兜底 + 暗化遮罩', layer.includes('壁纸文件加载失败') && layer.includes('bg-black'))
  ok('Settings: 壁纸卡片（内置网格/上传/网址/列表/滑条）', settings.includes('WallpaperCard') && settings.includes('BUILTIN_WALLPAPERS') && settings.includes('wallpaper.chooseFile') && settings.includes('wallpaper.remove'))
  ok('Settings: 内置 8 项渲染', /BUILTIN_WALLPAPERS\.map/.test(settings))
  ok('types: WallpaperConfig 与 AppConfig.wallpaper', types.includes('WallpaperConfig') && types.includes('wallpaper?: WallpaperConfig'))
}

console.log('\n===== 结果: 通过 ' + pass + ' 项, 失败 ' + fail + ' 项 =====')
process.exit(fail > 0 ? 1 : 0)
