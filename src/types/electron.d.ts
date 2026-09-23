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
  }
  fs: {
    readDirTree: (dirPath: string) => Promise<DirTreeItem[]>
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
