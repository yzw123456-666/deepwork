// ---------- 应用壁纸渲染层（2026-09-25，参考 Wallpaper Engine） ----------
// 铺在窗口最底层（absolute inset-0），TitleBar / 侧栏 / 内容区叠在其上：
// 侧栏走毛玻璃（blur 由 --wp-blur 变量控制），内容区根透明直接透出壁纸，
// 气泡/卡片保持实底保证可读性；暗化遮罩（dim）进一步护住文字对比度。
import React, { useEffect, useState } from 'react'
import { useAppStore } from '../stores'
import { toFileUrl } from '../services/wallpaperFile'
import { findBuiltinWallpaper } from '../services/builtinWallpapers'

const WallpaperLayer: React.FC = () => {
  const config = useAppStore(s => s.config) as any
  const wp = config?.wallpaper
  const [failed, setFailed] = useState(false)

  // 类型或目标变化时重置加载失败状态
  useEffect(() => { setFailed(false) }, [wp?.type, wp?.value])

  const dim = Math.min(Math.max(typeof wp?.dim === 'number' ? wp.dim : 0.35, 0), 0.75)
  const type: string = wp?.type ?? 'none'

  let content: React.ReactNode = null
  if (type === 'builtin' && wp?.value) {
    const b = findBuiltinWallpaper(String(wp.value))
    content = b ? b.render() : null
  } else if (type === 'image' && wp?.value) {
    content = failed ? null : (
      <img
        src={toFileUrl(String(wp.value))}
        className="absolute inset-0 w-full h-full object-cover"
        alt=""
        onError={() => setFailed(true)}
        draggable={false}
      />
    )
  } else if (type === 'video' && wp?.value) {
    content = failed ? null : (
      <video
        src={toFileUrl(String(wp.value))}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay loop muted playsInline
        onError={() => setFailed(true)}
      />
    )
  } else if (type === 'html' && wp?.value) {
    content = (
      <iframe
        src={toFileUrl(String(wp.value))}
        title="wallpaper-html"
        className="absolute inset-0 w-full h-full border-0"
      />
    )
  } else if (type === 'url' && wp?.value) {
    content = (
      <iframe
        src={String(wp.value)}
        title="wallpaper-url"
        className="absolute inset-0 w-full h-full border-0"
      />
    )
  }

  if (!content) return null

  return (
    <div className="absolute inset-0 z-0 pointer-events-none select-none" aria-hidden>
      {content}
      {/* 加载失败兜底：深色底 + 提示（不打断使用） */}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <span className="text-gray-500 text-sm">壁纸文件加载失败，请重新选择</span>
        </div>
      )}
      {/* 暗化遮罩：护住 UI 文字对比度 */}
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  )
}

export default WallpaperLayer
