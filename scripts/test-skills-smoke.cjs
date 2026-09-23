// 技能安装端到端冒烟：真实访问 ClawHub 下载 zip 并解压到本地目录
const path = require('path')
const os = require('os')
const fs = require('fs')
const skills = require('../dist-electron/skills.js')
const zip = require('../dist-electron/zip.js')

const tmpRoot = path.join(os.tmpdir(), 'dw-skillsmoke-' + Date.now())
fs.mkdirSync(tmpRoot, { recursive: true })

// 允许名单式网关：只放行 clawhub.ai
const guard = async (url) => {
  let host = ''
  try { host = new URL(url).host } catch { return { ok: false, error: '非法 URL' } }
  if (host === 'clawhub.ai' || host.endsWith('.clawhub.ai')) return { ok: true }
  return { ok: false, error: '域名不在允许名单: ' + host }
}

async function main() {
  console.log('[1] zip 模块导出:', Object.keys(zip))
  console.log('[2] skills 模块导出:', Object.keys(skills))

  const cases = [
    { slug: 'find-skills', owner: 'guipi888', name: 'find-skills' },
    { slug: 'dev-expert', owner: undefined, name: 'dev-expert' },
  ]

  for (const c of cases) {
    console.log('\n=== 安装 ' + c.slug + (c.owner ? ' (owner=' + c.owner + ')' : '') + ' ===')
    const r = await skills.installSkill(tmpRoot, { slug: c.slug, owner: c.owner, name: c.name }, guard)
    if (!r.ok) { console.log('  失败:', r.error); continue }
    console.log('  ok, meta =', JSON.stringify({ slug: r.meta.slug, version: r.meta.version, files: (r.meta.files || []).length, enabled: r.meta.enabled }))
    const rd = skills.readSkill(tmpRoot, r.meta.slug, 6000)
    console.log('  readSkill ok =', rd.ok, 'files =', (rd.files || []).length)
    if (rd.content) console.log('  正文前 120 字:\n' + rd.content.slice(0, 120).replace(/\n/g, '\\n'))
  }

  console.log('\n=== 列表 ===')
  const list = skills.listSkills(tmpRoot)
  console.log(JSON.stringify(list.map(s => ({ slug: s.slug, enabled: s.enabled, files: (s.files || []).length })), null, 1))

  console.log('\n=== 停用 + 再启用 ===')
  console.log('setEnabled(false) =', skills.setSkillEnabled(tmpRoot, list[0].slug, false))
  console.log('list[0].enabled =', skills.listSkills(tmpRoot).find(s => s.slug === list[0].slug).enabled)
  console.log('setEnabled(true) =', skills.setSkillEnabled(tmpRoot, list[0].slug, true))

  console.log('\n=== 磁盘文件树（两层） ===')
  for (const d of fs.readdirSync(tmpRoot)) {
    const p = path.join(tmpRoot, d)
    if (!fs.statSync(p).isDirectory()) continue
    let inner = []
    try { inner = fs.readdirSync(p).slice(0, 8) } catch (e) {}
    console.log('  ' + d + '/ -> ' + inner.join(', '))
  }

  console.log('\n=== 卸载测试 ===')
  const target = list[list.length - 1].slug
  console.log('remove(' + target + ') =', skills.removeSkill(tmpRoot, target))
  console.log('剩余 =', skills.listSkills(tmpRoot).map(s => s.slug).join(', '))

  console.log('\n=== 恶意 slug 测试 ===')
  for (const bad of ['../evil', 'a/b', '', '.', 'x'.repeat(80)]) {
    const r = await skills.installSkill(tmpRoot, { slug: bad, name: 'x' }, guard)
    console.log('  slug=' + JSON.stringify(bad) + ' -> ok=' + r.ok + ' err=' + (r.error || ''))
  }

  console.log('\n=== 网关拒绝测试（换成 example.com） ===')
  const r2 = await skills.installSkill(tmpRoot, { slug: 'x', name: 'x' }, async (url) => ({ ok: false, error: '拒绝' }))
  console.log('  ok=' + r2.ok + ' err=' + (r2.error || ''))

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch (e) {}
  console.log('\nSMOKE_DONE')
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
