/**
 * 对话页工具链测试（ChatArea）
 *
 * 背景：用户反复反馈「在对话界面里 AI 说无法创建文件」。
 * 根因是 ChatArea 原本只做单轮 chat，压根没有 agent loop；提示词还如实告诉模型
 * 「本模式不挂载文件读写工具」，于是模型理直气壮地拒绝执行。
 *
 * 本测试做静态源码断言：确保 ChatArea 真的接上了 runAgentLoop，并且
 *   - 工具模式是默认开启的（chatToolsEnabled !== false）
 *   - 落盘目录走 IPC 解析
 *   - 工具调用会以 system 消息回显给用户
 *   - 提示词不再把用户支到「任务」视图
 *   - 主进程 / preload / 类型声明三处的 getDefaultWorkDir 通道齐备
 */
const fs = require('fs')
const path = require('path')

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')) }
}

const root = path.join(__dirname, '..')
const chat = fs.readFileSync(path.join(root, 'src', 'components', 'ChatArea.tsx'), 'utf8')
const main = fs.readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8')
const dts = fs.readFileSync(path.join(root, 'src', 'types', 'electron.d.ts'), 'utf8')
const types = fs.readFileSync(path.join(root, 'src', 'types', 'index.ts'), 'utf8')
const settings = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsPanel.tsx'), 'utf8')

