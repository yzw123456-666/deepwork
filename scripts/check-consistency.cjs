// 静态一致性检查：IPC 通道 / i18n 键 / 类型声明 / 死代码
// 目的：把「人工肉眼比对」固化成可重复运行的检查，防止回归
// 用法：node scripts/check-consistency.cjs
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8')

let pass = 0
const problems = []
const note = (ok, msg) => { ok ? pass++ : problems.push(msg) }

/* ---------- 1. IPC 通道：main 注册 vs preload 桥接 ---------- */
const mainSrc = read('electron/main.ts')
const preSrc = read('electron/preload.ts')
const dtsSrc = read('src/types/electron.d.ts')

const grabChannels = (src, re) => {
  const set = new Set()
  let m
  while ((m = re.exec(src))) set.add(m[1])
  return set
}
const mainCh = grabChannels(mainSrc, /ipcMain\.(?:handle|on)\('([^']+)'/g)
const preCh = grabChannels(preSrc, /ipcRenderer\.(?:invoke|send)\('([^']+)'/g)

for (const ch of preCh) {
  note(mainCh.has(ch), `[IPC] preload 桥接了 ${ch}，但主进程没有注册 handler（调用会抛 No handler registered）`)
}
for (const ch of mainCh) {
  if (!preCh.has(ch) && !/^window:/.test(ch)) {
    problems.push(`[IPC 提示] 主进程注册了 ${ch}，但 preload 未暴露（可能是预留或遗漏）`)
  }
}

/* ---------- 2. preload 暴露的方法必须在 electron.d.ts 声明 ---------- */
// 提取 preload 中各分组的方法名
const groups = {}
const groupRe = /^\s{2}(\w+):\s*\{/gm
let gm
while ((gm = groupRe.exec(preSrc))) {
  const start = gm.index
  const name = gm[1]
  // 取该分组直到匹配的缩进闭合
  const after = preSrc.slice(start)
  const endIdx = after.indexOf('\n  },')
  const body = after.slice(0, endIdx === -1 ? after.length : endIdx)
  const methods = []
  let mm
  const mRe = /^\s{4}(\w+):/gm
  while ((mm = mRe.exec(body))) methods.push(mm[1])
  groups[name] = methods
}
// 用括号配平提取某个 key 的块内容（d.ts 里有 { ok: boolean } 这类内联对象，不能用 [^}]*）
function extractBlock(src, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\{`).exec(src)
  if (!m) return null
  let i = m.index + m[0].length - 1
  let depth = 0
  let start = -1
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') { depth++; if (depth === 1) start = i }
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start + 1, i) }
  }
  return null
}

const dtsBlocks = {}
for (const g of Object.keys(groups)) {
  const blk = extractBlock(dtsSrc, g)
  if (blk == null) continue
  const keys = new Set()
  let km
  const kRe = /^\s{4}(\w+)\s*:/gm
  while ((km = kRe.exec(blk))) keys.add(km[1])
  dtsBlocks[g] = keys
}
for (const [g, methods] of Object.entries(groups)) {
  const declared = dtsBlocks[g]
  if (!declared) { problems.push(`[类型] electron.d.ts 中缺少分组 ${g} 的声明`); continue }
  for (const m of methods) {
    note(declared.has(m), `[类型] preload 暴露了 ${g}.${m}，但 electron.d.ts 中没有对应声明`)
  }
}

/* ---------- 3. i18n 中英键一致性 ---------- */
const i18nSrc = read('src/i18n/index.ts')
function flattenKeys(langKey) {
  // 找到 zh: { ... } 或 en: { ... } 区块，用括号配平提取
  const marker = new RegExp(`\\b${langKey}\\s*:\\s*\\{`)
  const m = marker.exec(i18nSrc)
  if (!m) return null
  let i = m.index + m[0].length - 1 // 指向 '{'
  let depth = 0
  let start = -1
  for (; i < i18nSrc.length; i++) {
    const c = i18nSrc[i]
    if (c === '{') { depth++; if (depth === 1) start = i }
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  const block = i18nSrc.slice(start + 1, i)
  const keys = new Set()
  // 逐行取 "key:" 形式（只取叶子键，值为字符串或以 [ 开头）
  const lineRe = /^\s*([A-Za-z0-9_]+)\s*:/gm
  let lm
  while ((lm = lineRe.exec(block))) keys.add(lm[1])
  return keys
}
const zh = flattenKeys('zh')
const en = flattenKeys('en')
if (zh && en) {
  for (const k of zh) note(en.has(k), `[i18n] 中文有键 "${k}" 但英文缺失（英文界面会显示空白）`)
  for (const k of en) note(zh.has(k), `[i18n] 英文有键 "${k}" 但中文缺失`)
} else {
  problems.push('[i18n] 无法定位 zh/en 区块，跳过键比对')
}

/* ---------- 4. t('...') 引用的键必须存在 ---------- */
if (zh) {
  const srcFiles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) walk(rel)
      else if (/\.tsx?$/.test(e.name)) srcFiles.push(rel)
    }
  }
  walk('src')
  const missing = new Set()
  for (const f of srcFiles) {
    const src = read(f)
    let m
    const re = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g
    while ((m = re.exec(src))) {
      const full = m[1]
      const last = full.split('.').pop()
      if (!zh.has(last) && !/\$\{/.test(full)) missing.add(`${f} → t('${full}')`)
    }
  }
  for (const item of missing) problems.push(`[i18n] 引用了不存在的键：${item}`)
  if (missing.size === 0) pass++
}

/* ---------- 5. 品牌一致性：不应再出现旧品牌/供应商文案 ---------- */
const banned = [
  { re: /Many AI/, where: 'src', msg: '旧品牌名 "Many AI" 残留' },
  { re: /供应商|提供商/, where: 'src', msg: '已废弃的"供应商"文案残留' },
]
for (const b of banned) {
  const files = []
  const walk2 = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name)
      if (e.isDirectory()) walk2(rel)
      else if (/\.(tsx?|html)$/.test(e.name) && b.re.test(read(rel))) files.push(rel)
    }
  }
  walk2(b.where)
  files.forEach(f => problems.push(`[品牌] ${b.msg}：${f}`))
  if (files.length === 0) pass++
}

/* ---------- 输出 ---------- */
console.log('===== 静态一致性检查 =====\n')
console.log(`主进程通道 ${mainCh.size} 个 / preload 通道 ${preCh.size} 个`)
if (zh && en) console.log(`i18n 键：中文 ${zh.size} 个 / 英文 ${en.size} 个`)
console.log(`\n通过检查项：${pass}`)
if (problems.length === 0) {
  console.log('未发现一致性问题 ✅')
} else {
  console.log(`\n发现 ${problems.length} 个问题：`)
  problems.forEach(p => console.log(`  ✗ ${p}`))
}
process.exit(problems.filter(p => !p.startsWith('[IPC 提示]')).length ? 1 : 0)
