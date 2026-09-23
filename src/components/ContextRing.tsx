import React, { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { ContextUsagePart } from '../services/agentEngine'

// token 数格式化：327000 → 327.0K，1000000 → 1000.0K
function fmtTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(Math.round(n))
}

// 上下文用量环形指示器（共享）：黑色=已用，灰色=剩余
// 传入 breakdown 时可点击，弹出分类用量明细卡片
const ContextRing: React.FC<{ used: number; max: number; size?: number; breakdown?: ContextUsagePart[] }> = ({
  used,
  max,
  size = 24,
  breakdown,
}) => {
  const [showDetail, setShowDetail] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const pct = Math.min(100, Math.max(0, Math.round((used / max) * 100)))
  const stroke = size <= 16 ? 2.5 : 3
  const r = 12 - stroke
  const circumference = 2 * Math.PI * r
  const arcColor = pct >= 90 ? '#ef4444' : '#1f2937'
  const px = size

  // 点击外部关闭明细
  useEffect(() => {
    if (!showDetail) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowDetail(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showDetail])

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <div
        onClick={breakdown ? () => setShowDetail(!showDetail) : undefined}
        className={breakdown ? 'cursor-pointer' : ''}
        style={{ width: px, height: px }}
        title={`上下文：${used.toLocaleString()} / ${max.toLocaleString()} tokens（${pct}%）${breakdown ? '，点击查看明细' : ''}`}
      >
        <svg viewBox="0 0 24 24" width={px} height={px} className="-rotate-90">
          <circle cx="12" cy="12" r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
          {pct > 0 && (
            <circle
              cx="12" cy="12" r={r} fill="none"
              stroke={arcColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              style={{ transition: 'stroke-dashoffset 0.3s' }}
            />
          )}
        </svg>
        {size >= 20 && (
          <span className="absolute inset-0 flex items-center justify-center text-[7px] font-medium text-gray-500">{pct}</span>
        )}
      </div>

      {/* 明细弹窗 */}
      {showDetail && breakdown && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-30">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-sm font-semibold text-gray-800">上下文用量</span>
            <button
              onClick={() => setShowDetail(false)}
              className="p-1 text-gray-500 hover:text-gray-800 rounded transition-colors"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex items-baseline gap-2 mb-2.5">
            <span className="text-2xl font-bold text-gray-900">{pct}%</span>
            <span className="text-xs text-gray-400">已使用 {fmtTokens(used)}/ {fmtTokens(max)}</span>
          </div>

          {/* 分段用量条 */}
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-3 gap-px">
            {breakdown.filter(b => b.percent > 0.05).map(b => (
              <div key={b.label} style={{ width: `${b.percent}%`, backgroundColor: b.color }} title={`${b.label} ${fmtTokens(b.tokens)}`} />
            ))}
          </div>

          {/* 分类列表 */}
          <div className="space-y-1.5">
            {breakdown.map(b => (
              <div key={b.label} className="flex items-center gap-2 text-xs" title={`${fmtTokens(b.tokens)} tokens`}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                <span className="flex-1 text-gray-600">{b.label}</span>
                <span className="text-gray-400 tabular-nums">{b.percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ContextRing
