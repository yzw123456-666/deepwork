import React, { useEffect } from 'react'
import { X, Download, FolderOpen } from 'lucide-react'

/**
 * 本地媒体预览：图片放大查看 + 视频播放。
 *
 * 原理：主窗口 `webPreferences.webSecurity = false`（模型 API 需跨域），
 * 渲染进程因此可以直接用 `file:///` 引用本地文件——`<img>` / `<video>` 都能正常加载播放，
 * 无需把文件内容读成 base64 或注册自定义协议。
 */

export type PreviewableAttachment = {
  path: string
  name: string
  kind: string
  size?: number
  icon: 'image' | 'video' | 'text' | 'file'
  /** 小于此尺寸的图片用真实缩略图渲染，视频一律渲染为可播放的 video 元素 */
}

/** Windows / POSIX 路径 → file:// URL（保留中文与空格，做逐段 encodeURIComponent） */
export function toFileUrl(p: string): string {
  if (!p) return ''
  if (/^file:\/\//i.test(p)) return p
  const normalized = p.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : '/' + normalized
  return 'file://' + withSlash.split('/').map(seg => encodeURIComponent(seg)).join('/')
}

const fmtSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 图片缩略图：用 file:// 直接渲染。
 * 加载失败（路径失效/被安全策略拦截）时调用 onFail，由外部回退到图标卡片。
 */
export const ImageThumb: React.FC<{
  path: string
  alt?: string
  className?: string
  onClick?: () => void
  onFail?: () => void
}> = ({ path, alt, className = '', onClick, onFail }) => {
  const [failed, setFailed] = React.useState(false)
  if (failed) return null
  return (
    <img
      src={toFileUrl(path)}
      alt={alt || ''}
      onClick={onClick}
      onError={() => { setFailed(true); onFail?.() }}
      loading="lazy"
      className={className}
      draggable={false}
    />
  )
}

/**
 * 视频缩略图：用 <video> 首帧（preload=metadata）做封面，右下角叠加时长/播放按钮。
 * 用 paused 状态保证不自动播放、不发声。
 */
export const VideoThumb: React.FC<{
  path: string
  className?: string
  onClick?: () => void
  onFail?: () => void
}> = ({ path, className = '', onClick, onFail }) => {
  const [duration, setDuration] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  if (failed) return null
  return (
    <div className={`relative group/vid ${className}`} onClick={onClick}>
      <video
        src={toFileUrl(path)}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLVideoElement).duration
          if (isFinite(d) && d > 0) {
            const m = Math.floor(d / 60)
            const s = Math.floor(d % 60)
            setDuration(`${m}:${String(s).padStart(2, '0')}`)
          }
        }}
        onError={() => { setFailed(true); onFail?.() }}
        className="w-full h-full object-cover pointer-events-none"
      />
      {/* 播放按钮遮罩 */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover/vid:bg-black/40 transition-colors">
        <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow-md">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#111">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
      {duration && (
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white tabular-nums">
          {duration}
        </div>
      )}
    </div>
  )
}

/**
 * 全屏媒体预览弹层（图片查看 / 视频播放）。
 * - 点击遮罩、右上角关闭、按 Esc 均可关闭
 * - 打开时禁止 body 滚动，关闭后恢复
 * - 支持在系统文件管理器中定位 / 打开原文件
 */
export const MediaPreview: React.FC<{
  item: PreviewableAttachment | null
  onClose: () => void
}> = ({ item, onClose }) => {
  const [failed, setFailed] = React.useState(false)

  useEffect(() => {
    setFailed(false)
  }, [item?.path])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [item, onClose])

  if (!item) return null

  const showFileActions = () => {
    try { window.electronAPI?.shell.showItemInFolder(item.path) } catch { /* ignore */ }
  }
  const openFile = () => {
    try { window.electronAPI?.shell.openPath(item.path) } catch { /* ignore */ }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* 顶部工具条 */}
      <div
        className="flex items-center gap-3 px-4 py-3 text-white/90 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{item.name}</div>
          <div className="text-[11px] text-white/50 truncate">
            {item.kind}{item.size ? ` · ${fmtSize(item.size)}` : ''}
          </div>
        </div>
        <button
          onClick={showFileActions}
          className="p-2 rounded-lg hover:bg-white/15 transition-colors"
          title="在文件夹中显示"
        >
          <FolderOpen size={16} />
        </button>
        <button
          onClick={openFile}
          className="p-2 rounded-lg hover:bg-white/15 transition-colors"
          title="用系统默认程序打开"
        >
          <Download size={16} />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/15 transition-colors"
          title="关闭 (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {/* 内容区 */}
      <div
        className="flex-1 min-h-0 flex items-center justify-center p-4 pt-0"
        onClick={(e) => e.stopPropagation()}
      >
        {failed ? (
          <div className="text-white/70 text-sm text-center">
            <p>无法加载该文件</p>
            <p className="text-white/40 text-xs mt-1 break-all max-w-lg">{item.path}</p>
          </div>
        ) : item.icon === 'video' ? (
          <video
            src={toFileUrl(item.path)}
            controls
            autoPlay
            onError={() => setFailed(true)}
            className="max-w-full max-h-full rounded-lg shadow-2xl bg-black"
          />
        ) : item.icon === 'image' ? (
          <img
            src={toFileUrl(item.path)}
            alt={item.name}
            onError={() => setFailed(true)}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            draggable={false}
          />
        ) : (
          <div className="text-white/70 text-sm text-center">
            <p>该类型暂不支持预览</p>
            <p className="text-white/40 text-xs mt-1 break-all max-w-lg">{item.path}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default MediaPreview
