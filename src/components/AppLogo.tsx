import React from 'react'

/**
 * deepwork 应用原子图标（与 exe 图标同款造型：深色圆底 + 浅青原子轨道 + 电子点）。
 * 软件内所有代表"应用本体"的位置（标题栏、欢迎页、消息头像、关于页、任务头像）统一用它，
 * 替换原先各自为政的 D 字 / Bot / Sparkles。
 */
export const AppLogo: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 256"
    className={className}
    role="img"
    aria-label="deepwork"
  >
    {/* 深色圆底 */}
    <circle cx="128" cy="128" r="128" fill="#22262F" />
    {/* 两条交叉原子轨道（圆头线条） */}
    <g stroke="#A9E9E3" strokeWidth="10" fill="none" strokeLinecap="round">
      <ellipse cx="128" cy="128" rx="108" ry="49" transform="rotate(-30 128 128)" />
      <ellipse cx="128" cy="128" rx="108" ry="49" transform="rotate(55 128 128)" />
    </g>
    {/* 中心原子核 + 三个轨道上的电子（坐标与 resources/icon.png 完全一致） */}
    <circle cx="128" cy="128" r="16" fill="#A9E9E3" />
    <circle cx="90" cy="36" r="11" fill="#A9E9E3" />
    <circle cx="220" cy="104" r="11" fill="#A9E9E3" />
    <circle cx="61" cy="196" r="11" fill="#A9E9E3" />
  </svg>
)

export default AppLogo
