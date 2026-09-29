import { contextBridge, ipcRenderer, webUtils } from 'electron'

const electronAPI = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  // Config operations
  config: {
    get: (key?: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
    // 其他窗口的配置变更广播（设置独立窗口 ↔ 主窗口同步）；返回取消监听函数
    onChange: (cb: (key: string, value: any) => void) => {
      const listener = (_: unknown, key: string, value: any) => cb(key, value)
      ipcRenderer.on('config:changed', listener)
      return () => ipcRenderer.removeListener('config:changed', listener)
    },
  },

  // Models operations
  models: {
    getAll: () => ipcRenderer.invoke('models:getAll'),
    save: (data: any) => ipcRenderer.invoke('models:save', data),
  },

  // Conversations operations
  conversations: {
    getAll: () => ipcRenderer.invoke('conversations:getAll'),
    get: (id: string) => ipcRenderer.invoke('conversations:get', id),
    save: (id: string, data: any) => ipcRenderer.invoke('conversations:save', id, data),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  },

  // Shell operations
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path),
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },

  // Dialog operations
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    selectFiles: () => ipcRenderer.invoke('dialog:selectFiles'),
    readFileContent: (filePath: string) => ipcRenderer.invoke('dialog:readFileContent', filePath),
    // 粘贴文件：把剪贴板 File 对象解析为磁盘路径（新版 Electron 移除了 File.path，须走 webUtils）
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    // 无磁盘路径的剪贴板图片（如截图）：base64 落盘为临时文件后作为附件
    savePasteFile: (name: string, base64: string) => ipcRenderer.invoke('dialog:savePasteFile', name, base64),
    // 把磁盘上的图片文件读成 base64 data URL，用于多模态发送（受安全中心文件策略约束）
    readImageAsBase64: (filePath: string) => ipcRenderer.invoke('dialog:readImageAsBase64', filePath),
  },

  // Skills operations（SkillHub / ClawHub 技能包）
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    install: (payload: any) => ipcRenderer.invoke('skills:install', payload),
    remove: (slug: string) => ipcRenderer.invoke('skills:remove', slug),
    setEnabled: (slug: string, enabled: boolean) => ipcRenderer.invoke('skills:setEnabled', slug, enabled),
    read: (slug: string, maxChars?: number) => ipcRenderer.invoke('skills:read', slug, maxChars),
    openDir: () => ipcRenderer.invoke('skills:openDir'),
  },

  // Agents（Agent 包：人格 + 技能组合，在线市场双线路）
  agents: {
    list: () => ipcRenderer.invoke('agents:list'),
    get: (id: string) => ipcRenderer.invoke('agents:get', id),
    install: (id: string) => ipcRenderer.invoke('agents:install', id),
    uninstall: (id: string) => ipcRenderer.invoke('agents:uninstall', id),
  },

  // Tasks operations
  tasks: {
    getAll: () => ipcRenderer.invoke('tasks:getAll'),
    save: (data: any) => ipcRenderer.invoke('tasks:save', data),
  },

  // Agent tools
  agent: {
    setPolicyBypass: (v: boolean) => ipcRenderer.invoke('agent:setPolicyBypass', v),
    readFile: (root: string, relPath: string, offset?: number, limit?: number) => ipcRenderer.invoke('agent:readFile', root, relPath, offset, limit),
    writeFile: (root: string, relPath: string, content: string) => ipcRenderer.invoke('agent:writeFile', root, relPath, content),
    editFile: (root: string, relPath: string, oldStr: string, newStr: string, replaceAll?: boolean) => ipcRenderer.invoke('agent:editFile', root, relPath, oldStr, newStr, replaceAll ?? false),
    appendFile: (root: string, relPath: string, content: string) => ipcRenderer.invoke('agent:appendFile', root, relPath, content),
    deleteFile: (root: string, relPath: string) => ipcRenderer.invoke('agent:deleteFile', root, relPath),
    moveFile: (root: string, relPath: string, newRelPath: string) => ipcRenderer.invoke('agent:moveFile', root, relPath, newRelPath),
    copyFile: (root: string, relPath: string, newRelPath: string) => ipcRenderer.invoke('agent:copyFile', root, relPath, newRelPath),
    createDir: (root: string, relPath: string) => ipcRenderer.invoke('agent:createDir', root, relPath),
    listFiles: (root: string, relPath?: string) => ipcRenderer.invoke('agent:listFiles', root, relPath ?? ''),
    searchFiles: (root: string, relPath: string, pattern: string, isRegex?: boolean) => ipcRenderer.invoke('agent:searchFiles', root, relPath, pattern, isRegex ?? false),
    findFiles: (root: string, pattern: string) => ipcRenderer.invoke('agent:findFiles', root, pattern),
    execCommand: (root: string, command: string, timeoutMs?: number) => ipcRenderer.invoke('agent:execCommand', root, command, timeoutMs),
    // 内置浏览器：联网搜索与网页抓取（受安全中心网络策略约束）
    webSearch: (query: string, count?: number) => ipcRenderer.invoke('agent:webSearch', query, count),
    webFetch: (url: string, maxChars?: number) => ipcRenderer.invoke('agent:webFetch', url, maxChars),
    // 任务清单（TodoWrite）：维护多步任务的可见进度
    todo: (root: string, action: string, payload?: { content?: string; index?: number; status?: string }) =>
      ipcRenderer.invoke('agent:todo', root, action, payload),
  },

  // File system operations
  fs: {
    readDirTree: (dirPath: string) => ipcRenderer.invoke('fs:readDirTree', dirPath),
  },

  // 应用壁纸（2026-09-25）：图片/视频/HTML 导入 userData/wallpapers/
  wallpaper: {
    chooseFile: (kind: 'image' | 'video' | 'html') => ipcRenderer.invoke('wallpaper:chooseFile', kind),
    list: () => ipcRenderer.invoke('wallpaper:list'),
    remove: (name: string) => ipcRenderer.invoke('wallpaper:remove', name),
  },

  // App info
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    clearAllData: () => ipcRenderer.invoke('app:clearAllData'),
    notify: (title: string, body: string) => ipcRenderer.invoke('app:notify', title, body),
    openBackupDir: () => ipcRenderer.invoke('app:openBackupDir'),
    setTheme: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('app:setTheme', mode),
    // 默认工作目录（对话页的工具链需要一个落盘位置，取不到时返回空串）
    getDefaultWorkDir: () => ipcRenderer.invoke('app:getDefaultWorkDir'),
    // 打开设置独立窗口（2026-09-25：设置页从主窗口弹层改为独立窗口）
    openSettings: () => ipcRenderer.invoke('app:openSettings'),
    // 应用更新（免安装版补丁热替换）：检测版本 / 下载并应用补丁
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    downloadUpdate: (patchUrl: string, sha256: string | null) =>
      ipcRenderer.invoke('app:downloadUpdate', patchUrl, sha256),
    // 启动独立更新器 / 卸载器（外部 exe 接管更新与卸载，主程序随后退出）
    launchUpdater: () => ipcRenderer.invoke('app:launchUpdater'),
    launchUninstaller: () => ipcRenderer.invoke('app:launchUninstaller'),
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
