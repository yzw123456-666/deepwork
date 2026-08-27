import React, { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'

const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI) {
        const maximized = await window.electronAPI.window.isMaximized()
        setIsMaximized(maximized)
      }
    }
    checkMaximized()
    window.electronAPI?.app.getInfo().then((info: any) => {
      if (info?.version) setVersion(info.version)
    }).catch(() => {})
  }, [])

  const handleMinimize = () => window.electronAPI?.window.minimize()
  const handleMaximize = async () => {
    await window.electronAPI?.window.maximize()
    const maximized = await window.electronAPI?.window.isMaximized()
    setIsMaximized(maximized ?? false)
  }
  const handleClose = () => window.electronAPI?.window.close()

  return (
    <div className="titlebar flex items-center justify-between bg-white border-b border-gray-200 h-8 px-2 select-none">
      <div className="flex items-center gap-2 pl-2">
        <div className="w-5 h-5 bg-gradient-to-br from-primary-400 to-primary-600 rounded flex items-center justify-center">
          <span className="text-white text-xs font-bold">M</span>
        </div>
        <span className="text-sm font-medium text-gray-700">Many AI</span>
        {version && <span className="text-xs text-gray-400">v{version}</span>}
      </div>
      <div className="flex items-center gap-0.5 titlebar-button">
        <button
          onClick={handleMinimize}
          className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
        >
          <Minus size={14} className="text-gray-600" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" className="text-gray-600">
              <rect x="2" y="0" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="0" y="2" width="8" height="8" rx="1" fill="white" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <Square size={11} className="text-gray-600" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center hover:bg-red-500 hover:text-white rounded transition-colors group"
        >
          <X size={14} className="text-gray-600 group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
