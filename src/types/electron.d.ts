export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  config: {
    get: (key?: string) => Promise<any>
    set: (key: string, value: any) => Promise<boolean>
    /** 其他窗口的配置变更广播（设置独立窗口 ↔ 主窗口同步）；返回取消监听函数 */
    onChange: (cb: (key: string, value: any) => void) => () => void
  }
  models: {
    getAll: () => Promise<{ models: any[]; providers: any[] }>
    save: (data: any) => Promise<boolean>
  }
  conversations: {
    getAll: () => Promise<any[]>
    get: (id: string) => Promise<any>
    save: (id: string, data: any) => Promise<boolean>
    delete: (id: string) => Promise<boolean>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (path: string) => Promise<void>
    openPath: (path: string) => Promise<{ ok: boolean; error?: string }>
  }
  dialog: {
    selectFolder: () => Promise<string | null>
    selectFiles: () => Promise<string[]>
    readFileContent: (filePath: string) => Promise<{ ok: boolean; content?: string; error?: string }>
    getPathForFile: (file: File) => string
    savePasteFile: (name: string, base64: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    readImageAsBase64: (filePath: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
  }
  skills: {
    list: () => Promise<{ ok: boolean; skills?: InstalledSkill[]; dir?: string; error?: string }>
    install: (payload: { slug: string; owner?: string; name?: string; desc?: string; version?: string; iconUrl?: string; category?: string }) => Promise<{ ok: boolean; skill?: InstalledSkill; notice?: string; error?: string }>
    remove: (slug: string) => Promise<{ ok: boolean; error?: string }>
    setEnabled: (slug: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
    read: (slug: string, maxChars?: number) => Promise<{ ok: boolean; content?: string; files?: string[]; error?: string }>
    openDir: () => Promise<string>
  }
  agents: {
    list: () => Promise<{ ok: boolean; online?: boolean; agents?: AgentListItem[]; localOnly?: AgentListItem[]; error?: string }>
    get: (id: string) => Promise<{ ok: boolean; agent?: AgentPackageFull; error?: string }>
    install: (id: string) => Promise<{ ok: boolean; installedSkills?: string[]; error?: string }>
    uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
  tasks: {
    getAll: () => Promise<any[]>
    save: (data: any) => Promise<boolean>
  }
  agent: {
    setPolicyBypass: (v: boolean) => Promise<{ ok: boolean }>
    readFile: (root: string, relPath: string, offset?: number, limit?: number) => Promise<{ ok: boolean; content?: string; totalLines?: number; truncated?: boolean; startLine?: number; endLine?: number; nextOffset?: number; error?: string }>
    writeFile: (root: string, relPath: string, content: string) => Promise<{ ok: boolean; notice?: string; error?: string }>
    editFile: (root: string, relPath: string, oldStr: string, newStr: string, replaceAll?: boolean) => Promise<{ ok: boolean; replaced?: number; notice?: string; error?: string }>
    appendFile: (root: string, relPath: string, content: string) => Promise<{ ok: boolean; notice?: string; error?: string }>
    deleteFile: (root: string, relPath: string) => Promise<{ ok: boolean; entryCount?: number; notice?: string; error?: string }>
    moveFile: (root: string, relPath: string, newRelPath: string) => Promise<{ ok: boolean; error?: string }>
    copyFile: (root: string, relPath: string, newRelPath: string) => Promise<{ ok: boolean; error?: string }>
    createDir: (root: string, relPath: string) => Promise<{ ok: boolean; error?: string }>
    listFiles: (root: string, relPath?: string) => Promise<{ ok: boolean; items?: Array<{ name: string; isDir: boolean; size: number }>; error?: string }>
    searchFiles: (root: string, relPath: string, pattern: string, isRegex?: boolean) => Promise<{ ok: boolean; matches?: Array<{ file: string; line: number; text: string }>; truncated?: boolean; error?: string }>
    findFiles: (root: string, pattern: string) => Promise<{ ok: boolean; files?: string[]; truncated?: boolean; error?: string }>
    execCommand: (root: string, command: string, timeoutMs?: number) => Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; notice?: string }>
    webSearch: (query: string, count?: number) => Promise<{ ok: boolean; engine?: string; count?: number; output?: string; notice?: string; error?: string }>
    webFetch: (url: string, maxChars?: number) => Promise<{ ok: boolean; url?: string; title?: string; output?: string; notice?: string; error?: string }>
    todo: (root: string, action: string, payload?: { content?: string; index?: number; status?: string }) => Promise<{ ok: boolean; output?: string; error?: string }>
  }
  fs: {
    readDirTree: (dirPath: string) => Promise<DirTreeItem[]>
  }
  wallpaper: {
    /** 选择并导入壁纸文件到 userData/wallpapers/（kind 决定文件选择器过滤） */
    chooseFile: (kind: 'image' | 'video' | 'html') => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
    list: () => Promise<{ ok: boolean; items?: Array<{ name: string; path: string; size: number }>; error?: string }>
    remove: (name: string) => Promise<{ ok: boolean; error?: string }>
  }
  app: {
    getInfo: () => Promise<{
      version: string
      name: string
      userDataPath: string
      backupPath: string
      skillsPath: string
      platform: string
      arch: string
    }>
    clearAllData: () => Promise<boolean>
    notify: (title: string, body: string) => Promise<void>
    openBackupDir: () => Promise<string>
    setTheme: (mode: 'light' | 'dark' | 'system') => Promise<void>
    /** 默认工作目录（对话页工具链的落盘根目录），取不到时返回空串 */
    getDefaultWorkDir: () => Promise<string>
    /** 打开设置独立窗口（单例，已存在时聚焦） */
    openSettings: () => Promise<void>
    /** 检测更新：返回 { ok, current, latest, hasUpdate, patchUrl, sha256, size, notes, pubDate, error } */
    checkUpdate: () => Promise<{
      ok: boolean
      current: string
      latest?: string
      hasUpdate?: boolean
      patchUrl?: string | null
      sha256?: string | null
      size?: number
      notes?: string
      pubDate?: string
      error?: string
    }>
    /** 下载并应用补丁（覆盖 resources/app 后重启）。patchUrl 必填；sha256 为空则不校验 */
    downloadUpdate: (patchUrl: string, sha256: string | null) => Promise<{ ok: boolean; error?: string }>
    /** 启动独立更新器 update.exe：关闭主程序，由其下载并替换整个 app 文件夹 */
    launchUpdater: () => Promise<{ ok: boolean; error?: string }>
    /** 启动独立卸载器 uninstall.exe：关闭主程序，由其删除 app 文件夹 */
    launchUninstaller: () => Promise<{ ok: boolean; error?: string }>
  }
}

export interface InstalledSkill {
  slug: string
  name: string
  desc?: string
  version?: string
  iconUrl?: string
  owner?: string
  category?: string
  installedAt: number
  enabled: boolean
  files?: string[]
}

/** Agent 包列表项（agents:list 返回，不含大字段） */
export interface AgentListItem {
  id: string
  name: string
  version: string
  description: string
  icon: string
  agentCount: number
  skillCount: number
  skillNames: string[]
  installed: boolean
  installedAt: number
}

/** Agent 包完整定义（agents:get 返回，含 agentPrompt） */
export interface AgentPackageFull {
  id: string
  name: string
  version: string
  description: string
  icon: string
  agentPrompt: string
  skills: Array<{ slug: string; name: string; description: string; content: string }>
  installed?: boolean
}

export interface DirTreeItem {
  name: string
  path: string
  isDir: boolean
  size: number
  modified: string
  children?: DirTreeItem[]
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
