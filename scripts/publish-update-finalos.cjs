/**
 * 把更新源（version.json + 补丁 zip）发布到文汇百川网站库，拿到公开下载 URL。
 *
 * 接口规范见 webos skill（finalos.cn/developer/skill）：file2url
 *   POST https://api.publicos.cn/api/web/file2url?osid=Sxxxx
 *   form: token(必填), file(必填), filename(可选), path(可选)
 *
 * 凭证通过环境变量传入（绝不写进文件 / git）：
 *   FINALOS_OSID  —— 系统 ID，形如 S12345
 *   FINALOS_TOKEN —— 网站库令牌（该库需开「外部公开」）
 *
 * 用法：FINALOS_OSID=S12345 FINALOS_TOKEN=xxxx node scripts/publish-update-finalos.cjs
 *
 * 两个文件上传到同一 path（deepwork-update），返回的 base 即 UPDATE_BASE_URL。
 */
const fs = require('fs')
const path = require('path')

const osid = process.env.FINALOS_OSID
const token = process.env.FINALOS_TOKEN
if (!osid || !token) {
  console.error('缺少凭证：请设置环境变量 FINALOS_OSID 和 FINALOS_TOKEN')
  process.exit(1)
}

const API = 'https://api.publicos.cn/api/web'
const srcDir = path.join(__dirname, '..', '..', '成品', '更新源')

async function uploadFile(filePath, filename, destPath) {
  const buf = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('token', token)
  form.append('file', new Blob([buf]), filename)
  form.append('filename', filename)
  if (destPath) form.append('path', destPath)
  const res = await fetch(`${API}/file2url?osid=${encodeURIComponent(osid)}`, {
    method: 'POST',
    body: form,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`非 JSON 响应（${res.status}）: ${text.slice(0, 200)}`)
  }
  if (json.code !== 0) throw new Error(`上传失败 code=${json.code} msg=${json.msg}`)
  return json.url
}

async function main() {
  if (!fs.existsSync(srcDir)) throw new Error('找不到 成品/更新源 目录')
  const files = fs.readdirSync(srcDir)
  // 文汇百川 file2url 不支持 .zip，补丁以 base64 封装的 .json 上传
  const patchName = files.find((f) => f.startsWith('deepwork-patch-') && f.endsWith('.json'))
  if (!patchName) throw new Error('更新源目录缺少补丁 json（先运行 make-patch.cjs 生成）')
  if (!files.includes('version.json')) throw new Error('更新源目录缺少 version.json')

  console.log('上传 version.json …')
  const verUrl = await uploadFile(path.join(srcDir, 'version.json'), 'version.json', 'deepwork-update')
  console.log('  →', verUrl)

  console.log('上传补丁 ' + patchName + ' …')
  const zipUrl = await uploadFile(path.join(srcDir, patchName), patchName, 'deepwork-update')
  console.log('  →', zipUrl)

  const base = verUrl.replace(/\/version\.json$/, '')
  console.log('\n✅ 发布完成')
  console.log('UPDATE_BASE_URL =', base)
  console.log('补丁文件 URL     =', zipUrl)
  console.log('\n把 UPDATE_BASE_URL 设为环境变量 DEEPWORK_UPDATE_URL，或告诉我这个地址我写进 updater.ts 默认值。')
}

main().catch((e) => {
  console.error('发布失败:', e.message)
  process.exit(1)
})
