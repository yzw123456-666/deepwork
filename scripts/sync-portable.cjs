/**
 * 同步免安装版：把 代码/dist + dist-electron + package.json 推到 成品/ 下所有 deepwork-* 目录。
 *
 * ⚠️ 本机铁律（2026-09-21 实测）：fs.cpSync 源路径含中文时【段错误】直接崩进程
 *    （ASCII 源正常，copyFileSync 不受影响）。本项目所有路径含中文，禁止使用 cpSync，
 *    必须走下面的 manualCopy（readdir + mkdir + copyFileSync 逐文件）。
 *
 * 背景：曾因「只更新新建目录、用户在用的旧目录没同步」导致多轮修复对用户无效。
 * 此脚本把「同步所有副本 + 哈希校验」变成机械动作。
 *
 * 用法：node scripts/sync-portable.cjs
 * 前提：npm run build && tsc -p electron/tsconfig.json 已执行。
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const crypto = require('crypto')

const root = path.join(__dirname, '..', '..')          // D:\程序\项目\many agent
const srcApp = path.join(root, '代码')                  // 源码工程（中文路径！）
const chengpin = path.join(root, '成品')

function md5(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
}

/** 安全递归拷贝：禁用 cpSync（中文路径段错误），逐文件 copyFileSync。
 *  注意：Dirent 的 name 是【属性】不是方法（entry.name 而非 entry.name()）。 */
function manualCopy(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) manualCopy(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
    // 符号链接等特殊条目：本项目产物中不存在，遇到则跳过并提示
    else console.log('  （跳过特殊条目 ' + entry.name + '）')
  }
}

// 1. 找到所有免安装目录
const targets = fs.readdirSync(chengpin)
  .filter(n => /^deepwork-/.test(n) && !n.includes('Setup'))
  .map(n => path.join(chengpin, n, 'resources', 'app'))
  .filter(p => fs.existsSync(p))

if (targets.length === 0) {
  console.error('✗ 成品/ 下没有找到任何 deepwork-*/resources/app 目录')
  process.exit(1)
}
console.log('发现 ' + targets.length + ' 个免安装目录')

// 2. 源产物完整性检查
const mustExist = [
  path.join(srcApp, 'dist', 'index.html'),
  path.join(srcApp, 'dist-electron', 'main.js'),
  path.join(srcApp, 'dist-electron', 'preload.js'),
  path.join(srcApp, 'package.json'),
]
for (const f of mustExist) {
  if (!fs.existsSync(f)) {
    console.error('✗ 源产物缺失: ' + f + '\n  请先执行 npm run build 和 tsc -p electron/tsconfig.json')
    process.exit(1)
  }
}

// 3. 逐个同步：先删旧目录（防旧 chunk 残留），再逐文件拷贝
for (const app of targets) {
  const rel = path.relative(chengpin, path.dirname(path.dirname(app)))
  for (const dir of ['dist', 'dist-electron']) {
    fs.rmSync(path.join(app, dir), { recursive: true, force: true })
    manualCopy(path.join(srcApp, dir), path.join(app, dir))
  }
  fs.copyFileSync(path.join(srcApp, 'package.json'), path.join(app, 'package.json'))
  // 窗口/任务栏图标：main.ts 从 process.resourcesPath/icon.png 读取，即 <免安装目录>/resources/icon.png
  const srcIcon = path.join(srcApp, 'resources', 'icon.png')
  if (fs.existsSync(srcIcon)) {
    fs.copyFileSync(srcIcon, path.join(app, '..', 'icon.png'))
  }
  // 更新器 / 卸载器：随 app 分发到免安装目录根（update.exe 与 deepwork.exe 同级）
  const updaterDist = path.join(srcApp, 'tools', 'updater', 'dist')
  const updaterSrc = path.join(srcApp, 'tools', 'updater')
  const rootDir = path.dirname(path.dirname(app)) // .../deepwork-XX
  const extraFiles = [
    [path.join(updaterDist, 'update.exe'), 'update.exe'],
    [path.join(updaterDist, 'uninstall.exe'), 'uninstall.exe'],
    [path.join(updaterSrc, 'sources.json'), 'sources.json'],
  ]
  for (const [src, name] of extraFiles) {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(rootDir, name))
    else console.log('  （未找到 ' + name + '，跳过：请先 python tools/updater/build.py）')
  }
  console.log('✓ 已同步 ' + rel)
}

// 4. 校验：所有目录的产物必须和源码产物逐字节一致
const checkFiles = []
for (const f of fs.readdirSync(path.join(srcApp, 'dist', 'assets'))) {
  checkFiles.push(path.join('dist', 'assets', f))
}
checkFiles.push(path.join('dist', 'index.html'), path.join('dist-electron', 'main.js'), path.join('dist-electron', 'preload.js'))

let bad = 0
for (const app of targets) {
  const rel = path.relative(chengpin, path.dirname(path.dirname(app)))
  for (const f of checkFiles) {
    const a = md5(path.join(srcApp, f))
    const b = md5(path.join(app, f))
    if (a !== b) {
      console.error(`✗ ${rel}/${f} 哈希不一致 (${a} vs ${b})`)
      bad++
    }
  }
  const ver = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version
  console.log(`  ${rel} → v${ver}，${bad === 0 ? '校验一致' : '有 ' + bad + ' 处不一致'}`)
}

// 5. 提醒：app 在运行则看不到更新
try {
  const out = execSync('tasklist /FI "IMAGENAME eq deepwork.exe" /NH', { encoding: 'utf8' })
  if (/deepwork\.exe/i.test(out)) {
    console.log('\n⚠ deepwork 正在运行：更新已写入磁盘，需【完全退出并重新启动】才生效。')
  }
} catch { /* tasklist 不可用时静默跳过 */ }

if (bad > 0) process.exit(1)
console.log('\n全部免安装目录已同步并校验通过。')
