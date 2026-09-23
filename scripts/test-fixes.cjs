// 回归测试：验证本轮全功能检查中修复的缺陷确实生效
// 直接 require 编译产物，确保测的是「真正打进 exe 的那份代码」
const fs = require('fs')
const os = require('os')
const path = require('path')
const sec = require(path.join(__dirname, '..', 'dist-electron', 'security.js'))

const results = []
function check(name, fn) {
  try {
    const r = fn()
    results.push({ name, ok: r === true, got: String(r) })
  } catch (e) {
    results.push({ name, ok: false, got: 'threw: ' + e.message })
  }
}

// ---------- 1. 符号链接越权防护（assertInsideRoot 现在会解析真实路径）----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-root-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-out-'))
const linkPath = path.join(tmpRoot, 'escape')
let symlinkOk = false
try {
  fs.symlinkSync(outside, linkPath, 'junction')
  symlinkOk = fs.existsSync(linkPath)
} catch (e) {
  symlinkOk = false
}

check('符号链接：指向目录外的链接被拦截', () => {
  if (!symlinkOk) return 'skipped'
  try {
    sec.assertInsideRoot(tmpRoot, linkPath)
    return false // 没有抛错 = 防护失效
  } catch (e) {
    return /路径越界/.test(e.message)
  }
})

check('符号链接：目录内正常路径仍放行', () => {
  const inner = path.join(tmpRoot, 'a.txt')
  fs.writeFileSync(inner, 'x')
  const r = sec.assertInsideRoot(tmpRoot, inner)
  return fs.realpathSync(r) === fs.realpathSync(inner)
})

check('符号链接：不存在的目标（新建文件）不误杀', () => {
  const fresh = path.join(tmpRoot, 'new.txt')
  const r = sec.assertInsideRoot(tmpRoot, fresh)
  return path.basename(r) === 'new.txt'
})

check('.. 上跳仍被拦截', () => {
  try { sec.assertInsideRoot(tmpRoot, path.join(tmpRoot, '..', 'outside', 'x')); return false }
  catch (e) { return /路径越界/.test(e.message) }
})

// ---------- 2. isSubPath 前缀误判（回归）----------
check('同前缀兄弟目录不算越界', () => {
  return sec.evaluateFilePath({ sandboxEnabled: true, fileBlacklist: 'D:/secret' }, 'D:/secret2/x').decision === 'allow'
})
check('精确命中黑名单目录', () => {
  return sec.evaluateFilePath({ sandboxEnabled: true, fileBlacklist: 'D:/secret' }, 'D:/secret/x').decision === 'deny'
})

// ---------- 3. 备份配额：始终保留最新一份 ----------
check('配额换算正常', () => sec.backupQuotaBytes({ backupMaxSize: 100 }) === 100 * 1024 * 1024)
check('配额非法值回落默认 3000MB', () => sec.backupQuotaBytes({ backupMaxSize: 'abc' }) === 3000 * 1024 * 1024)

// ---------- 4. 命令与域名策略（回归）----------
check('询问名单命中 → ask', () => sec.evaluateCommand({ cmdAskList: 'del' }, 'del /q a.txt').decision === 'ask')
check('禁止域名优先于允许', () => {
  const c = { netBlockedDomains: 'evil.com', netAllowedDomains: 'evil.com' }
  return sec.evaluateUrl(c, 'https://evil.com/x').decision === 'deny'
})
check('非法 URL 被拒', () => sec.evaluateUrl({ netBlockedDomains: '' }, 'not-a-url').decision === 'deny')

// 清理
try { if (symlinkOk) fs.rmSync(linkPath, { recursive: true, force: true }) } catch {}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch {}
try { fs.rmSync(outside, { recursive: true, force: true }) } catch {}

let pass = 0, fail = 0, skip = 0
console.log('===== 修复回归验证（dist-electron 产物）=====\n')
for (const r of results) {
  if (r.got === 'skipped') { skip++; console.log(`  ○ ${r.name}  （环境不支持，已跳过）`); continue }
  r.ok ? pass++ : fail++
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  → ${r.got}`}`)
}
console.log(`\n===== 结果：通过 ${pass}，失败 ${fail}，跳过 ${skip} =====`)
process.exit(fail ? 1 : 0)
