/**
 * 网络查询工具真实联网验证（2026-09-25）：webSearch（Bing→DuckDuckGo→百度回退）+ webFetch。
 * 与离线回归 test-web.cjs 区分：本脚本发真实网络请求，验证引擎可达性与解析质量。
 * 用法：node scripts/verify-web-live.cjs
 */
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '..', 'node_modules', 'typescript'))

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')) }
}

const js = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '..', 'electron', 'websearch.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText
const tmp = path.join(__dirname, '.temp-websearch.cjs')
fs.writeFileSync(tmp, js)
const ws = require(tmp)

;(async () => {
  console.log('===== 1. webSearch：中文查询 =====')
  const r1 = await ws.webSearch('深度学习 是什么', 6, 15000)
  console.log(`  引擎=${r1.engine} 结果=${r1.results.length} 错误=[${r1.errors.join(' | ')}]`)
  ok('中文搜索成功', r1.ok && r1.results.length > 0)
  for (const r of r1.results.slice(0, 3)) console.log(`   · ${r.title.slice(0, 40)} → ${String(r.url).slice(0, 60)}`)
  ok('结果含标题与 URL', r1.results.every(x => x.title && /^https?:\/\//.test(x.url)))

  console.log('===== 2. webSearch：英文查询 =====')
  const r2 = await ws.webSearch('electron desktop app framework', 6, 15000)
  console.log(`  引擎=${r2.engine} 结果=${r2.results.length} 错误=[${r2.errors.join(' | ')}]`)
  ok('英文搜索成功', r2.ok && r2.results.length > 0)

  console.log('===== 3. webSearch：空查询兜底 =====')
  const r3 = await ws.webSearch('', 6, 5000)
  ok('空查询返回错误而非崩溃', !r3.ok && r3.results.length === 0)

  console.log('===== 4. webFetch：稳定页面 =====')
  const f1 = await ws.webFetch('https://example.com', 4000, 15000)
  console.log(`  title=${f1.title.slice(0, 50)} 文本=${f1.text.length} 字`)
  ok('example.com 抓取成功', f1.ok && f1.text.length > 50)
  ok('正文不含原始 HTML 标签', !/<\/?(html|body|div)[\s>]/i.test(f1.text.slice(0, 500)))

  console.log('===== 5. webFetch：搜索结果的真实页面（中文正文提取） =====')
  const target = r1.results[0]
  if (target) {
    const f2 = await ws.webFetch(target.url, 6000, 20000)
    console.log(`  url=${String(f2.url).slice(0, 60)} title=${String(f2.title).slice(0, 40)} 文本=${f2.text.length} 字 ${f2.error ? '错误=' + f2.error : ''}`)
    ok('搜索结果页面可抓取（或给出明确错误）', f2.ok ? f2.text.length > 100 : !!f2.error)
  } else {
    console.log('  （无搜索结果，跳过）')
  }

  console.log('===== 6. webFetch：非法 URL 兜底 =====')
  const f3 = await ws.webFetch('ftp://bad.example', 1000, 5000)
  ok('非 http(s) URL 被拒绝', !f3.ok && /http/.test(f3.error || ''))

  console.log(`\n===== 结果: 通过 ${pass} 项, 失败 ${fail} 项 =====`)
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.error('致命错误:', e.message); process.exit(1) })
