import { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, Notification, nativeTheme, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import {
  SecurityConfig,
  assertInsideRoot,
  resolveInsideRoot,
  evaluateFilePath,
  evaluateCommand,
  evaluateUrl,
  shouldTrash,
  needsBatchApproval,
  shouldBackup,
  backupQuotaBytes,
  setPolicyBypass,
} from './security'
import { webSearch, webFetch, summarizePage } from './websearch'
import {
  skillsDir,
  listSkills,
  installSkill,
  removeSkill,
  setSkillEnabled,
  readSkill,
  isSafeSlug,
  type SkillMeta,
} from './skills'

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  const userDataPath = app.getPath('userData')
  const MODELS_FILE = path.join(userDataPath, 'models.json')
  const CONFIG_FILE = path.join(userDataPath, 'config.json')
  const CONVERSATIONS_DIR = path.join(userDataPath, 'conversations')
  const TASKS_FILE = path.join(userDataPath, 'tasks.json')
  const BACKUP_DIR = path.join(userDataPath, 'backups')
  const SKILLS_DIR = skillsDir(userDataPath)
  const WINDOW_STATE_FILE = path.join(userDataPath, 'window-state.json')

  // 改名（Many AI → deepwork）后的一次性数据迁移：新目录还没有配置时，把旧目录的数据搬过来
  function migrateLegacyData() {
    try {
      const legacyDir = path.join(app.getPath('appData'), 'many-ai')
      if (legacyDir === userDataPath) return
      if (fs.existsSync(CONFIG_FILE) || !fs.existsSync(legacyDir)) return
      ensureDir(userDataPath)
      for (const name of ['models.json', 'config.json', 'tasks.json']) {
        const src = path.join(legacyDir, name)
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(userDataPath, name))
      }
      const legacyConversations = path.join(legacyDir, 'conversations')
      if (fs.existsSync(legacyConversations)) {
        fs.cpSync(legacyConversations, CONVERSATIONS_DIR, { recursive: true })
      }
      console.log('[deepwork] 已迁移旧版本数据目录:', legacyDir)
    } catch (e) {
      console.error('[deepwork] 旧数据迁移失败:', e)
    }
  }
  migrateLegacyData()

  function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  // 损坏配置文件的保留快照上限（超出后删最旧的）
  const MAX_CORRUPT_SNAPSHOTS = 3

  function readJSON(filePath: string, fallback: any = null) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8').trim()
        // 空文件按「无数据」处理，避免 JSON.parse('') 抛错后被误判为文件损坏
        if (!raw) return fallback
        return JSON.parse(raw)
      }
    } catch (e) {
      console.error('readJSON error:', filePath, e)
      // 损坏文件保留现场，便于人工恢复（避免后续写入直接覆盖证据）
      // 只保留最近 3 份快照：早期版本每次读取都新建副本，文件反复损坏会无限堆积
      try {
        if (fs.existsSync(filePath)) {
          fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`)
          const dir = path.dirname(filePath)
          const base = path.basename(filePath)
          const snaps = fs.readdirSync(dir)
            .filter(n => n.startsWith(`${base}.corrupt-`))
            .sort()
          while (snaps.length > MAX_CORRUPT_SNAPSHOTS) {
            const old = snaps.shift()!
            try { fs.unlinkSync(path.join(dir, old)) } catch { /* 忽略清理失败 */ }
          }
        }
      } catch { /* 保留现场失败不影响主流程 */ }
    }
    return fallback
  }

  // 原子写：先写临时文件再 rename，避免崩溃/断电留下半截 JSON 导致数据全丢
  function writeJSON(filePath: string, data: any) {
    // 临时名必须唯一：早期版本用 `pid.tmp` 固定名，同一进程内并发写多份配置会互相覆盖
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.floor(Math.random() * 1e6)}.tmp`
    try {
      ensureDir(path.dirname(filePath))
      const content = JSON.stringify(data, null, 2)
      fs.writeFileSync(tmp, content, 'utf-8')
      // Windows 下目标文件可能被占用，rename 失败时回退为直接写
      try {
        fs.renameSync(tmp, filePath)
      } catch {
        // 回退也要先写临时文件再 rename：直接 writeFileSync 会先把目标清空，
        // 中途失败就会留下空文件，比半截 JSON 更糟
        const tmp2 = `${tmp}.fallback`
        fs.writeFileSync(tmp2, content, 'utf-8')
        try {
          fs.renameSync(tmp2, filePath)
        } catch {
          fs.writeFileSync(filePath, content, 'utf-8')
          try { fs.unlinkSync(tmp2) } catch { /* 忽略清理失败 */ }
        }
      }
      return true
    } catch (e) {
      console.error('writeJSON error:', filePath, e)
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* 忽略 */ }
      return false
    }
  }

  function createWindow() {
    // 恢复上次的窗口大小与位置；越界/损坏时回退默认值
    let winState: { width?: number; height?: number; x?: number; y?: number; maximized?: boolean } = {}
    try {
      const raw = fs.readFileSync(WINDOW_STATE_FILE, 'utf-8').trim()
      if (raw) winState = JSON.parse(raw) || {}
    } catch { /* 首次启动或文件损坏，用默认值 */ }

    // workArea 拿不到时回退默认值（createWindow 只在 app ready 后调用，正常都能拿到）
    let workArea: Electron.Rectangle | null = null
    try { workArea = screen.getPrimaryDisplay().workArea } catch { /* 忽略 */ }
    const maxW = workArea ? workArea.width : 1200
    const maxH = workArea ? workArea.height : 800
    const clamp = (v: number | undefined, min: number, max: number, dft: number) =>
      (typeof v === 'number' && isFinite(v) ? Math.min(Math.max(Math.round(v), min), max) : dft)
    const width = clamp(winState.width, 680, maxW, Math.min(1200, maxW))
    const height = clamp(winState.height, 480, maxH, Math.min(800, maxH))
    // 位置只在完整落在某个显示器工作区内时才恢复，防止拔掉显示器后窗口“消失”
    let x: number | undefined
    let y: number | undefined
    if (typeof winState.x === 'number' && typeof winState.y === 'number' && isFinite(winState.x) && isFinite(winState.y)) {
      const onScreen = screen.getAllDisplays().some(d => {
        const a = d.workArea
        return winState.x! >= a.x && winState.y! >= a.y && winState.x! + width <= a.x + a.width && winState.y! + height <= a.y + a.height
      })
      if (onScreen) { x = Math.round(winState.x); y = Math.round(winState.y) }
    }

    mainWindow = new BrowserWindow({
      width,
      height,
      ...(x !== undefined ? { x, y } : {}),
      // 默认 1200×800；最小 680×480，小窗口时渲染层会自动收起侧边栏（见 App.tsx 的 resize 监听）
      minWidth: 680,
      minHeight: 480,
      title: 'deepwork',
      // 窗口/任务栏图标：打包后位于 resources/icon.png（extraResources）。
      // exe 内嵌图标要重新打包才能换，运行时 icon 让免安装目录同步 icon.png 即可生效。
      icon: (() => {
        const candidates = [
          path.join(process.resourcesPath, 'icon.png'),
          path.join(__dirname, '..', '..', 'resources', 'icon.png'),
        ]
        for (const p of candidates) {
          try { if (fs.existsSync(p)) return p } catch { /* 忽略 */ }
        }
        return undefined
      })(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // 模型 API 由渲染进程直连各家 OpenAI 兼容端点，需要跨域，故关闭同源限制。
        // 风险已通过 contextIsolation + 无 nodeIntegration + IPC 侧安全策略收敛。
        webSecurity: false,
      },
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      backgroundColor: '#ffffff',
      show: false,
    })

    // 安全加固：禁止窗口被导航到外部地址（避免误点链接导致应用白屏/被劫持）
    mainWindow.webContents.on('will-navigate', (e, target) => {
      const current = mainWindow?.webContents.getURL() || ''
      if (target !== current) {
        e.preventDefault()
        console.warn('[deepwork] 已拦截窗口导航:', target.slice(0, 120))
      }
    })
    // 新窗口一律用系统浏览器打开，不在应用内创建（避免出现无 preload 的裸窗口）
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })

    const indexPath = path.join(__dirname, '../dist/index.html')
    mainWindow.loadFile(indexPath)
    mainWindow.once('ready-to-show', () => {
      // 上次是最大化则恢复最大化，否则按记录的 bounds 显示
      if (winState.maximized) mainWindow?.maximize()
      mainWindow?.show()
    })
    // 关窗时记住窗口大小与位置（最大化只记状态，不记 bounds）
    mainWindow.on('close', () => {
      try {
        if (!mainWindow) return
        const maximized = mainWindow.isMaximized()
        const bounds = maximized ? { width: 1200, height: 800 } : mainWindow.getBounds()
        fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify({ ...bounds, maximized }, null, 2))
      } catch { /* 保存失败不影响退出 */ }
    })

    mainWindow.on('closed', () => { mainWindow = null })
  }

  function setupIPC() {
    ipcMain.handle('window:minimize', () => mainWindow?.minimize())
    ipcMain.handle('window:maximize', () => {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize()
      else mainWindow?.maximize()
    })
    ipcMain.handle('window:close', () => mainWindow?.close())
    ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

    ipcMain.handle('models:getAll', () => readJSON(MODELS_FILE, { models: [], providers: [] }))
    ipcMain.handle('models:save', (_, data) => writeJSON(MODELS_FILE, data))

    ipcMain.handle('config:get', (_, key) => {
      const cfg = readJSON(CONFIG_FILE, {})
      return key ? cfg[key] : cfg
    })
    ipcMain.handle('config:set', (_, key, value) => {
      const cfg = readJSON(CONFIG_FILE, {})
      cfg[key] = value
      return writeJSON(CONFIG_FILE, cfg)
    })

    ipcMain.handle('conversations:getAll', () => {
      ensureDir(CONVERSATIONS_DIR)
      try {
        return fs.readdirSync(CONVERSATIONS_DIR)
          .filter(f => f.endsWith('.json'))
          .map(f => readJSON(path.join(CONVERSATIONS_DIR, f)))
          .filter(Boolean)
          .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
      } catch { return [] }
    })
    // 对话 id 参与拼路径，必须限制字符集，避免 "../../config" 之类越界读写其他数据文件
    function convPathFor(id: any): string | null {
      const s = String(id ?? '')
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(s)) return null
      return path.join(CONVERSATIONS_DIR, `${s}.json`)
    }
    ipcMain.handle('conversations:get', (_, id) => {
      const fp = convPathFor(id)
      return fp ? readJSON(fp) : null
    })
    ipcMain.handle('conversations:save', (_, id, data) => {
      const fp = convPathFor(id)
      if (!fp) return false
      ensureDir(CONVERSATIONS_DIR)
      return writeJSON(fp, data)
    })
    ipcMain.handle('conversations:delete', (_, id) => {
      const fp = convPathFor(id)
      if (!fp) return false
      // Windows 下文件被占用/只读会抛 EPERM，未捕获会让渲染进程的 invoke 一直 reject
      try {
        if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true }
        return false
      } catch (e) { console.error('conversations:delete error:', e); return false }
    })

    // 数据管理 - 读取目录树
    ipcMain.handle('fs:readDirTree', (_, dirPath: string) => {
      // 节点上限：早期版本只限深度不限规模，对着 C:\ 或大仓库调用会一次性
      // stat 上万个条目，主进程被同步 IO 卡死十几秒且回传巨型数组
      const MAX_NODES = 4000
      // 已知的巨型/无意义目录，直接跳过（与 node_modules 同级处理）
      const SKIP_DIRS = new Set([
        'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache',
        '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode',
        '$Recycle.Bin', 'System Volume Information', 'Windows', 'AppData',
      ])
      let nodeCount = 0
      function readTree(dir: string, depth: number = 0): any[] {
        if (depth > 5 || nodeCount >= MAX_NODES) return [] // 限制深度与规模
        try {
          const items = fs.readdirSync(dir)
          return items
            .filter(item => !item.startsWith('.') && !SKIP_DIRS.has(item))
            .map(item => {
              if (nodeCount >= MAX_NODES) return null
              const fullPath = path.join(dir, item)
              try {
                // 用 lstat 而非 stat：不跟随符号链接，从根本上杜绝软链成环导致无限递归
                const stat = fs.lstatSync(fullPath)
                if (stat.isSymbolicLink()) return null
                nodeCount++
                const isDir = stat.isDirectory()
                return {
                  name: item,
                  path: fullPath,
                  isDir,
                  size: stat.size,
                  modified: stat.mtime,
                  children: isDir ? readTree(fullPath, depth + 1) : undefined,
                }
              } catch {
                return null
              }
            })
            .filter(Boolean)
            .sort((a: any, b: any) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
              return a.name.localeCompare(b.name)
            })
        } catch {
          return []
        }
      }
      const root = String(dirPath || '').trim()
      if (!root || !fs.existsSync(root)) return []
      if (!fs.statSync(root).isDirectory()) return []
      return readTree(root)
    })

    ipcMain.handle('shell:openExternal', (_, url: string) => {
      // 协议白名单：只允许用系统默认浏览器打开 http(s)，拦截 file:// 等本地协议
      const raw = String(url || '').trim()
      let scheme = ''
      try { scheme = new URL(raw).protocol.toLowerCase() } catch { return }
      if (scheme !== 'http:' && scheme !== 'https:') {
        console.warn('[deepwork] 已拦截非 http(s) 外链打开请求:', raw.slice(0, 120))
        return
      }
      return shell.openExternal(raw)
    })
    ipcMain.handle('shell:showItemInFolder', (_, fullPath: string) => {
      try { shell.showItemInFolder(fullPath); return true } catch (e) { console.error('showItemInFolder error:', e); return false }
    })
    ipcMain.handle('shell:openPath', async (_, fullPath: string) => {
      // 路径不存在或关联程序缺失时 openPath 会 reject/报错，必须兜住
      try {
        if (!fullPath || !fs.existsSync(fullPath)) return { ok: false, error: '路径不存在' }
        const err = await shell.openPath(fullPath)
        return err ? { ok: false, error: err } : { ok: true }
      } catch (e: any) { return { ok: false, error: e?.message || String(e) } }
    })

    ipcMain.handle('dialog:selectFolder', async () => {
      if (!mainWindow) return null
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: '选择工作文件夹',
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })

    // 默认工作目录：对话页（ChatArea）挂载了真实工具链，需要一个落盘位置。
    // 优先用「文档」目录，不存在时回退「桌面」→ userData，保证一定拿得到一个存在的目录。
    ipcMain.handle('app:getDefaultWorkDir', async () => {
      const candidates = ['documents', 'desktop', 'downloads'] as const
      for (const name of candidates) {
        try {
          const p = app.getPath(name as any)
          if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p
        } catch { /* 某些系统上该目录不存在，继续尝试下一个 */ }
      }
      try { return app.getPath('userData') } catch { return '' }
    })

    ipcMain.handle('dialog:selectFiles', async () => {
      if (!mainWindow) return []
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        title: '添加文件',
      })
      if (result.canceled || result.filePaths.length === 0) return []
      return result.filePaths
    })

    ipcMain.handle('dialog:readFileContent', (_, filePath: string) => {
      try {
        // 先过安全中心的文件策略（黑名单 / 白名单），附件读取不再是绕过口子
        const guardErr = guardFile(filePath)
        if (guardErr) return { ok: false, error: guardErr }

        const stat = fs.statSync(filePath)
        if (stat.size > 1024 * 1024) return { ok: false, error: '文件过大 (>1MB)' }
        const base = path.basename(filePath)
        const ext = path.extname(filePath).toLowerCase()
        const textExts = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.csv', '.log', '.yml', '.yaml', '.xml', '.sh', '.bat', '.sql', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.rb', '.php', '.ini', '.toml']
        if (!textExts.includes(ext)) {
          // 早期版本 `ext !== ''` 放行所有无扩展名文件，`.env` / `id_rsa` / `.npmrc`
          // 这类凭据文件会被当成普通文本读进对话里。改为无扩展名走显式白名单。
          const lower = base.toLowerCase()
          const SENSITIVE = [
            '.env', '.npmrc', '.netrc', '.htpasswd', '.gitconfig', '.git-credentials',
            'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials', 'secrets',
            'passwd', 'shadow', '.bash_history', '.zsh_history',
          ]
          if (SENSITIVE.some(s => lower === s || lower.startsWith(`${s}.`))) {
            return { ok: false, error: '该文件可能包含凭据，已拒绝读取' }
          }
          const SAFE_NO_EXT = new Set([
            'readme', 'license', 'licence', 'makefile', 'dockerfile', 'changelog',
            'authors', 'contributors', 'notice', 'version', 'todo', 'gemfile', 'rakefile',
            'procfile', 'vagrantfile',
          ])
          if (!SAFE_NO_EXT.has(lower)) {
            return { ok: false, error: `不支持的文件类型: ${ext || '未知'}（仅支持文本类文件）` }
          }
        }
        return { ok: true, content: fs.readFileSync(filePath, 'utf-8') }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 粘贴无磁盘路径的剪贴板图片（如截图）：base64 落盘到 userData/paste-cache，作为附件引用
    ipcMain.handle('dialog:savePasteFile', async (_, name: string, base64: string) => {
      try {
        const dir = path.join(app.getPath('userData'), 'paste-cache')
        await fs.promises.mkdir(dir, { recursive: true })
        const ext = (path.extname(name || '') || '.png').toLowerCase().slice(0, 10)
        const file = path.join(dir, `paste-${Date.now()}-${Math.floor(Math.random() * 1000)}${ext}`)
        await fs.promises.writeFile(file, Buffer.from(base64, 'base64'))
        return { ok: true, path: file }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 读取图片文件为 base64 data URL：用于把图片作为多模态内容（image_url）发给模型
    // 与 readFileContent 不同——这里专门返回 base64，且只允许图片类型、限制体积，避免把任意二进制塞进对话
    ipcMain.handle('dialog:readImageAsBase64', async (_, filePath: string) => {
      try {
        const guardErr = guardFile(filePath)
        if (guardErr) return { ok: false, error: guardErr }
        const stat = await fs.promises.stat(filePath)
        const MAX = 12 * 1024 * 1024
        if (stat.size > MAX) {
          return { ok: false, error: `图片过大（>${(MAX / 1024 / 1024).toFixed(0)}MB），已跳过图片内容，仅引用路径` }
        }
        const buf = await fs.promises.readFile(filePath)
        const ext = (path.extname(filePath || '').toLowerCase().slice(1)) || 'png'
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
        }
        const mime = mimeMap[ext]
        if (!mime) return { ok: false, error: '不支持的图片格式' }
        const b64 = buf.toString('base64')
        return { ok: true, dataUrl: `data:${mime};base64,${b64}` }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    ipcMain.handle('tasks:getAll', () => readJSON(TASKS_FILE, []))
    ipcMain.handle('tasks:save', (_, data) => writeJSON(TASKS_FILE, data))

    // ---------- Agent 工具：文件操作（限制在授权的工作文件夹内） ----------
    // 路径校验由 security.ts 的 assertInsideRoot 提供（已修复前缀误判问题）

    // 安全中心配置（每次调用实时读取，改动立即生效）
    function securityConfig(): SecurityConfig {
      return readJSON(CONFIG_FILE, {}) as SecurityConfig
    }

    // 文件路径策略：返回字符串表示被拦截，null 表示放行
    function guardFile(absPath: string): string | null {
      const r = evaluateFilePath(securityConfig(), absPath)
      return r.decision === 'deny' ? `安全中心拦截：${r.reason}` : null
    }

    // 弹窗向用户确认（用于命令询问名单 / 批量删除 / 联网域名确认）
    async function confirmAction(title: string, detail: string): Promise<boolean> {
      try {
        const opts = {
          type: 'warning' as const,
          buttons: ['允许', '拒绝'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
          title,
          message: title,
          detail,
        }
        // 窗口未就绪时退化为无父窗口弹窗：不能因 mainWindow 为 null 就静默「拒绝」，
        // 否则用户明明配置了询问名单，命令却全被悄悄挡掉（2026-09-22 测试发现）
        const { response } = mainWindow
          ? await dialog.showMessageBox(mainWindow, opts)
          : await dialog.showMessageBox(opts)
        return response === 0
      } catch (e) {
        console.error('[deepwork] 确认弹窗失败:', e)
        return false
      }
    }

    // 统计目录内条目数（用于批量删除审批）
    // 统计目录条目数（用于批量删除审批）：带上限，避免超大目录把主进程卡死
    const MAX_COUNT_ENTRIES = 20000
    function countEntries(dir: string): number {
      let total = 0
      const walk = (p: string, depth: number) => {
        if (depth > 10 || total >= MAX_COUNT_ENTRIES) return
        let entries
        try { entries = fs.readdirSync(p, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (total >= MAX_COUNT_ENTRIES) return
          total++
          if (e.isDirectory()) walk(path.join(p, e.name), depth + 1)
        }
      }
      walk(dir, 0)
      return total
    }

    // 备份目录按总量配额清理最旧的备份
    // 备份目录体积缓存：backupBeforeChange 每次写文件都会调 pruneBackups，
    // 早期版本每次都把 BACKUP_DIR 全量同步 statSync 一遍，写盘 I/O 随备份量线性增长
    const backupSizeCache = new Map<string, { mtime: number; total: number }>()
    const MAX_BACKUP_WALK_ENTRIES = 20000

    function pruneBackups(quota: number) {
      try {
        if (!fs.existsSync(BACKUP_DIR)) return
        const dirs = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(BACKUP_DIR, d.name))
        let walkEntries = 0
        const sized = dirs.map(dir => {
          let total = 0
          let mtime = 0
          try { mtime = fs.statSync(dir).mtimeMs } catch { /* 忽略 */ }
          const cached = backupSizeCache.get(dir)
          if (cached && cached.mtime === mtime) return { dir, total: cached.total, mtime }
          const walk = (p: string) => {
            if (walkEntries >= MAX_BACKUP_WALK_ENTRIES) return
            for (const e of fs.readdirSync(p, { withFileTypes: true })) {
              if (walkEntries >= MAX_BACKUP_WALK_ENTRIES) return
              walkEntries++
              const fp = path.join(p, e.name)
              if (e.isDirectory()) walk(fp)
              else { try { total += fs.statSync(fp).size } catch { /* 忽略 */ } }
            }
          }
          try { walk(dir) } catch { /* 忽略 */ }
          backupSizeCache.set(dir, { mtime, total })
          return { dir, total, mtime }
        }).sort((a, b) => a.mtime - b.mtime)
        let sum = sized.reduce((s, x) => s + x.total, 0)
        // sized 按 mtime 升序，最后一项是最新备份：始终保留，避免配额过小时刚备份完就被自己清掉
        const newest = sized[sized.length - 1]
        for (const item of sized) {
          if (sum <= quota) break
          if (item === newest) break
          try {
            fs.rmSync(item.dir, { recursive: true, force: true })
            sum -= item.total
            backupSizeCache.delete(item.dir)
          } catch { /* 忽略 */ }
        }
        // 目录已消失的缓存条目一并清掉，避免缓存无限增长
        for (const key of Array.from(backupSizeCache.keys())) {
          if (!dirs.includes(key)) backupSizeCache.delete(key)
        }
      } catch (e) { console.error('[deepwork] 备份清理失败:', e) }
    }

    // 修改/删除前自动备份（受“自动备份 + 备份总上限”控制）
    // 递归复制目录用于备份，带条目上限避免备份动作本身卡死主进程
    const MAX_BACKUP_ENTRIES = 2000
    function copyDirCapped(src: string, dest: string, cap: number): number {
      let copied = 0
      const walk = (from: string, to: string) => {
        if (copied >= cap) return
        ensureDir(to)
        let entries
        try { entries = fs.readdirSync(from, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (copied >= cap) return
          const sf = path.join(from, e.name)
          const df = path.join(to, e.name)
          try {
            if (e.isDirectory()) walk(sf, df)
            else { fs.copyFileSync(sf, df); copied++ }
          } catch { /* 单个文件失败不影响其余 */ }
        }
      }
      walk(src, dest)
      return copied
    }

    function backupBeforeChange(absPath: string): string | null {
      const cfg = securityConfig()
      if (!shouldBackup(cfg)) return null
      try {
        if (!fs.existsSync(absPath)) return null
        const stat = fs.statSync(absPath)
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const dir = path.join(BACKUP_DIR, stamp)
        ensureDir(dir)
        const dest = path.join(dir, path.basename(absPath))
        if (stat.isDirectory()) {
          // 目录删除是最危险的操作，必须备份（原来这里直接跳过）
          const n = copyDirCapped(absPath, dest, MAX_BACKUP_ENTRIES)
          if (n === 0) return null
        } else {
          fs.copyFileSync(absPath, dest)
        }
        pruneBackups(backupQuotaBytes(cfg))
        return dest
      } catch (e: any) {
        console.error('[deepwork] 备份失败:', e.message)
        return null
      }
    }

    // 读取文件：支持行范围分段读取（offset 从 1 开始）。无参数时最多返回 2000 行，
    // 防止大文件撑爆模型上下文；截断时返回 totalLines/truncated/nextOffset 供继续读取
    ipcMain.handle('agent:readFile', (_, root: string, relPath: string, offset?: number, limit?: number) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' }
        const stat = fs.statSync(fp)
        if (stat.isDirectory()) return { ok: false, error: '目标是目录，不是文件（列目录请用 list_files）' }
        if (stat.size > 2 * 1024 * 1024) return { ok: false, error: '文件过大 (>2MB)，请用 run_command 或 search_files 定位后再分段读取' }
        const content = fs.readFileSync(fp, 'utf-8')
        const allLines = content.split('\n')
        const totalLines = allLines.length
        const start = Math.max(1, Math.floor(offset || 1))
        const maxLines = Math.min(Math.max(1, Math.floor(limit || 2000)), 2000)
        const slice = allLines.slice(start - 1, start - 1 + maxLines)
        const endLine = start - 1 + slice.length
        const truncated = endLine < totalLines
        return {
          ok: true,
          content: slice.join('\n'),
          totalLines,
          truncated,
          startLine: start,
          endLine,
          nextOffset: truncated ? endLine + 1 : undefined,
        }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 会话级策略旁路（对话页「完全访问」）：只在内存生效，不写 config.json。
    // 任务视图挂载时会显式关掉，避免对话页的旁路泄漏到任务执行。
    ipcMain.handle('agent:setPolicyBypass', (_, v: boolean) => {
      setPolicyBypass(!!v)
      return { ok: true }
    })

    ipcMain.handle('agent:writeFile', (_, root: string, relPath: string, content: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        const backup = backupBeforeChange(fp)
        ensureDir(path.dirname(fp))
        fs.writeFileSync(fp, content, 'utf-8')
        return { ok: true, notice: backup ? `已自动备份原文件到 ${path.basename(path.dirname(backup))}/` : undefined }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 精准编辑：str_replace 风格（Claude Code 模式），替换文件中的精确文本
    // replaceAll=true 时替换全部出现（默认要求 old_str 唯一）
    ipcMain.handle('agent:editFile', (_, root: string, relPath: string, oldStr: string, newStr: string, replaceAll: boolean = false) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' }
        // old_str 为空时 split('') 会把每个字符都当作分隔点，replace_all 下会把文件彻底写坏
        if (!oldStr) return { ok: false, error: 'old_str 不能为空（空字符串会把文件按字符拆开）' }
        const content = fs.readFileSync(fp, 'utf-8')
        const count = content.split(oldStr).length - 1
        if (count === 0) return { ok: false, error: '未找到要替换的文本（old_str 必须与文件内容精确匹配，包括空格和缩进）' }
        if (count > 1 && !replaceAll) return { ok: false, error: `old_str 在文件中出现 ${count} 次：提供更多上下文使其唯一，或用 replace_all: true 全部替换` }
        const backup = backupBeforeChange(fp)
        const updated = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr)
        fs.writeFileSync(fp, updated, 'utf-8')
        return { ok: true, replaced: replaceAll ? count : 1, notice: backup ? `已自动备份原文件到 ${path.basename(path.dirname(backup))}/` : undefined }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 追加内容到文件末尾
    ipcMain.handle('agent:appendFile', (_, root: string, relPath: string, content: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        const backup = backupBeforeChange(fp)
        ensureDir(path.dirname(fp))
        fs.appendFileSync(fp, content, 'utf-8')
        return { ok: true, notice: backup ? `已自动备份原文件到 ${path.basename(path.dirname(backup))}/` : undefined }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 删除文件：黑名单拦截 + 批量删除审批 + 删除保护（优先移入回收站）
    ipcMain.handle('agent:deleteFile', async (_, root: string, relPath: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' }
        const cfg = securityConfig()
        const stat = fs.statSync(fp)
        const entryCount = stat.isDirectory() ? countEntries(fp) : 1
        if (needsBatchApproval(cfg, entryCount)) {
          const allowed = await confirmAction(
            '批量删除审批',
            `本次将删除 ${entryCount} 个条目（阈值 ${cfg.batchDeleteThreshold}）：\n${fp}\n\n是否允许？`
          )
          if (!allowed) return { ok: false, error: `用户拒绝批量删除（${entryCount} 个条目命中批量删除审批）` }
        }
        const backup = backupBeforeChange(fp)
        let notice: string | undefined = backup ? `已备份到 ${path.basename(path.dirname(backup))}/` : undefined
        if (shouldTrash(cfg)) {
          await shell.trashItem(fp)
          notice = [notice, '已移入回收站（删除保护）'].filter(Boolean).join('，')
        } else if (stat.isDirectory()) {
          fs.rmSync(fp, { recursive: true, force: true })
        } else {
          fs.unlinkSync(fp)
        }
        return { ok: true, entryCount, notice }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 移动/重命名文件或目录（源与目标都必须在工作目录内，目标已存在时报错）
    ipcMain.handle('agent:moveFile', (_, root: string, relPath: string, newRelPath: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const np = assertInsideRoot(root, resolveInsideRoot(root, newRelPath))
        const blocked = guardFile(fp) || guardFile(np)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '源路径不存在' }
        if (fs.existsSync(np)) return { ok: false, error: `目标路径已存在: ${newRelPath}` }
        ensureDir(path.dirname(np))
        backupBeforeChange(fp)
        try {
          fs.renameSync(fp, np)
        } catch (e: any) {
          // 跨盘移动：rename 不支持（EXDEV），文件退化为复制+删除
          if (e.code === 'EXDEV' && fs.statSync(fp).isFile()) {
            fs.copyFileSync(fp, np)
            fs.unlinkSync(fp)
          } else {
            return { ok: false, error: e.message }
          }
        }
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 复制文件（仅支持文件，目标已存在时报错）
    ipcMain.handle('agent:copyFile', (_, root: string, relPath: string, newRelPath: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const np = assertInsideRoot(root, resolveInsideRoot(root, newRelPath))
        const blocked = guardFile(fp) || guardFile(np)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '源路径不存在' }
        if (fs.statSync(fp).isDirectory()) return { ok: false, error: '暂不支持复制目录，仅支持文件' }
        if (fs.existsSync(np)) return { ok: false, error: `目标路径已存在: ${newRelPath}` }
        ensureDir(path.dirname(np))
        fs.copyFileSync(fp, np)
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 创建目录（自动创建父目录）
    ipcMain.handle('agent:createDir', (_, root: string, relPath: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (fs.existsSync(fp)) return { ok: false, error: '路径已存在' }
        fs.mkdirSync(fp, { recursive: true })
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 内容搜索：grep 风格，在目录内搜索文本（返回匹配行及行号）
    ipcMain.handle('agent:searchFiles', (_, root: string, relPath: string, pattern: string, isRegex: boolean = false) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '目录不存在' }
        let regex: RegExp
        try {
          regex = new RegExp(isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        } catch {
          return { ok: false, error: '无效的正则表达式' }
        }
        const results: Array<{ file: string; line: number; text: string }> = []
        const MAX_RESULTS = 100
        // helper to check size (avoid huge/binary files)
        const sizeOk = (p: string) => { try { return fs.statSync(p).size < 512 * 1024 } catch { return false } }

        function searchDir(dir: string, depth: number) {
          if (depth > 6 || results.length >= MAX_RESULTS) return
          let entries
          try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) return
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) searchDir(full, depth + 1)
            } else if (entry.isFile() && sizeOk(full)) {
              try {
                const content = fs.readFileSync(full, 'utf-8')
                const lines = content.split('\n')
                for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
                  regex.lastIndex = 0
                  if (regex.test(lines[i])) {
                    results.push({ file: path.relative(fp, full).replace(/\\/g, '/'), line: i + 1, text: lines[i].trim().slice(0, 300) })
                  }
                }
              } catch {}
            }
          }
        }

        if (fs.statSync(fp).isFile()) {
          // 单文件搜索
          const content = fs.readFileSync(fp, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
            regex.lastIndex = 0
            if (regex.test(lines[i])) {
              results.push({ file: path.basename(fp), line: i + 1, text: lines[i].trim().slice(0, 300) })
            }
          }
        } else {
          searchDir(fp, 0)
        }
        return { ok: true, matches: results, truncated: results.length >= MAX_RESULTS }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 文件查找：glob 风格模式匹配（如 *.js, src/**/*.ts, **/*.py）
    ipcMain.handle('agent:findFiles', (_, root: string, pattern: string) => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, ''))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        const results: string[] = []
        const MAX_RESULTS = 200

        // 将 glob 模式转换为正则
        function globToRegex(glob: string): RegExp {
          let re = ''
          let i = 0
          while (i < glob.length) {
            const c = glob[i]
            if (c === '*') {
              if (glob[i + 1] === '*') {
                // ** 匹配任意层级
                if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3 } 
                else { re += '.*'; i += 2 }
              } else { re += '[^/]*'; i += 1 }
            } else if (c === '?') { re += '[^/]'; i += 1 }
            else if (c === '{') {
              const j = glob.indexOf('}', i)
              // 没有闭合的 '}' 时按字面量处理：否则 i 会被置回 0 造成死循环
              if (j === -1) { re += '\\{'; i += 1 }
              else { re += '(' + glob.slice(i + 1, j).split(',').join('|') + ')'; i = j + 1 }
            }
            else { re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&'); i += 1 }
          }
          return new RegExp('^' + re + '$', 'i')
        }

        const regex = globToRegex(pattern)
        function walk(dir: string, depth: number) {
          if (depth > 8 || results.length >= MAX_RESULTS) return
          let entries
          try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) return
            const full = path.join(dir, entry.name)
            const rel = path.relative(fp, full).replace(/\\/g, '/')
            if (entry.isDirectory()) {
              if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                if (regex.test(rel)) results.push(rel + '/')
                walk(full, depth + 1)
              }
            } else {
              if (regex.test(rel)) results.push(rel)
            }
          }
        }
        walk(fp, 0)
        return { ok: true, files: results.slice(0, MAX_RESULTS), truncated: results.length >= MAX_RESULTS }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    ipcMain.handle('agent:listFiles', (_, root: string, relPath: string = '') => {
      try {
        const fp = assertInsideRoot(root, resolveInsideRoot(root, relPath))
        const blocked = guardFile(fp)
        if (blocked) return { ok: false, error: blocked }
        if (!fs.existsSync(fp)) return { ok: false, error: '目录不存在' }
        const items = fs.readdirSync(fp).map(name => {
          const s = fs.statSync(path.join(fp, name))
          return { name, isDir: s.isDirectory(), size: s.size }
        })
        return { ok: true, items }
      } catch (e: any) {
        return { ok: false, error: e.message }
      }
    })

    // 命令执行（需安全中心放行，超时保护）
    // 安全中心命令策略：命中放行名单直接执行；命中询问名单先弹窗确认；都未命中按默认放行
    ipcMain.handle('agent:execCommand', async (_, root: string, command: string, timeoutMs: number = 30000) => {
      const { exec } = require('child_process') as typeof import('child_process')
      // 0 / 负数 / NaN 会让 exec 永久挂起（timeout: 0 表示不限时），必须夹取范围
      const clampedTimeout = Math.min(Math.max(1, Number(timeoutMs) || 30000), 300000)
      const cfg = securityConfig()
      const policy = evaluateCommand(cfg, command)
      let notice: string | undefined
      if (policy.decision === 'deny') {
        return { ok: false, stdout: '', stderr: `安全中心拦截：${policy.reason}`, exitCode: -1 }
      }
      if (policy.decision === 'ask') {
        const allowed = await confirmAction(
          '命令执行确认',
          `AI 请求执行命令：\n\n${command}\n\n命中询问名单：${policy.matched}\n工作目录：${root}`
        )
        if (!allowed) {
          return { ok: false, stdout: '', stderr: `用户拒绝执行该命令（命中询问名单：${policy.matched}）`, exitCode: -1 }
        }
        notice = `已征得用户同意（询问名单：${policy.matched}）`
      }
      return new Promise((resolve) => {
        try {
          const child = exec(command, { cwd: root, timeout: clampedTimeout, windowsHide: true, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
              // 超时被 kill 时 error.code 是 null（不是 0），早期版本 `?? 0` 会把
              // 「执行超时被终止」报成 exitCode 0，模型据此当成命令成功继续往下跑
              const killed = !!(error && (error as any).killed)
              const signal = (error as any)?.signal
              const timedOut = killed || (signal === 'SIGTERM' && error?.code == null)
              const errText = timedOut
                ? `执行超时（${Math.round(clampedTimeout / 1000)}s）被终止`
                : ''
              resolve({
                ok: !error && !timedOut,
                stdout: (stdout || '').slice(0, 50 * 1024),
                stderr: timedOut ? `${errText}\n${stderr || ''}`.trim() : (stderr || '').slice(0, 10 * 1024),
                exitCode: timedOut ? -1 : (error?.code ?? 0),
                notice,
              })
            })
        } catch (e: any) {
          resolve({ ok: false, stdout: '', stderr: e.message, exitCode: -1, notice })
        }
      })
    })

    // ---------- Agent 工具：内置浏览器（联网搜索 / 网页抓取） ----------
    // 网络安全策略：禁止域名直接拦截；配置了允许域名时，未列入的域名先弹窗询问用户
    async function guardUrl(url: string, purpose: string): Promise<{ ok: boolean; notice?: string; error?: string }> {
      const cfg = securityConfig()
      const policy = evaluateUrl(cfg, url)
      if (policy.decision === 'deny') return { ok: false, error: `安全中心拦截：${policy.reason}` }
      if (policy.decision === 'ask') {
        const allowed = await confirmAction('联网访问确认', `AI 请求访问网络：\n\n${purpose}\n地址：${url}\n\n原因：${policy.reason}`)
        if (!allowed) return { ok: false, error: `用户拒绝了本次网络访问（${url}）` }
        return { ok: true, notice: '已征得用户同意访问该域名' }
      }
      return { ok: true }
    }

    ipcMain.handle('agent:webSearch', async (_, query: string, count?: number) => {
      const q = String(query ?? '').trim()
      if (!q) return { ok: false, error: '缺少搜索关键词 query' }
      const limit = Math.min(Math.max(1, Number(count) || 8), 15)
      const notices: string[] = []
      const engineGate = async (engine: { id: string; host: string; url: string }) => {
        const g = await guardUrl(engine.url, `联网搜索「${q}」（引擎：${engine.host}）`)
        if (g.error) return false
        if (g.notice) notices.push(g.notice)
        return true
      }
      const r = await webSearch(q, limit, 15000, engineGate)
      if (!r.ok) {
        return { ok: false, error: `搜索失败：${r.errors.join('；') || '无可用引擎'}`, engine: r.engine }
      }
      const lines = r.results.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}\n   ${item.snippet || '(无摘要)'}`)
      return {
        ok: true,
        engine: r.engine,
        count: r.results.length,
        output: `搜索「${q}」，引擎 ${r.engine}，共 ${r.results.length} 条：\n\n${lines.join('\n\n')}\n\n（如需正文，用 web_fetch 抓取其中某个链接）`,
        notice: notices.length > 0 ? Array.from(new Set(notices)).join('；') : undefined,
      }
    })

    ipcMain.handle('agent:webFetch', async (_, url: string, maxChars?: number) => {
      const target = String(url ?? '').trim()
      if (!target) return { ok: false, error: '缺少 url 参数' }
      const g = await guardUrl(target, '抓取网页正文')
      if (!g.ok) return { ok: false, error: g.error }
      const cap = Math.min(Math.max(500, Number(maxChars) || 12000), 40000)
      // 重定向逐跳校验：避免先访问白名单域名、再跳转到黑名单域名绕过策略
      const notices: string[] = g.notice ? [g.notice] : []
      const redirectGate = async (nextUrl: string) => {
        const rg = await guardUrl(nextUrl, `网页跳转到 ${nextUrl}`)
        if (!rg.ok) return false
        if (rg.notice) notices.push(rg.notice)
        return true
      }
      const r = await webFetch(target, cap, 20000, redirectGate)
      const notice = notices.length > 0 ? Array.from(new Set(notices)).join('；') : undefined
      if (!r.ok) return { ok: false, error: `抓取失败：${r.error}`, url: r.url, notice }
      return {
        ok: true,
        url: r.url,
        title: r.title,
        output: summarizePage(r.url, r.title, r.text, cap),
        notice,
      }
    })

    // ---------- 技能包（SkillHub / ClawHub 真实下载安装） ----------
    function ensureSkillsDir(): boolean {
      try {
        if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
        return true
      } catch {
        return false
      }
    }

    ipcMain.handle('skills:list', () => {
      if (!ensureSkillsDir()) return { ok: false, error: '无法创建技能目录', skills: [] }
      try {
        return { ok: true, skills: listSkills(SKILLS_DIR), dir: SKILLS_DIR }
      } catch (e: any) {
        return { ok: false, error: e?.message || '读取技能列表失败', skills: [] }
      }
    })

    ipcMain.handle('skills:install', async (_, payload: Partial<SkillMeta> & { slug: string }) => {
      const opts = payload || ({} as any)
      const slug = String(opts.slug ?? '').trim()
      if (!isSafeSlug(slug)) return { ok: false, error: `非法的技能标识: ${slug}` }
      if (!ensureSkillsDir()) return { ok: false, error: '无法创建技能目录' }
      const r = await installSkill(
        SKILLS_DIR,
        {
          slug,
          owner: opts.owner,
          name: opts.name,
          desc: opts.desc,
          version: opts.version,
          iconUrl: opts.iconUrl,
          category: opts.category,
        },
        async (url, label) => guardUrl(url, label)
      )
      if (!r.ok) return { ok: false, error: r.error }
      return { ok: true, skill: r.meta, notice: r.notice }
    })

    ipcMain.handle('skills:remove', (_, slug: string) => {
      const s = String(slug ?? '').trim()
      if (!isSafeSlug(s)) return { ok: false, error: `非法的技能标识: ${slug}` }
      return { ok: removeSkill(SKILLS_DIR, s) }
    })

    ipcMain.handle('skills:setEnabled', (_, slug: string, enabled: boolean) => {
      const s = String(slug ?? '').trim()
      if (!isSafeSlug(s)) return { ok: false, error: `非法的技能标识: ${slug}` }
      return { ok: setSkillEnabled(SKILLS_DIR, s, !!enabled) }
    })

    // 读取技能正文，供 use_skill 工具注入给模型
    ipcMain.handle('skills:read', (_, slug: string, maxChars?: number) => {
      const s = String(slug ?? '').trim()
      if (!isSafeSlug(s)) return { ok: false, error: `非法的技能标识: ${slug}` }
      const cap = Math.min(Math.max(2000, Number(maxChars) || 20000), 60000)
      return readSkill(SKILLS_DIR, s, cap)
    })

    ipcMain.handle('skills:openDir', async () => {
      try {
        ensureSkillsDir()
        return await shell.openPath(SKILLS_DIR)
      } catch (e: any) {
        return e?.message || '打开技能目录失败'
      }
    })

    ipcMain.handle('app:getInfo', () => ({
      version: app.getVersion(),
      name: app.getName(),
      userDataPath,
      backupPath: BACKUP_DIR,
      skillsPath: SKILLS_DIR,
      platform: process.platform,
      arch: process.arch,
    }))

    // 打开备份目录（安全中心 → 自动备份）
    // 主题同步：让原生控件（滚动条 / 系统对话框）也跟随深浅色
    ipcMain.handle('app:setTheme', (_, mode: 'light' | 'dark' | 'system') => {
      try {
        nativeTheme.themeSource = mode === 'dark' || mode === 'light' ? mode : 'system'
      } catch { /* 主题同步失败不影响界面 */ }
    })

    ipcMain.handle('app:openBackupDir', async () => {
      try {
        ensureDir(BACKUP_DIR)
        return await shell.openPath(BACKUP_DIR)
      } catch (e: any) {
        return e.message
      }
    })

    // 任务完成通知（Windows toast + 系统提示音）
    // 最近一次通知的引用：不持有会被 GC 回收，Windows 上表现为通知闪一下就没了
    let lastNotification: Electron.Notification | null = null

    ipcMain.handle('app:notify', (_, title: string, body: string) => {
      // 播放系统提示音（必须挂回调，否则子进程异常会变成未处理的 error 事件）
      try {
        const { exec } = require('child_process')
        const child = exec('powershell -c "[System.Media.SystemSounds]::Asterisk.Play()"', { windowsHide: true }, () => { /* 音效失败无需处理 */ })
        child?.unref?.()
      } catch {}

      // 发送 Windows 通知
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          silent: false,
        })
        notification.show()
        lastNotification = notification
      }
    })
    ipcMain.handle('app:clearAllData', () => {
      try {
        if (fs.existsSync(MODELS_FILE)) fs.unlinkSync(MODELS_FILE)
        if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE)
        if (fs.existsSync(TASKS_FILE)) fs.unlinkSync(TASKS_FILE)
        if (fs.existsSync(CONVERSATIONS_DIR)) {
          for (const f of fs.readdirSync(CONVERSATIONS_DIR)) {
            if (f.endsWith('.json')) fs.unlinkSync(path.join(CONVERSATIONS_DIR, f))
          }
        }
        return true
      } catch (e) { console.error('clearAllData error:', e); return false }
    })
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    ensureDir(CONVERSATIONS_DIR)
    setupIPC()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((e) => {
    // 早期版本没有兜底：初始化阶段抛错会静默变成「进程起来了但没窗口」
    console.error('[deepwork] 启动初始化失败:', e)
    try {
      dialog.showErrorBox('deepwork 启动失败', String(e?.message || e))
    } catch { /* 忽略 */ }
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}



