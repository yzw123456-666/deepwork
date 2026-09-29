/**
 * 生成「完整 app 文件夹」更新包并发布到多线路更新源。
 *
 * 产物：
 *   - 成品/更新源/deepwork-portable-<version>.zip   （完整 app 文件夹压缩包，含 update.exe/uninstall.exe）
 *   - 成品/更新源/version.json                       （版本清单，含 asset 下载地址 + sha256）
 *
 * 发布目标（按可用凭证自动选择）：
 *   - GitHub Releases：上传 zip + version.json（.zip 支持良好，作为主下载源）
 *   - 文汇百川：上传 version.json（其 asset 指向 GitHub 下载地址；file2url 不支持大 .zip）
 *   - Gitee / GitCode / 我的服务器：在 update.exe 的 sources.json 中已预置，待对应仓库/服务器就绪后启用
 *
 * 排除项：宣传（推广视频，非运行所需，约 300MB）、所有 .map 源映射文件、node_modules。
 *
 * 用法：
 *   node scripts/make-release-asset.cjs "更新说明"
 *   （GitHub token 从用户环境变量 GITHUB_TOKEN 读取，已 setx 持久化；文汇百川凭证用 FINALOS_OSID / FINALOS_TOKEN）
 * 安全：token 不落 git config / remote URL / 任何文件，只存在于本机用户环境变量
 */
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..', '..')
const CODE = path.join(ROOT, '代码')
const SRC = path.join(ROOT, '成品', 'deepwork-26.9.23') // 待打包的 app 文件夹
const OUT_DIR = path.join(ROOT, '成品', '更新源')
const PKG = require(path.join(CODE, 'package.json'))
const VERSION = PKG.version
const ASSET_NAME = `deepwork-portable-${VERSION}.zip`
const ZIP = path.join(OUT_DIR, ASSET_NAME)

const IGNORE = ['宣传', '宣传/**', '**/*.map', 'node_modules', 'node_modules/**', '**/*.pdb', '.git', '.git/**']

function zipFolder() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const out = fs.createWriteStream(ZIP)
    const a = archiver('zip', { zlib: { level: 9 } })
    a.pipe(out)
    a.glob('**/*', { cwd: SRC, dot: true, ignore: IGNORE })
    out.on('close', () => resolve())
    a.on('error', reject)
    a.finalize()
  })
}

function sha256File(p) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(p))
  return h.digest('hex')
}

function ghToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  console.log('提示: 未检测到 GITHUB_TOKEN 环境变量（setx GITHUB_TOKEN <token> 设置一次即可）')
  return null
}

async function githubPublish(zipPath, version, notes) {
  const token = ghToken()
  if (!token) { console.log('[skip] 无 GitHub token，跳过 GitHub 发布'); return null }
  const repo = 'yzw123456-666/deepwork'
  const auth = { Authorization: `Bearer ${token}`, 'User-Agent': 'deepwork-release', Accept: 'application/vnd.github+json' }
  const relRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: `v${version}`, name: `v${version}`, body: notes || '', draft: false, prerelease: false }),
  })
  let rel = await relRes.json()
  // release 已存在（重复发布）：改为获取现有 release
  if (!rel.id && relRes.status === 422) {
    const ex = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { headers: auth }).then(r => r.json())
    rel = ex?.id ? ex : rel
  }
  if (!rel.id) throw new Error('创建 release 失败: ' + JSON.stringify(rel).slice(0, 300))
  const uploadAsset = async (name, body, contentType) => {
    // 同名 asset 先删后传（重复发布覆盖）
    for (const a of rel.assets || []) {
      if (a.name === name) await fetch(`https://api.github.com/repos/${repo}/releases/assets/${a.id}`, { method: 'DELETE', headers: auth })
    }
    const up = await fetch(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': contentType }, body,
    }).then(r => r.json())
    if (!up.browser_download_url) throw new Error(`上传 asset ${name} 失败: ` + JSON.stringify(up).slice(0, 300))
    return up.browser_download_url
  }
  const ghUrl = await uploadAsset(path.basename(zipPath), fs.readFileSync(zipPath), 'application/zip')
  return { ghUrl, uploadAsset }
}