console.log('\n===== 1. ChatArea 必须真正调用 Agent Loop =====')
ok('导入了 runAgentLoop', /const\s*\{\s*runAgentLoop\s*\}\s*=\s*await\s+import\(/.test(chat))
ok('确实调用了 runAgentLoop(', /await\s+runAgentLoop\(/.test(chat))
ok('工具模式默认开启', /config\.chatToolsEnabled\s*!==\s*false/.test(chat))
ok('传入了工作目录', /await\s+runAgentLoop\(\s*\n?\s*model,\s*\n?\s*workDir,/.test(chat))

console.log('\n===== 2. 工具调用必须回显给用户（一句话状态提示） =====')
ok('onToolUse 回调存在', /onToolUse\s*(?::|=)/.test(chat))
// 轮 I（2026-09-22）：system 消息改为「工具动作行」——onStatus upsert ⏳ 进行中行，
// onToolUse 完成时 describeToolDone 原地转完成式；describeToolUse 只服务进行中文案
ok('工具步骤以 system 消息插入（upsert）', /role:\s*'system'/.test(chat) && /describeToolUse\(toolCall\.tool,\s*toolCall\.args\)/.test(chat))
ok('进行中行带 ⏳ 前缀 upsert', /⏳\s*\$\{label\.title\}/.test(chat) && /upsertToolLine/.test(chat))
ok('完成式文案 describeToolDone', /function\s+describeToolDone\(/.test(chat) && /describeToolDone\(tool,\s*args,\s*workDir\)/.test(chat))
ok('完成式路径补全为完整路径（joinWorkPath）', /function\s+joinWorkPath\(/.test(chat))
ok('write_file → 正在写入文件', /case\s*'write_file':\s*return\s*\{\s*title:\s*`正在写入文件/.test(chat))
ok('edit_file → 正在修改文件', /case\s*'edit_file':\s*return\s*\{\s*title:\s*`正在修改文件/.test(chat))
ok('read_file → 正在读取文件', /case\s*'read_file':\s*return\s*\{\s*title:\s*`正在读取文件/.test(chat))
ok('不使用 emoji 图标前缀', !/title:\s*`[📝✏️📖📂🔍⚡🌐🔧]/.test(chat))
const describeFn = (chat.match(/function\s+describeToolUse[\s\S]*?\n\}/) || [''])[0]
ok('只显示文件名而非全路径', describeFn.includes('.pop()') && describeFn.includes('.split('))

console.log('\n===== 2c. 引擎状态必须翻译成中文提示 =====')
ok('存在 translateStatus', /export function translateStatus\(/.test(chat))
ok('onStatus 走 translateStatus', /translateStatus\(status\)/.test(chat))
ok('别名归一（Write→write_file）', /write:\s*'write_file'/.test(chat))
const onStatusBody = ((chat.match(/const onStatus[\s\S]*?\n        \}/) || [''])[0]).replace(/\/\/[^\n]*/g, '')
ok('状态提示运行时不带 emoji', !/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u.test(onStatusBody))

console.log('\n===== 2b. 对话里不得出现任何代码块 =====')
ok('存在 dropCodeBlocks 清洗', /function\s+dropCodeBlocks\(/.test(chat))
ok('清洗后不含 ``` 围栏', /replace\(\/```/.test(chat))
ok('行号式裸代码墙清洗存在（2026-09-23 用户截图实证）', /\\d\{1,4\}\[\.、\)\]/.test(chat))
ok('提示语为「正在写入文件」', /正在写入文件/.test(chat))
ok('折叠占位为「📄 代码草稿（未写入文件）」', /const CODE_NOTE = '📄 代码草稿（未写入文件）'/.test(chat))
ok('提示词明令禁止贴代码', /对话里永远不要出现代码/.test(chat))
ok('提示词禁止贴 diff', /不要贴 diff/.test(chat))

console.log('\n===== 3. 提示词不得再把用户支到「任务」视图 =====')
ok('存在对话页专用前缀 CHAT_AGENT_PREFIX', /CHAT_AGENT_PREFIX\s*=/.test(chat))
ok('声明拥有真实工具', /拥有真实的文件读写与命令执行工具/.test(chat))
ok('不再说「不要切到任务视图」式引导', !/切到左侧|切到「任务」|到「任务」.*新建/.test(chat))
ok('纯聊天提示词不再宣称无工具', !/此模式不挂载文件读写工具/.test(chat))

console.log('\n===== 4. 落盘目录解析 =====')
ok('resolveChatWorkDir 存在', /resolveChatWorkDir\s*=/.test(chat))
ok('优先用户配置 chatWorkDir', /config\.chatWorkDir/.test(chat))
ok('回退到 IPC getDefaultWorkDir', /getDefaultWorkDir\(\)/.test(chat))

console.log('\n===== 5. 主进程 / preload / 类型 三处通道齐备 =====')
ok('main.ts 注册 app:getDefaultWorkDir', /ipcMain\.handle\(\s*'app:getDefaultWorkDir'/.test(main))
ok('main.ts 回退链含 documents', /'documents'/.test(main))
ok('main.ts 回退链含 desktop', /'desktop'/.test(main))
ok('main.ts 兜底 userData', /app\.getPath\('userData'\)/.test(main))
ok('preload 暴露 getDefaultWorkDir', /getDefaultWorkDir:\s*\(\)\s*=>/.test(preload))
ok('electron.d.ts 声明 getDefaultWorkDir', /getDefaultWorkDir:\s*\(\)\s*=>\s*Promise<string>/.test(dts))

console.log('\n===== 6. 配置字段与设置界面 =====')
ok('AppConfig 有 chatWorkDir', /chatWorkDir\?:/.test(types))
ok('AppConfig 有 chatToolsEnabled', /chatToolsEnabled\?:/.test(types))
ok('AppConfig 有 chatAllowExec', /chatAllowExec\?:/.test(types))
ok('设置页有「对话页工具」卡片', /对话页工具/.test(settings))
ok('设置页可切换启用/禁用', /chatToolsEnabled:\s*e\.target\.value/.test(settings))
ok('设置页可配置工作目录', /chatWorkDir:\s*e\.target\.value/.test(settings))
ok('设置页可选择目录', /dialog\.selectFolder\(\)/.test(settings))

console.log('\n===== 7. 执行权限默认保守 =====')
ok('命令执行默认关闭（需显式开启）', /config\.chatAllowExec\s*===\s*true/.test(chat))

console.log('\n===== 8. 工具行可展开详情（2026-09-23 严格按照用户视频） =====')
ok('Message 类型有 toolDetail 字段', /toolDetail\?:\s*ToolDetail/.test(types))
ok('ToolDetail 类型已导出（diff/stat/text/output）', /export interface ToolDetail \{[\s\S]*?kind:[\s\S]*?stat\?[\s\S]*?diff\?[\s\S]*?text\?/.test(types))
ok('buildToolDetail 构造函数存在', /function\s+buildToolDetail\(/.test(chat))
ok('computeLineDiff 行级 diff 存在', /function\s+computeLineDiff\(/.test(chat))
ok('onToolUse 把 detail 写进消息（upsert 路径）', /toolDetail\s*\}|\{\s*toolDetail\s*\}/.test(chat) && /updateMessage\(conversation\.id,\s*runningToolMsgId,\s*content,\s*\{\s*toolDetail\s*\}\)/.test(chat))
ok('addMessage 消息体带 toolDetail', /role:\s*'system',[\s\S]{0,120}toolDetail,/.test(chat))
ok('ToolActionLine 接收 detail prop', /ToolActionLine[^>]*detail=\{message\.toolDetail\}/.test(chat))
ok('编辑行带 +N -M 统计徽标', /\+\{detail\.stat\.added\}[\s\S]{0,80}-\{detail\.stat\.removed\}/.test(chat))
ok('行尾展开箭头（chevron 旋转）', /rotate-90/.test(chat) && /ChevronRight\s*size=\{12\}/.test(chat))
ok('diff 行红删绿增着色', /bg-red-50 text-red-600/.test(chat) && /bg-green-50 text-green-700/.test(chat))
ok('命令面板含 bash 标签与命令本体', /bash/.test(chat) && /detail\.text \|\| '\(空命令\)'/.test(chat))

// 运行时验证：提取纯函数 → typescript 转译 → 直接执行（源码含类型注解，必须先转译）
;(function runtimeChecks() {
  let ts
  try { ts = require(path.join(root, 'node_modules', 'typescript')) } catch { ok('加载 typescript 包', false, 'require 失败'); return }
  function grab(name) {
    const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}')
    return (chat.match(re) || [''])[0]
  }
  // TOOL_ALIAS 常量 + normalizeToolName（buildToolDetail 入口做别名归一，2026-09-23 用户截图反馈「已处理」+🔧）
  const aliasConst = (chat.match(/const TOOL_ALIAS[^=]*= \{[\s\S]*?\n\}/) || [''])[0]
  const codeNoteConst = (chat.match(/const CODE_NOTE = .+/) || [''])[0]
  const raw = [codeNoteConst, aliasConst, grab('normalizeToolName'), grab('escapeRegExp'), grab('cutDetailText'), grab('computeLineDiff'), grab('buildToolDetail'), grab('dropCodeBlocks')].join('\n')
  let fns
  try {
    const js = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
    fns = new Function(js + '\nreturn { computeLineDiff, buildToolDetail, cutDetailText, dropCodeBlocks, CODE_NOTE }')()
  } catch (e) {
    ok('运行时提取纯函数', false, String(e)); return
  }
  // 裸代码墙：行号式代码 → 整段折叠；普通编号列表 → 原样保留
  const bare = '255. function draw() {\n257. for (var y = 0; y < SIZE; y++)\n259. if (board[y][x] !== 0) drawStone(x, y);\n263. function checkWin() {'
  const droppedBare = fns.dropCodeBlocks('说明文字\n' + bare + '\n结束')
  ok('行号式裸代码墙被折叠', droppedBare.includes('代码草稿') && !droppedBare.includes('drawStone'), droppedBare.slice(0, 80))
  const steps = '1. 打开设置\n2. 点击模型\n3. 选择默认权限\n4. 保存并重启'
  const keptSteps = fns.dropCodeBlocks(steps)
  ok('普通编号列表不误伤', keptSteps.includes('打开设置') && keptSteps.includes('保存并重启'), keptSteps.slice(0, 60))
  // 引擎「未保存代码」判定：思考区草稿不算违规、正文代码才算（2026-09-23 修复静默终止 bug）
  ;(function thinkExemptCheck() {
    const eng = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'agentEngine.ts'), 'utf8')
    function grabEng(name) {
      const i = eng.indexOf('function ' + name + '(')
      if (i === -1) return ''
      const e = eng.indexOf('\n}', i)
      return eng.slice(i, e + 2)
    }
    const raw2 = [grabEng('stripThinkForCheck'), grabEng('hasUnsavedCodeBlock'), grabEng('isWriteIntentTask')].join('\n')
    try {
      const js2 = ts.transpileModule(raw2, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
      const f2 = new Function(js2 + '\nreturn { hasUnsavedCodeBlock, isWriteIntentTask, stripThinkForCheck }')()
      const big = '```html\n' + 'x'.repeat(200) + '\n```'
      ok('思考区里的代码草稿不算「未保存代码」违规', f2.hasUnsavedCodeBlock('<think>让我写代码\n' + big + '\n</think>\n好了') === false)
      ok('正文里的代码块仍算违规', f2.hasUnsavedCodeBlock('这是代码：\n' + big) === true)
      ok('未闭合思考区（流式中）同样豁免', f2.hasUnsavedCodeBlock('<think>写草稿\n' + big) === false)
      ok('写入意图识别（写网页/改文件 → true）', f2.isWriteIntentTask('写一个围棋网页') === true && f2.isWriteIntentTask('帮我改下这个 html 文件') === true)
      ok('纯咨询任务不误伤（不会要求写文件）', f2.isWriteIntentTask('什么是闭包') === false)
    } catch (e) {
      ok('引擎纯函数运行时提取', false, String(e))
    }
  })()
  ok('运行时提取纯函数', true)
  // 行级 LCS：中间行改动只产生 1+1 行变化（视频样例：+2 -2）
  const d1 = fns.computeLineDiff('a\nold1\nb\nc', 'a\nnew1\nb\nc')
  ok('LCS diff 精确到行（-old +new）', d1.filter(x => x.t === '-').length === 1 && d1.filter(x => x.t === '+').length === 1, JSON.stringify(d1))
  // buildToolDetail：edit_file → stat 与 diff
  const det = fns.buildToolDetail('edit_file', { path: 'x.ts', old_str: 'a\nb', new_str: 'a\nc' }, { ok: true, output: '已编辑 x.ts' })
  ok('edit_file 生成 stat 统计', det.kind === 'edit' && det.stat.added === 1 && det.stat.removed === 1, JSON.stringify(det.stat))
  ok('edit_file diff 含 +/- 行', det.diff.some(x => x.t === '-' && x.s === 'b') && det.diff.some(x => x.t === '+' && x.s === 'c'))
  // write_file → 全绿新增
  const det2 = fns.buildToolDetail('write_file', { path: 'y.js', content: 'x\ny\nz' }, { ok: true, output: 'ok' })
  ok('write_file 全部为 + 行（3 行）', det2.kind === 'edit' && det2.stat.added === 3 && det2.stat.removed === 0 && det2.diff.every(x => x.t === '+'))
  // run_command → 命令本体 + 输出
  // 别名归一（2026-09-23 用户截图反馈：引擎发 write 别名时旧版落 default「已处理」+🔧）
  const detAlias = fns.buildToolDetail('write', { path: 'z.html', content: 'a\nb' }, { ok: true, output: 'ok' })
  ok('别名工具名归一（write→write_file 全绿 diff）', detAlias.kind === 'edit' && detAlias.stat.added === 2 && detAlias.diff.every(x => x.t === '+'), JSON.stringify(detAlias.stat))
  const det3 = fns.buildToolDetail('run_command', { command: 'echo hi' }, { ok: true, output: 'hi' })
  ok('run_command 面板含命令与输出', det3.kind === 'command' && det3.text === 'echo hi' && det3.output === 'hi')
  // 超长文本截断保护
  const big = 'x'.repeat(5000)
  const det4 = fns.buildToolDetail('read_file', { path: 'big.txt' }, { ok: true, output: big })
  ok('大输出截断（≤2000+提示）', det4.text.length < 2200 && det4.text.includes('已截断'))
  // 大文件 LCS 规模保护（退化不卡死）
  const t0 = Date.now()
  const det5 = fns.computeLineDiff(Array.from({ length: 500 }, (_, i) => 'a' + i).join('\n'), Array.from({ length: 500 }, (_, i) => 'b' + i).join('\n'))
  ok('大规模 diff 退化保护（<1s）', Date.now() - t0 < 1000 && det5.length > 0)
})()

console.log('\n===== 结果：通过 ' + pass + ' 项，失败 ' + fails.length + ' 项 =====')
if (fails.length) {
  console.log('失败项：')
  fails.forEach(f => console.log(' - ' + f))
  process.exit(1)
}
