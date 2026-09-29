/**
 * 思考流显示专项测试（用户三轮反馈的「思考过程只显示一行」回归）：
 *
 *   根因：engine.callModel 的 onThinking 传「增量分片」，TaskWorkspace 用 += 累积（正确），
 *         而 ChatArea 曾用 = 覆盖（错误）→ UI 只剩最后一个分片（"now"/"do"/"(i"）。
 *
 *   修复：ChatArea.onThinking 改为 += 累积 + 300ms 节流。
 *
 * 做法：mock fetch 返回脚本化 SSE reasoning_content 分片流
 *       → 跑真实（转译后的）engine.callModel，收集 onThinking 序列
 *       → 分别以「任务视图式 +=」「对话页修复后 +=」两种消费方验证
 *       → 提取 ChatArea.tsx 里真实的 onThinking 回调体在 mock 环境执行，验证节流与最终内容
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

let pass = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \u2713 ' + name) }
  else { fails.push(name + (extra ? ' \u2192 ' + extra : '')); console.log('  \u2717 ' + name + (extra ? ' \u2192 ' + extra : '')) }
}

const root = path.join(__dirname, '..')

// ---------- 装载真实 agentEngine ----------
const engineSrc = fs.readFileSync(path.join(root, 'src', 'services', 'agentEngine.ts'), 'utf8')
const patched = engineSrc
  .replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/types'/, '')
  .replace(/import\s*\{\s*v4 as uuidv4\s*\}\s*from\s*'uuid'/, "const uuidv4 = () => 'id-' + Math.random().toString(36).slice(2)")
const js = ts.transpileModule(patched, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const enginePath = path.join(root, '.temp-engine-think.cjs')
fs.writeFileSync(enginePath, js)
const engine = require(enginePath)
ok('engine.callModel 可用', typeof engine.callModel === 'function')

// ---------- mock fetch：脚本化 SSE 流 ----------
function sseResponse(chunks, opts = {}) {
  const enc = new TextEncoder()
  const sseLines = chunks.map(c => 'data: ' + JSON.stringify(c)).join('\n\n') + '\n\ndata: [DONE]\n\n'
  let done = false
  return {
    ok: true, status: 200,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader() {
        return { read: async () => (done ? { done: true } : (done = true, { done: false, value: enc.encode(sseLines) })) }
      },
    },
    text: async () => '', json: async () => ({}),
  }
}

const model = { id: 'm1', name: 'fake-model', enabled: true, baseUrl: 'http://localhost:1/v1', apiKey: 'k', contextWindow: 32768 }

;(async () => {
console.log('\n===== 1. reasoning_content 分片流：onThinking 是增量序列 =====')
const thinkParts = ['首先', '分析网站的', '整体结构：', '头部导航', '内容主体', '底部版权']
const bodyParts = ['网站的', '结构分析', '如下……']
const chunks1 = [
  ...thinkParts.map(t => ({ choices: [{ delta: { reasoning_content: t } }] })),
  ...bodyParts.map(t => ({ choices: [{ delta: { content: t } }] })),
]
global.fetch = async () => sseResponse(chunks1)

const deltas1 = []
const { content: returned1 } = await engine.callModel(model, [{ role: 'user', content: '分析网站' }], 0.4, undefined, (t) => deltas1.push(t))
const fullThink = thinkParts.join('')

ok('onThinking 回调次数 = 分片数', deltas1.length === thinkParts.length, `实际 ${deltas1.length} 次`)
ok('每次回调是单个增量分片', deltas1.every((d, i) => d === thinkParts[i]), JSON.stringify(deltas1))
ok('增量拼接 = 完整思考', deltas1.join('') === fullThink, JSON.stringify(deltas1.join('')))
ok('返回值是正文、不含思考', returned1 === bodyParts.join(''), JSON.stringify(returned1))

console.log('\n===== 2. 两种真实消费方：任务视图(+=) / 对话页修复后(+=) =====')
// 任务视图式消费（TaskWorkspace.collectThinking）
let bufTask = ''
deltas1.forEach(t => { bufTask += t })
ok('任务视图式 += 得到完整思考', bufTask === fullThink, JSON.stringify(bufTask))

// 对话页修复后消费（ChatArea.onThinking：fullThinkingRef.current += delta）
let refFull = ''
deltas1.forEach(t => { refFull += t })
ok('对话页 += 累积得到完整思考', refFull === fullThink, JSON.stringify(refFull))

// 旧 bug 模式（= 覆盖）：证明用户所见残片的机理
let lastOnly = ''
deltas1.forEach(t => { lastOnly = t })
ok('旧 bug（= 覆盖）只显示最后分片（非完整）', lastOnly !== fullThink && lastOnly === thinkParts[thinkParts.length - 1], JSON.stringify(lastOnly))

console.log('\n===== 3. content 内 <think> 整块：整块兼容增量语义 =====')
const chunks3 = [{ choices: [{ delta: { content: '<think>思考A：先看结构</think>正文B' } }] }]
global.fetch = async () => sseResponse(chunks3)
const deltas3 = []
const { content: returned3 } = await engine.callModel(model, [{ role: 'user', content: 'x' }], 0.4, undefined, (t) => deltas3.push(t))
ok('<think> 整块被提取回调', deltas3.length === 1 && deltas3[0] === '思考A：先看结构', JSON.stringify(deltas3))
let buf3 = ''
deltas3.forEach(t => { buf3 += t })
ok('+= 消费得到整块思考', buf3 === '思考A：先看结构', JSON.stringify(buf3))
ok('返回值剥掉思考只剩正文', returned3 === '正文B', JSON.stringify(returned3))

console.log('\n===== 4. 非流式回退：reasoning_content 整块 =====')
global.fetch = async () => ({
  ok: true, status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({ choices: [{ message: { content: '正文C', reasoning_content: '思考C：整体思路' } }] }),
  text: async () => '',
})
const deltas4 = []
const { content: returned4 } = await engine.callModel(model, [{ role: 'user', content: 'x' }], 0.4, undefined, (t) => deltas4.push(t))
ok('非流式整块回调', deltas4.length === 1 && deltas4[0] === '思考C：整体思路', JSON.stringify(deltas4))
let buf4 = ''
deltas4.forEach(t => { buf4 += t })
ok('+= 消费得到整块', buf4 === '思考C：整体思路', JSON.stringify(buf4))
ok('返回正文', returned4 === '正文C', JSON.stringify(returned4))

console.log('\n===== 5. ChatArea 真实 onThinking 回调体：动态执行验证 =====')
const chatSrc = fs.readFileSync(path.join(root, 'src', 'components', 'ChatArea.tsx'), 'utf8')
ok('源码使用 += 增量累积', chatSrc.includes('fullThinkingRef.current += delta'))
ok('源码不再用 = 覆盖', !chatSrc.includes('fullThinkingRef.current = text'))
ok('源码含 300ms 节流', chatSrc.includes('lastThinkFlush'))

// 提取 onThinking: (delta) => { ... } 块（大括号平衡）
function extractBlock(src, startMarker) {
  const i = src.indexOf(startMarker)
  if (i < 0) return null
  const open = src.indexOf('{', i)
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open + 1, j) }
  }
  return null
}
const body = extractBlock(chatSrc, 'onThinking: (delta) => {')
ok('成功提取 onThinking 回调体', !!body, '提取结果 ' + (body ? body.length + ' 字符' : 'null'))

if (body) {
  const jsBody = body.replace(/!\./g, '.') // 去掉 TS 非空断言
  // mock 环境：conversation / assistantMessage / updateMessage / useAppStore / fullThinkingRef
  function makeEnv() {
    const msg = { id: 'm1', content: '' }
    const conv = { id: 'c1', messages: [msg] }
    const updateCalls = []
    const fullThinkingRef = { current: '' }
    // v26.9.47 stall 修复后 onThinking 体内引用了这些闭包变量，mock 需提供桩
    const toolInProgressRef = { current: false }
    const armStallTimer = () => {}
    const controller = { signal: { aborted: false } }
    const stallSeconds = 300
    const factory = new Function('fullThinkingRef', 'conversation', 'assistantMessage', 'updateMessage', 'useAppStore', 'toolInProgressRef', 'armStallTimer', 'controller', 'stallSeconds', `
      let lastThinkFlush = 0
      return (delta) => { ${jsBody} }
    `)
    const onThinking = factory(
      fullThinkingRef, conv, msg,
      (cid, mid, content) => updateCalls.push({ cid, mid, content }),
      { getState: () => ({ conversations: [conv] }) },
      toolInProgressRef, armStallTimer, controller, stallSeconds
    )
    return { onThinking, updateCalls, fullThinkingRef, msg, conv }
  }

  // 5a. 每片间隔 400ms（>300ms 节流窗口）：每片都刷 UI
  {
    const realNow = Date.now
    let fakeNow = 1000
    Date.now = () => (fakeNow += 400)
    const env = makeEnv()
    deltas1.forEach(env.onThinking)
    Date.now = realNow
    ok('400ms 间隔：每片都刷新 UI', env.updateCalls.length === deltas1.length, `刷新 ${env.updateCalls.length} 次`)
    const last = env.updateCalls[env.updateCalls.length - 1]
    ok('UI 最终显示 <think>完整思考</think>', last && last.content === `<think>${fullThink}</think>`, last ? JSON.stringify(last.content) : '无')
    ok('fullThinkingRef 累积完整（落盘 withThinking 不丢尾）', env.fullThinkingRef.current === fullThink, JSON.stringify(env.fullThinkingRef.current))
    ok('更新落在正确的会话/消息上', last && last.cid === 'c1' && last.mid === 'm1')
  }

  // 5b. 每片间隔 100ms（<300ms）：节流生效，但 fullThinkingRef 不丢尾
  {
    const realNow = Date.now
    let fakeNow = 1000
    Date.now = () => (fakeNow += 100)
    const env = makeEnv()
    deltas1.forEach(env.onThinking)
    Date.now = realNow
    // 1100 放行、1200/1300 拦、1400 恰好=窗口被放行（300<300 为 false）、之后拦 → 共 2 次
    ok('100ms 间隔：节流生效（刷新次数远小于分片数）', env.updateCalls.length <= 2, `刷新 ${env.updateCalls.length} 次`)
    ok('节流不丢尾：fullThinkingRef 仍是完整思考', env.fullThinkingRef.current === fullThink, JSON.stringify(env.fullThinkingRef.current))
  }

  // 5c. 已闭合 think 块 + 状态文字：clean 只清思考区、保留其余
  {
    const realNow = Date.now
    let fakeNow = 1000
    Date.now = () => (fakeNow += 400)
    const env = makeEnv()
    env.msg.content = '<think>旧思考</think>🔧 模型正在调用 write_file...'
    env.onThinking('新思')
    Date.now = realNow
    const last = env.updateCalls[env.updateCalls.length - 1]
    ok('旧思考被清除、状态行保留、新思考拼接',
      last && last.content === '🔧 模型正在调用 write_file...<think>新思</think>',
      last ? JSON.stringify(last.content) : '无')
  }

  // 5d. 未闭合 think 块（思考进行中）：真实序列——先刷一片、再刷一片，UI 从头重建全量
  {
    const realNow = Date.now
    let fakeNow = 1000
    Date.now = () => (fakeNow += 400)
    const env = makeEnv()
    env.onThinking('部分思考')
    env.onThinking('，继续')
    Date.now = realNow
    const last = env.updateCalls[env.updateCalls.length - 1]
    ok('未闭合块被重建为 <think>部分思考，继续</think>',
      last && last.content === '<think>部分思考，继续</think>',
      last ? JSON.stringify(last.content) : '无')
  }

  // 5e. 空增量被忽略
  {
    const env = makeEnv()
    env.onThinking('')
    ok('空增量不触发任何更新', env.updateCalls.length === 0 && env.fullThinkingRef.current === '')
  }
}

console.log('\n===== 6. 多轮 callModel：消费方跨轮累积 =====')
let i6 = 0
const rounds = [thinkParts.slice(0, 3), thinkParts.slice(3)]
global.fetch = async () => {
  const parts = rounds[Math.min(i6, rounds.length - 1)]
  i6++
  return sseResponse(parts.map(t => ({ choices: [{ delta: { reasoning_content: t } }] })))
}
const buf6 = []
for (let r = 0; r < 2; r++) {
  await engine.callModel(model, [{ role: 'user', content: 'x' }], 0.4, undefined, (t) => buf6.push(t))
}
ok('两轮回调拼接 = 完整思考（消费方不重置缓冲）', buf6.join('') === fullThink, JSON.stringify(buf6.join('')))

// 清理
try { fs.unlinkSync(enginePath) } catch {}

console.log('\n===== 结果：通过 ' + pass + ' 项，失败 ' + fails.length + ' 项 =====')
if (fails.length) {
  console.log('失败项：')
  fails.forEach(f => console.log(' - ' + f))
  process.exit(1)
}
})().catch(e => {
  console.log('\n致命错误:', (e && e.stack) || e)
  process.exit(1)
})
