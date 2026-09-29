/**
 * 更新机制本地端到端验证（无 GUI、无 Electron 运行时）。
 * 验证：archiver 生成的补丁 zip → 能被 electron/zip.ts 的 unzipBuffer 解压 → manualCopy 覆盖式替换生效。
 * 同时验证版本比对（已是最新版不报 hasUpdate）。
 *
 * 运行：node scripts/test-updater.cjs
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const archiver = require('archiver')

// ---- 忠实复制 electron/zip.ts 的 unzipBuffer（零依赖解压，带路径穿越防护）----
const zlib = require('zlib')
function findEocd(buf) {
  const minStart = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return -1
}
function safeEntryName(raw) {
  let name = String(raw || '').replace(/\\/g, '/')
  if (!name) return null
  if (/^[a-zA-Z]:/.test(name) || name.startsWith('/') || name.startsWith('//')) return null
  const parts = []
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return null
    if (/[<>:"|?*\u0000-\u001f]/.test(seg)) return null
    parts.push(seg)
  }
  if (parts.length === 0) return null
  return parts.join('/')
}
function ensureParentDir(filePath) {
  const dir = path.dirname(filePath)
  try {
    if (fs.existsSync(dir)) return fs.statSync(dir).isDirectory()
    fs.mkdirSync(dir, { recursive: true })
    return true
  } catch { return false }
}
function unzipBuffer(buf, destDir, opts = {}) {
  const maxEntries = opts.maxEntries ?? 500
  const maxFileBytes = opts.maxFileBytes ?? 8 * 1024 * 1024
  const maxTotalBytes = opts.maxTotalBytes ?? 40 * 1024 * 1024
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('不是有效的 zip 文件')
  const entryCount = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = []
  const dirNames = new Set()
  let skipped = 0
  let total = 0
  const files = []
  for (let i = 0; i < entryCount && i < maxEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const rawName = buf.toString('utf-8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    const relName = safeEntryName(rawName)
    if (!relName) { skipped++; continue }
    if (flags & 0x1) { skipped++; continue }
    if (rawName.endsWith('/')) { dirNames.add(relName); continue }
    const segs = relName.split('/')
    for (let k = 1; k < segs.length; k++) dirNames.add(segs.slice(0, k).join('/'))
    if (localOff < 0 || localOff + 30 > buf.length) { skipped++; continue }
    if (buf.readUInt32LE(localOff) !== 0x04034b50) { skipped++; continue }
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    entries.push({ method, compSize, uncompSize, relName, dataStart: localOff + 30 + lNameLen + lExtraLen })
  }
  for (const name of dirNames) {
    const dirPath = path.join(destDir, name)
    if (fs.existsSync(dirPath)) {
      if (fs.statSync(dirPath).isDirectory()) continue
      try { fs.unlinkSync(dirPath) } catch {}
    }
    try { fs.mkdirSync(dirPath, { recursive: true }) } catch {}
  }
  for (const e of entries) {
    if (dirNames.has(e.relName)) continue
    if (e.uncompSize > maxFileBytes || total + e.uncompSize > maxTotalBytes) { skipped++; continue }
    let data
    const raw = buf.subarray(e.dataStart, Math.min(e.dataStart + e.compSize, buf.length))
    try {
      if (e.method === 0) data = Buffer.from(raw)
      else if (e.method === 8) data = zlib.inflateRawSync(raw)
      else { skipped++; continue }
    } catch { skipped++; continue }
    if (data.length > maxFileBytes) { skipped++; continue }
    total += data.length
    const outPath = path.join(destDir, e.relName)
    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) { skipped++; continue }
    if (!ensureParentDir(outPath)) { skipped++; continue }
    fs.writeFileSync(outPath, data)
    files.push(e.relName)
  }
  if (files.length === 0 && skipped > 0) throw new Error('压缩包内没有可安全解压的文件')
  return { files, skipped }
}

// ---- 覆盖式逐文件复制（禁用 cpSync：中文路径段错误）----
function manualCopy(src, dest) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      manualCopy(s, d)
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
    }
  }
}

function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}
async function fetchJson(url) {
  const b = await fetchBuffer(url)
  return JSON.parse(b.toString('utf8'))
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }

function mkdtemp(prefix) { return fs.mkdtempSync(path.join(require('os').tmpdir(), prefix)) }

// 生成补丁 zip（与 make-patch 同款 archiver）
function zipDirToBuffer(srcDir) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('data', (c) => chunks.push(c))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
    archive.directory(path.join(srcDir, 'dist'), 'dist')
    archive.directory(path.join(srcDir, 'dist-electron'), 'dist-electron')
    if (fs.existsSync(path.join(srcDir, 'package.json'))) {
      archive.file(path.join(srcDir, 'package.json'), { name: 'package.json' })
    }
    archive.finalize()
  })
}

let passed = 0, failed = 0
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}

async function run() {
  const base = mkdtemp('dw-test-')
  const newApp = path.join(base, 'newapp')       // 假想的「新版本」app 核心
  const curApp = path.join(base, 'curapp')       // 用户机器上「当前」app 核心
  const serverDir = path.join(base, 'server')    // 更新源
  fs.mkdirSync(path.join(newApp, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(newApp, 'dist-electron'), { recursive: true })
  fs.mkdirSync(curApp, { recursive: true })
  fs.mkdirSync(path.join(curApp, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(curApp, 'dist-electron'), { recursive: true })
  fs.mkdirSync(serverDir, { recursive: true })
  // 当前版本内容（旧）
  fs.writeFileSync(path.join(curApp, 'dist', 'app.js'), '// v1 old')
  fs.writeFileSync(path.join(curApp, 'dist-electron', 'main.js'), '// main v1')
  // 新版本内容（含修改 + 新增 + 删除式保留）
  fs.writeFileSync(path.join(newApp, 'dist', 'app.js'), '// v2 new')
  fs.writeFileSync(path.join(newApp, 'dist', 'extra.js'), '// added in v2')
  fs.writeFileSync(path.join(newApp, 'dist-electron', 'main.js'), '// main v2')
  fs.writeFileSync(path.join(newApp, 'package.json'), JSON.stringify({ version: '26.9.99' }))

  // 生成补丁
  const patch = await zipDirToBuffer(newApp)
  const sha = sha256(patch)
  fs.writeFileSync(path.join(serverDir, 'deepwork-patch-26.9.99.zip'), patch)
  // 同款补丁的 base64-json 封装（文汇百川 file2url 不支持 .zip，生产走这个）
  fs.writeFileSync(
    path.join(serverDir, 'deepwork-patch-26.9.99.json'),
    JSON.stringify({ b64: patch.toString('base64') }),
  )
  const versionJson = {
    version: '26.9.99',
    patch: 'deepwork-patch-26.9.99.zip',
    sha256: sha,
    size: patch.length,
    pubDate: '2026-09-26',
    notes: 'test',
  }
  fs.writeFileSync(path.join(serverDir, 'version.json'), JSON.stringify(versionJson))

  // 起静态服务
  const server = http.createServer((req, res) => {
    const f = path.join(serverDir, decodeURIComponent(req.url.split('?')[0]))
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200)
      fs.createReadStream(f).pipe(res)
    } else { res.writeHead(404); res.end('nf') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  console.log('\n[1] 检测更新（当前 26.9.60 < 26.9.99）')
  const info = await fetchJson(`${baseUrl}/version.json`)
  const hasUpdate = compareVersions(info.version, '26.9.60') > 0
  ok('hasUpdate = true', hasUpdate === true)
  ok('patchUrl 解析正确', `${baseUrl}/${info.patch}` === `${baseUrl}/deepwork-patch-26.9.99.zip`)

  console.log('\n[2] 下载 + 校验 + 解压 + 覆盖替换')
  const buf = await fetchBuffer(`${baseUrl}/${info.patch}`)
  ok('sha256 校验通过', sha256(buf) === info.sha256)
  const tmp = mkdtemp('dw-apply-')
  let applyErr = null
  try {
    const { files } = unzipBuffer(buf, tmp, { maxFileBytes: 30 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 })
    ok('解压出文件', files.length >= 3, 'files=' + files.length)
    manualCopy(tmp, curApp)
  } catch (e) { applyErr = e }
  ok('应用无异常', !applyErr, applyErr && applyErr.message)
  ok('旧文件被覆盖（app.js=v2）', fs.readFileSync(path.join(curApp, 'dist', 'app.js'), 'utf8').includes('v2 new'))
  ok('主进程被覆盖（main=v2）', fs.readFileSync(path.join(curApp, 'dist-electron', 'main.js'), 'utf8').includes('v2'))
  ok('新增文件已落地（extra.js）', fs.existsSync(path.join(curApp, 'dist', 'extra.js')))
  ok('package.json 被更新', JSON.parse(fs.readFileSync(path.join(curApp, 'package.json'), 'utf8')).version === '26.9.99')

  console.log('\n[3] 已是最新版不重复更新')
  const info2 = { version: '26.9.60' }
  ok('hasUpdate = false（相同版本）', compareVersions(info2.version, '26.9.60') > 0 === false)
  const info3 = { version: '26.9.50' }
  ok('hasUpdate = false（线上更旧）', compareVersions(info3.version, '26.9.60') > 0 === false)

  console.log('\n[4] 校验失败应中止')
  let corruptOk = false
  try {
    const bad = Buffer.from(buf); bad[bad.length - 1] ^= 0xff
    if (sha256(bad) !== info.sha256) corruptOk = true
  } catch {}
  ok('篡改后 sha256 不匹配（会被拒绝）', corruptOk)

  console.log('\n[5] 生产格式：base64-json 补丁解码 → 解压 → 覆盖')
  // 模拟 updater.downloadAndApply 的 .json 分支：拉 json → 取 b64 → 解码 → 校验 → 解压 → 覆盖
  const curApp2 = path.join(base, 'curapp2')
  fs.mkdirSync(path.join(curApp2, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(curApp2, 'dist-electron'), { recursive: true })
  fs.writeFileSync(path.join(curApp2, 'dist', 'app.js'), '// v1 old')
  fs.writeFileSync(path.join(curApp2, 'dist-electron', 'main.js'), '// main v1')
  const jraw = await fetchBuffer(`${baseUrl}/deepwork-patch-26.9.99.json`)
  const jobj = JSON.parse(jraw.toString('utf8'))
  const jbuf = Buffer.from(jobj.b64, 'base64')
  ok('json→bytes 还原为 zip', jbuf.slice(0, 4).toString('hex') === '504b0304')
  ok('base64 解码后 sha256 一致', sha256(jbuf) === info.sha256)
  const tmp2 = mkdtemp('dw-apply2-')
  let applyErr2 = null
  try {
    const { files: f2 } = unzipBuffer(jbuf, tmp2, { maxFileBytes: 30 * 1024 * 1024, maxTotalBytes: 80 * 1024 * 1024 })
    ok('解压出文件', f2.length >= 3, 'files=' + f2.length)
    manualCopy(tmp2, curApp2)
  } catch (e) { applyErr2 = e }
  ok('应用无异常', !applyErr2, applyErr2 && applyErr2.message)
  ok('旧文件被覆盖（app.js=v2）', fs.readFileSync(path.join(curApp2, 'dist', 'app.js'), 'utf8').includes('v2 new'))
  ok('新增文件已落地（extra.js）', fs.existsSync(path.join(curApp2, 'dist', 'extra.js')))

  server.close()
  fs.rmSync(base, { recursive: true, force: true })
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  process.exit(failed ? 1 : 0)
}
run().catch((e) => { console.error('测试异常:', e); process.exit(1) })
