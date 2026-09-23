/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 主题色由 CSS 变量驱动：index.css 里按 [data-accent=xxx] 用 hsl() 定义实色。
        // 这里直接返回完整颜色值，透明度由 color-mix 在需要处处理，
        // 因此不再使用 <alpha-value>（它要求变量是 RGB 三元组，而主题色需要 HSL 才方便调色相）。
        primary: {
          50: 'var(--p-50)',
          100: 'var(--p-100)',
          200: 'var(--p-200)',
          300: 'var(--p-300)',
          400: 'var(--p-400)',
          500: 'var(--p-500)',
          600: 'var(--p-600)',
          700: 'var(--p-700)',
          800: 'var(--p-800)',
          900: 'var(--p-900)',
        },
        // 中性色阶同样变量驱动，让白底/灰阶带上主题色温
        surface: {
          DEFAULT: 'var(--c-0)',
          25: 'var(--c-25)',
          50: 'var(--c-50)',
          100: 'var(--c-100)',
          200: 'var(--c-200)',
          300: 'var(--c-300)',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}
