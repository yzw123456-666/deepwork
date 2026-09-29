// 设置独立窗口入口（2026-09-25）：设置页从主窗口弹层改为独立 BrowserWindow，
// 本文件是 settings.html 的 React 入口——复用 SettingsPanel 组件（standalone 模式铺满窗口）。
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import SettingsPanel from './components/SettingsPanel'
import { useAppStore } from './stores'
import './index.css'
import './i18n'

const SettingsWindow: React.FC = () => {
  const { loaded, loadAll, config } = useAppStore()

  useEffect(() => { loadAll() }, [])

  // 主题（light/dark/system + accent 色相）跟随配置；壁纸不进设置窗口（普通底色即可）
  useEffect(() => {
    const mode = config.theme ?? 'light'
    const accent = config.accent || 'sky'
    const root = document.documentElement
    if (accent && accent !== 'sky') root.setAttribute('data-accent', accent)
    else root.removeAttribute('data-accent')
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && !!mq?.matches)
      if (dark) root.setAttribute('data-theme', 'dark')
      else root.removeAttribute('data-theme')
      try { window.electronAPI?.app.setTheme?.(dark ? 'dark' : 'light') } catch { /* 忽略 */ }
    }
    apply()
    if (mode !== 'system' || !mq) return
    if (mq.addEventListener) mq.addEventListener('change', apply)
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', apply) }
  }, [config.theme, config.accent])

  // 接收其他窗口（主窗口）的配置变更广播，保持本窗口实时同步
  useEffect(() => {
    return window.electronAPI?.config.onChange?.((key, value) => {
      const cur = useAppStore.getState().config as any
      useAppStore.setState({ config: { ...cur, [key]: value } })
    })
  }, [])

  if (!loaded) return <div className="h-screen bg-gray-50" />

  return <SettingsPanel standalone onClose={() => window.close()} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<SettingsWindow />)
