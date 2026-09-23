// 端到端验证：直接 require 编译产物 dist-electron/security.js + websearch.js
// 目的：确认「主进程真正加载的那份代码」策略行为符合预期（而非只测源码）
const path = require('path')
const sec = require(path.join(__dirname, '..', 'dist-electron', 'security.js'))
const web = require(path.join(__dirname, '..', 'dist-electron', 'websearch.js'))

const cfg = {
  sandboxEnabled: true,
  fileBlacklist: 'C:\\Windows\nD:/secret',
  fileWhitelist: 'C:\\Windows\\Temp',
  cmdAllowList: 'git status',
  cmdAskList: 'del\nrm -rf\nformat',
  netBlockedDomains: 'evil.com',
  netAllowedDomains: '',
  trashEnabled: true,
  batchDeleteThreshold: 50,
  backupEnabled: true,
  backupMaxSize: 3000,
}

const cases = [
  // [名称, 实际值, 期望值]
  ['读 C:\\Windows\\System32\\cmd.exe 应被拒', sec.evaluateFilePath(cfg, 'C:\\Windows\\System32\\cmd.exe').decision, 'deny'],
  ['读 C:\\Windows\\Temp\\a.txt 白名单例外', sec.evaluateFilePath(cfg, 'C:\\Windows\\Temp\\a.txt').decision, 'allow'],
  ['读 C:\\Users\\me\\doc.txt 放行', sec.evaluateFilePath(cfg, 'C:\\Users\\me\\doc.txt').decision, 'allow'],
  ['前缀兄弟目录 D:/secret2 不越界', sec.evaluateFilePath(cfg, 'D:/secret2/x.txt').decision, 'allow'],
  ['精确命中 D:/secret/x.txt', sec.evaluateFilePath(cfg, 'D:/secret/x.txt').decision, 'deny'],
  ['git status 命中放行名单', sec.evaluateCommand(cfg, 'git status').decision, 'allow'],
  ['del /q x.txt 命中询问名单', sec.evaluateCommand(cfg, 'del /q x.txt').decision, 'ask'],
  ['echo hi 未命中默认放行', sec.evaluateCommand(cfg, 'echo hi').decision, 'allow'],
  ['访问 evil.com 被拒', sec.evaluateUrl(cfg, 'https://evil.com/x').decision, 'deny'],
  ['访问 evil.com.evil.org 伪装不命中', sec.evaluateUrl(cfg, 'https://evil.com.evil.org/').decision, 'allow'],
  ['访问 baidu.com 允许名单为空则放行', sec.evaluateUrl(cfg, 'https://baidu.com').decision, 'allow'],
  ['删除走回收站', String(sec.shouldTrash(cfg)), 'true'],
  ['60 条目需批量审批', String(sec.needsBatchApproval(cfg, 60)), 'true'],
  ['10 条目免审批', String(sec.needsBatchApproval(cfg, 10)), 'false'],
  ['备份配额 3000MB', String(sec.backupQuotaBytes(cfg)), String(3000 * 1024 * 1024)],
  ['沙箱关闭 → 黑名单放行', sec.evaluateFilePath({ ...cfg, sandboxEnabled: false }, 'C:\\Windows\\x').decision, 'allow'],
  ['目录读越界 .. 被拒', (() => { try { sec.assertInsideRoot('D:/proj', 'D:/proj/../other/x'); return 'no-throw' } catch { return 'deny' } })(), 'deny'],
  ['目录内路径正常', (() => { try { sec.assertInsideRoot('D:/proj', 'D:/proj/a/b.txt'); return 'ok' } catch { return 'err' } })(), 'ok'],
  // 网页解析：主进程真实产物
  ['websearch 导出 webSearch', typeof web.webSearch, 'function'],
  ['websearch 导出 webFetch', typeof web.webFetch, 'function'],
  ['htmlToText 去标签', web.htmlToText('<div>你好<b>世界</b></div>').text.replace(/\s/g, ''), '你好世界'],
  ['htmlToText 去 script', /alert/.test(web.htmlToText('<script>alert(1)</script>正文').text), false],
  ['htmlToText 提取 title', web.htmlToText('<html><head><title>页面标题</title></head><body>x</body></html>').title, '页面标题'],
]

let pass = 0, fail = 0
console.log('===== 产物级端到端验证（dist-electron/）=====\n')
for (const [name, got, want] of cases) {
  const ok = String(got) === String(want)
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}  → ${got}${ok ? '' : `  (期望: ${want})`}`)
}
console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
process.exit(fail ? 1 : 0)
