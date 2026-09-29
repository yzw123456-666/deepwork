// 一次性补传：version.json 加 mirrors 后覆盖 GitHub asset + 上传文汇百川
const fs = require('fs')
const path = require('path')
const OUT_DIR = path.join(__dirname, '..', '..', '成品', '更新源')
const REPO = 'yzw123456-666/deepwork'

async function main() {
  const vjPath = path.join(OUT_DIR, 'version.json')
  const vj = JSON.parse(fs.readFileSync(vjPath, 'utf-8'))
  if (!vj.asset) throw new Error('本地 version.json 无 asset')
  vj.mirrors = [`https://ghfast.top/${vj.asset}`]
  fs.writeFileSync(vjPath, JSON.stringify(vj, null, 2))
  console.log('version.json 已加 mirrors:', vj.mirrors[0])

  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('缺 GITHUB_TOKEN')
  const auth = { Authorization: `Bearer ${token}`, 'User-Agent': 'deepwork-release', Accept: 'application/vnd.github+json' }
  const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${vj.version}`, { headers: auth }).then(r => r.json())
  if (!rel.id) throw new Error('未找到 release v' + vj.version)
  const upload = async (name, body) => {
    for (const a of rel.assets || []) {
      if (a.name === name) await fetch(`https://api.github.com/repos/${REPO}/releases/assets/${a.id}`, { method: 'DELETE', headers: auth })
    }
    const up = await fetch(`https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${name}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body,
    }).then(r => r.json())
    if (!up.browser_download_url) throw new Error(`上传 ${name} 失败: ` + JSON.stringify(up).slice(0, 200))
    console.log('GitHub asset 覆盖:', name)
  }
  await upload('version.json', fs.readFileSync(vjPath))

  // 文汇百川
  const ft = process.env.FINALOS_TOKEN, osid = process.env.FINALOS_OSID
  if (!ft || !osid) throw new Error('缺文汇百川凭证')
  const form = new FormData()
  form.append('token', ft)
  form.append('file', new Blob([fs.readFileSync(vjPath)]), 'version.json')
  form.append('filename', 'version.json')
  form.append('path', 'deepwork-update')
  const res = await fetch(`https://api.publicos.cn/api/web/file2url?osid=${encodeURIComponent(osid)}`, { method: 'POST', body: form })
  const j = await res.json()
  if (j.code !== 0) throw new Error('文汇百川失败: ' + JSON.stringify(j).slice(0, 200))
  console.log('文汇百川 version.json:', j.url)
}
main().catch(e => { console.error('失败:', e.message); process.exit(1) })
