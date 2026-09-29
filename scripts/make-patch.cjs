/**
 * 生成免安装版更新补丁：把「会变的那个核心」resources/app/（dist + dist-electron + package.json）
 * 压成补丁 zip，并产出 version.json（供应用检测/下载）。
 *
 * 用法：node scripts/make-patch.cjs [--out 输出目录] [--appdir 待打包的 resources/app 路径]
 * 默认：从 成品/deepwork-<最新>/resources/app 取源，输出到 成品/更新源/（与打包脚本同风格）。
 *
 * 说明：补丁只含 app 核心（约 3.6MB / 压缩 ~1MB），远小于文汇百川 20MB 上限，可托管为国内更新源。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const archiver = require('archiver')

const root = path.join(__dirname, '..', '..') // D:\程序\项目\many agent
const chengpin = path.join(root, '成品')

function parseArgs(argv) {
  const o = { out: null, appdir: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i]
    else if (argv[i] === '--appdir') o.appdir = argv[++i]
  }
  return o
}

function findLatestPortable() {
  // 只匹配纯版本号的便携目录（deepwork-X.Y.Z），排除 deepwork-Setup-*.exe 等安装包
  const dirs = fs.readdirSync(chengpin).filter((d) => /^deepwork-\d+\.\d+\.\d+$/.test(d))
  // 取版本号最大的目录
  const ver = (d) => (d.match(/(\d+\.\d+\.\d+)/) || ['0'])[0]
  dirs.sort((a, b) => {
    const pa = ver(a).split('.').map(Number)
    const pb = ver(b).split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
    }
    return 0
  })
  return path.join(chengpin, dirs[dirs.length - 1])
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

function zipDir(srcDir, outZip) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outZip)
    const archive = archiver('zip', { zlib: { level: 9 } })
    out.on('close', () => resolve(archive.pointer()))
    archive.on('error', reject)
    archive.pipe(out)
    // 打包整个 resources/app（与磁盘完全一致，最稳妥）：dist + dist-electron + package.json + node_modules（运行时不加载，但完整包含避免将来增删依赖漏更新）
    archive.directory(srcDir, false)
    archive.finalize()
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const version = pkg.version
  if (!version) throw new Error('package.json 缺少 version')

  // 源 app 目录
  let appDir = args.appdir
  if (!appDir) {
    const portable = findLatestPortable()
    appDir = path.join(portable, 'resources', 'app')
  }
  if (!fs.existsSync(appDir)) throw new Error('找不到 resources/app：' + appDir)
  console.log('源目录:', appDir)

  // 输出目录
  const outDir = args.out ? path.resolve(args.out) : path.join(chengpin, '更新源')
  fs.mkdirSync(outDir, { recursive: true })

  const zipName = `deepwork-patch-${version}.zip`
  const zipPath = path.join(outDir, zipName)
  const size = await zipDir(appDir, zipPath)
  const sha = sha256File(zipPath)
  console.log(`补丁: ${zipName} (${(size / 1024 / 1024).toFixed(2)} MB, sha256 ${sha.slice(0, 16)}…)`)

  // 文汇百川 file2url 仅允许 png/jpg/webp/json/txt/md/xml/gif/html，不接受 .zip（会嗅探 zip 魔术字节拒绝）。
  // 解决：把补丁 zip 做 base64 编码，封装成 .json 上传（json 在白名单内）；应用端解码回字节再解压。
  const patchJsonName = `deepwork-patch-${version}.json`
  const b64 = fs.readFileSync(zipPath).toString('base64')
  fs.writeFileSync(path.join(outDir, patchJsonName), JSON.stringify({ b64 }))
  console.log(`补丁(json/base64): ${patchJsonName} (${(b64.length / 1024 / 1024).toFixed(2)} MB)`)

  const versionJson = {
    version,
    patch: patchJsonName,
    sha256: sha,
    size,
    pubDate: new Date().toISOString().slice(0, 10),
    notes: `deepwork v${version} 更新补丁`,
  }
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(versionJson, null, 2))
  console.log('version.json 已写入:', path.join(outDir, 'version.json'))
  console.log('更新源目录:', outDir)
  console.log('\n下一步：把本目录下 version.json + 补丁 zip 托管到更新源（文汇百川网站库 / GitHub / 任意静态托管），')
  console.log('并设置环境变量 DEEPWORK_UPDATE_URL 指向该目录的公开 URL。')
}

main().catch((e) => {
  console.error('生成补丁失败:', e.message)
  process.exit(1)
})
