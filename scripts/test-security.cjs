// 安全中心 + 内置浏览器 测试脚本（可重复运行）
// 用法：node scripts/test-security.cjs           仅本地策略用例
//       node scripts/test-security.cjs --net     额外做一次真实联网搜索
// 依赖：先运行 npx tsc -p electron/tsconfig.json 生成 dist-electron/

const path = require('path')

const dist = path.join(__dirname, '..', 'dist-electron')
const sec = require(path.join(dist, 'security.js'))
const web = require(path.join(dist, 'websearch.js'))

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`) }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)
}

console.log('\n===== 1. 路径穿越与越界校验（assertInsideRoot）=====')
const root = 'D:/work/proj'
ok('根目录内的普通文件放行', sec.assertInsideRoot(root, 'D:/work/proj/src/a.ts') === path.resolve('D:/work/proj/src/a.ts'))
ok('根目录自身放行', !!sec.assertInsideRoot(root, 'D:/work/proj'))
let threw = false
try { sec.assertInsideRoot(root, 'D:/work/other/a.ts') } catch { threw = true }
ok('同前缀兄弟目录越界被拦截（旧版 startsWith 会漏）', threw)
threw = false
try { sec.assertInsideRoot(root, 'D:/work/proj/../escape.txt') } catch { threw = true }
ok('.. 上跳越界被拦截', threw)
eq('isSubPath 前缀误判修复', sec.isSubPath('D:/work/proj', 'D:/work/proj2/a.ts'), false)
eq('isSubPath 正常子路径', sec.isSubPath('D:/work/proj', 'D:/work/proj/sub/a.ts'), true)

console.log('\n===== 2. 文件安全（黑名单 / 白名单例外）=====')
const fileCfg = {
  sandboxEnabled: true,
  fileBlacklist: 'C:/Windows\nD:/work/proj/secret',
  fileWhitelist: 'D:/work/proj/secret/readme.md',
}
eq('普通文件放行', sec.evaluateFilePath(fileCfg, 'D:/work/proj/src/a.ts').decision, 'allow')
eq('黑名单目录被拒', sec.evaluateFilePath(fileCfg, 'C:/Windows/System32/drivers/etc/hosts').decision, 'deny')
eq('黑名单内的子目录被拒', sec.evaluateFilePath(fileCfg, 'D:/work/proj/secret/keys.txt').decision, 'deny')
eq('白名单例外放行', sec.evaluateFilePath(fileCfg, 'D:/work/proj/secret/readme.md').decision, 'allow')
eq('大小写不敏感（Windows）', sec.evaluateFilePath(fileCfg, 'c:/windows/win.ini').decision, 'deny')
eq('反斜杠写法同样命中', sec.evaluateFilePath(fileCfg, 'C:\\Windows\\win.ini').decision, 'deny')
eq('沙箱关闭时全部放行', sec.evaluateFilePath({ ...fileCfg, sandboxEnabled: false }, 'C:/Windows/win.ini').decision, 'allow')
eq('注释行被忽略', sec.evaluateFilePath({ fileBlacklist: '# C:/Windows\n' }, 'C:/Windows/win.ini').decision, 'allow')

console.log('\n===== 3. 命令安全（放行 / 询问名单）=====')
const cmdCfg = { sandboxEnabled: true, cmdAllowList: 'ls\nnode --version', cmdAskList: 'npm install\npip install\nrm' }
eq('放行名单命中 → 直接执行', sec.evaluateCommand(cmdCfg, 'ls -la').decision, 'allow')
eq('询问名单命中 → 需询问', sec.evaluateCommand(cmdCfg, 'npm install lodash').decision, 'ask')
eq('询问名单命中（带前导空格）', sec.evaluateCommand(cmdCfg, '   rm -rf dist').decision, 'ask')
eq('都未命中 → 默认放行', sec.evaluateCommand(cmdCfg, 'echo hello').decision, 'allow')
eq('放行名单优先于询问名单', sec.evaluateCommand({ cmdAllowList: 'npm', cmdAskList: 'npm install' }, 'npm install x').decision, 'allow')
eq('大小写不敏感', sec.evaluateCommand(cmdCfg, 'NPM INSTALL x').decision, 'ask')

console.log('\n===== 4. 网络安全（域名规则）=====')
const netCfg = { sandboxEnabled: true, netBlockedDomains: 'tracker.example.net\nexample.com', netAllowedDomains: 'api.deepseek.com\ncn.bing.com' }
eq('禁止域名被拒', sec.evaluateUrl(netCfg, 'https://example.com/a').decision, 'deny')
eq('禁止域名的子域被拒', sec.evaluateUrl(netCfg, 'https://sub.example.com/a').decision, 'deny')
eq('允许名单命中 → 放行', sec.evaluateUrl(netCfg, 'https://api.deepseek.com/v1/chat').decision, 'allow')
eq('允许名单的子域 → 放行', sec.evaluateUrl(netCfg, 'https://cn.bing.com/search?q=a').decision, 'allow')
eq('未列入允许名单 → 询问', sec.evaluateUrl(netCfg, 'https://unknown.site/a').decision, 'ask')
eq('禁止优先于允许', sec.evaluateUrl({ netBlockedDomains: 'x.com', netAllowedDomains: 'x.com' }, 'https://x.com/').decision, 'deny')
eq('允许名单为空 → 不限制', sec.evaluateUrl({ netAllowedDomains: '' }, 'https://any.site/').decision, 'allow')
eq('域名后缀伪装不命中', sec.evaluateUrl({ netBlockedDomains: 'example.com' }, 'https://notexample.com/').decision, 'allow')
eq('非法 URL 被拒', sec.evaluateUrl(netCfg, 'not-a-url').decision, 'deny')

console.log('\n===== 5. 数据安全（回收站 / 批量审批 / 备份配额）=====')
eq('删除保护默认开启', sec.shouldTrash({}), true)
eq('删除保护可关闭', sec.shouldTrash({ deleteProtection: false }), false)
eq('条目数达阈值 → 需审批', sec.needsBatchApproval({ batchDeleteThreshold: 50 }, 50), true)
eq('条目数未达阈值 → 免审批', sec.needsBatchApproval({ batchDeleteThreshold: 50 }, 49), false)
eq('阈值为 0 → 关闭审批', sec.needsBatchApproval({ batchDeleteThreshold: 0 }, 999), false)
eq('备份默认关闭', sec.shouldBackup({}), false)
eq('备份开启判断', sec.shouldBackup({ autoBackup: true }), true)
eq('备份配额换算（3000MB）', sec.backupQuotaBytes({ backupMaxSize: 3000 }), 3000 * 1024 * 1024)
eq('备份配额为 0 时回落到默认 3000MB', sec.backupQuotaBytes({ backupMaxSize: 0 }), 3000 * 1024 * 1024)
eq('备份配额非法值时回落到默认', sec.backupQuotaBytes({ backupMaxSize: Number('abc') }), 3000 * 1024 * 1024)
eq('备份配额为负值时按 1MB 下限', sec.backupQuotaBytes({ backupMaxSize: -5 }), 1024 * 1024)

console.log('\n===== 6. 网页解析（离线样本）=====')
const bingSample = `<html><title>t</title><li class="b_algo"><h2><a href="https://a.com/1">结果 &amp; 一</a></h2><p>摘要一 &lt;b&gt;</p></li><li class="b_algo"><h2><a href="https://b.com/2">结果二</a></h2><p>摘要二</p></li></html>`
const bingResults = web.parseBingResults(bingSample, 8)
eq('Bing 解析条数', bingResults.length, 2)
eq('Bing 标题实体解码', bingResults[0].title, '结果 & 一')
eq('Bing 链接提取', bingResults[1].url, 'https://b.com/2')
eq('Bing 摘要去标签', bingResults[0].snippet, '摘要一 <b>')
const ddgSample = `<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fc.com%2Fx">DDG 标题</a><a class="result__snippet">DDG 摘要</a></div>`
const ddgResults = web.parseDuckDuckGoResults(ddgSample, 8)
eq('DuckDuckGo 解析条数', ddgResults.length, 1)
eq('DuckDuckGo 跳转链接还原', ddgResults[0].url, 'https://c.com/x')
const baiduSample = `<h3 class="t"><a href="http://www.baidu.com/link?url=abc">百度标题</a></h3><div class="c-span-last"><span class="c-abstract">百度摘要</span></div>`
const baiduResults = web.parseBaiduResults(baiduSample, 8)
eq('百度解析条数', baiduResults.length, 1)
eq('百度标题', baiduResults[0].title, '百度标题')
eq('引擎自动识别', web.detectEngineResults(bingSample, 8).engine, 'bing')
const text = web.htmlToText('<html><head><title>页面标题</title><style>a{}</style></head><body><script>var a=1</script><h1>大标题</h1><p>段落一</p><p>段落二</p></body></html>')
eq('正文标题提取', text.title, '页面标题')
ok('正文去掉 script/style', !text.text.includes('var a') && !text.text.includes('a{}'))
ok('正文保留段落', text.text.includes('段落一') && text.text.includes('段落二'))

