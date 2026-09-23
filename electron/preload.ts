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
  },

  // File system operations
  fs: {
    readDirTree: (dirPath: string) => ipcRenderer.invoke('fs:readDirTree', dirPath),
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
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