// 文汇百川通用上传（file2url 只认扩展名白名单，大 zip 需改名 .json；内容字节原样，sha256 由更新器校验）
async function finalosUpload(filePath, remoteName, token, osid) {
  const API = 'https://api.publicos.cn/api/web'
  const buf = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('token', token)
  form.append('file', new Blob([buf]), remoteName)
  form.append('filename', remoteName)
  form.append('path', 'deepwork-update')
  const res = await fetch(`${API}/file2url?osid=${encodeURIComponent(osid)}`, { method: 'POST', body: form })
  const j = await res.json()
  if (j.code !== 0) throw new Error(`文汇百川上传 ${remoteName} 失败: ` + JSON.stringify(j).slice(0, 300))
  return j.url
}

async function main() {
  const notes = process.argv.slice(2).join(' ') || `自动发布 v${VERSION}`
  if (!fs.existsSync(SRC)) throw new Error('找不到 app 文件夹: ' + SRC)

  console.log('打包 app 文件夹 →', ASSET_NAME)
  await zipFolder()
  const size = fs.statSync(ZIP).size
  const sha = sha256File(ZIP)
  console.log(`  大小 ${(size / 1024 / 1024).toFixed(1)} MB，sha256 ${sha.slice(0, 16)}…`)

  const vj = { version: VERSION, notes, pubDate: new Date().toISOString().slice(0, 10), size, sha256: sha, asset: '' }
  const vjPath = path.join(OUT_DIR, 'version.json')
  fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2))

  const gh = await githubPublish(ZIP, VERSION, notes)
  if (gh?.ghUrl) {
    vj.asset = gh.ghUrl
    // 国内下载兜底：GitHub 加速镜像（zip 大文件无法进文汇百川，file2url 上限 2MB）
    vj.mirrors = [`https://ghfast.top/${gh.ghUrl}`]
    fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2))
    console.log('  GitHub 下载地址:', gh.ghUrl)
    console.log('  国内镜像:', vj.mirrors[0])
    // version.json（asset=GitHub 直链 + mirrors）+ plugins.json（插件市场兜底源跟随 latest release）
    await gh.uploadAsset('version.json', fs.readFileSync(vjPath), 'application/json')
    const pluginsCatalog = path.join(OUT_DIR, 'plugins.json')
    if (fs.existsSync(pluginsCatalog)) await gh.uploadAsset('plugins.json', fs.readFileSync(pluginsCatalog), 'application/json')
    // NSIS 安装包（electron-builder 产物）：随 release 一起分发，供全新安装场景下载
    const setupExe = path.join('C:/manyai-build/release', `deepwork-Setup-${VERSION}.exe`)
    if (fs.existsSync(setupExe)) {
      const setupUrl = await gh.uploadAsset(path.basename(setupExe), fs.readFileSync(setupExe), 'application/x-msdownload')
      console.log('  Installer:', setupUrl)
    } else {
      console.log('  [warn] 未找到安装包', setupExe, '— 请先运行 electron-builder 打包 nsis')
    }
  }

  // 文汇百川：只传 version.json（file2url 上限 2MB，zip 放不下；asset 沿用 GitHub 直链+镜像，
  // update.exe 探测到文汇百川最快时仍从 GitHub/镜像下载，sha256 校验保真）
  const token = process.env.FINALOS_TOKEN
  const osid = process.env.FINALOS_OSID
  if (token && osid) {
    const u = await finalosUpload(vjPath, 'version.json', token, osid)
    console.log('  文汇百川 version.json:', u)
  }

  console.log('\n✅ 发布完成')
  console.log('  本地包:', ZIP)
  console.log('  version.json:', vjPath)
  console.log('  asset:', vj.asset || '(未设置 — 需先发布到含 .zip 的源)')
}

main().catch((e) => { console.error('发布失败:', e.message); process.exit(1) })