console.log('\n===== 7. 真实联网搜索（可选）=====')
async function netTest() {
  const r = await web.webSearch('Minecraft Forge 1.20.1 下载', 5, 15000)
  if (r.ok) {
    console.log(`  ✓ 搜索成功（引擎 ${r.engine}，${r.results.length} 条）`)
    r.results.slice(0, 3).forEach((x, i) => console.log(`      ${i + 1}. ${x.title.slice(0, 60)} → ${x.url.slice(0, 70)}`))
    pass++
  } else {
    console.log(`  ✗ 搜索失败：${r.errors.join('；')}`)
    fail++; failures.push('真实联网搜索')
  }
  const f = await web.webFetch('https://example.com', 2000)
  if (f.ok && f.text.includes('Example Domain')) { console.log('  ✓ 网页抓取成功（example.com）'); pass++ }
  else { console.log(`  ✗ 网页抓取失败：${f.error || '内容不符'}`); fail++; failures.push('网页抓取') }
}

;(async () => {
  if (process.argv.includes('--net')) await netTest()
  else console.log('  （跳过：加 --net 参数可执行真实联网测试）')
  console.log(`\n===== 结果：通过 ${pass} 项，失败 ${fail} 项 =====`)
  if (fail > 0) console.log('失败用例：\n - ' + failures.join('\n - '))
  process.exit(fail > 0 ? 1 : 0)
})()
