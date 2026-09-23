# deepwork - 桌面 AI 助手

一个基于 Electron + React + TypeScript 的桌面 AI 助手，支持多模型协作完成复杂任务。

A Multi-Agent Desktop Application built with Electron + React + TypeScript, supporting multi-model collaboration for complex tasks.

---

## ✨ Features / 功能特性

### 🤖 Multi-Agent Collaboration / 多智能体协作
- **Task Orchestration Engine** / 任务编排引擎：Auto-split complex tasks, assign to different models for parallel execution / 自动将复杂任务拆分为子任务，分配给不同模型并行执行
- **Main Model Review** / 主模型验收：Quality review after sub-task completion, auto-rework on failure / 子任务完成后由主模型进行质量审查，不合格自动返工修正
- **Independent Context** / 独立思考链：Each sub-task has independent context, no cross-contamination / 每个子任务拥有独立上下文，不互相污染
- **Conflict Detection** / 覆盖冲突检测：Auto-detect when multiple models modify the same file / 自动检测多模型同时修改同一文件的冲突

### 🧠 Smart Context Management / 智能上下文管理
- **Shared Context Ring** / 共享上下文环：Black arc = used, gray arc = remaining, intuitive token display / 黑弧=已用，灰弧=剩余，直观显示token消耗
- **80% Auto-Compaction** / 80%自动压缩：LLM-based summary (not brute-force truncation), preserving task goals/file paths/code/unfinished items / 使用LLM摘要（非暴力截断），保留任务目标/文件路径/代码/未完成项
- **Anti-Thrash Guard** / 防抖保护：Requires ≥4 new messages before compression to avoid frequent calls / ≥4条新消息后才触发压缩，避免频繁调用

### 🎯 Real-time Interaction / 实时交互系统
- **Three-color Thinking Chain** / 三色思考链：Blue breathing → Black expanded → White text collapsed / 蓝色呼吸动画→黑色展开→折叠后白色文字
- **Tool Result Cards** / 工具结果卡片：Expandable tool call details (read/write files, execute commands) / 可展开的工具调用详情（读写文件、执行命令等）
- **Security Warning Cards** / 安全警告卡片：Dangerous commands (rm -rf/del /f etc.) intercepted and confirmed / 危险命令（rm -rf/del /f等）拦截并确认
- **Inline Question Options** / 内联问答选项：Numbered buttons for direct selection, no popup needed / 编号按钮直接选择，无需弹窗

### 📋 Task Management / 任务管理
- **Collapsible Task Panel** / 折叠式任务面板：Show completed/in-progress/pending task counts / 显示已完成/进行中/待处理任务数量
- **Sidebar AI Status** / 侧边栏AI状态：Real-time context usage display for each model / 实时显示每个模型的上下文使用率
- **Independent Workspace** / 独立工作区：Click task card to enter dedicated chat interface / 点击任务卡片进入专属聊天界面

### 🌐 Internationalization / 国际化
- Chinese / English bilingual support / 中英文双语切换
- Auto-detect system language / 自动检测系统语言

---

## 🛠️ Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| Frontend / 前端框架 | React 18 + TypeScript |
| UI Styling / UI样式 | Tailwind CSS |
| State Management / 状态管理 | Zustand (persisted to Electron Store) |
| Routing / 路由 | React Router v6 |
| Markdown | react-markdown + remark-gfm + react-syntax-highlighter |
| Icons / 图标 | Lucide React |
| i18n | react-i18next |
| Desktop Framework / 桌面框架 | Electron 32 |
| Build Tool / 构建工具 | Vite 5 |
| Packaging / 打包 | electron-builder |

---

## 🚀 Quick Start / 快速开始

### Requirements / 环境要求
- Node.js >= 18
- npm >= 9

### Development Mode / 开发模式
```bash
# Install dependencies / 安装依赖
npm install

# Start dev server / 启动开发服务器
npm run electron:dev
```

### Build & Package / 构建打包
```bash
# Windows NSIS Installer / Windows安装包
npm run electron:build:win

# Windows Portable / Windows便携版
npm run electron:build:portable
```

---

## 📁 Project Structure / 项目结构

```
src/
├── components/          # UI Components / UI组件
│   ├── ChatMessage.tsx     # Chat message rendering / 聊天消息渲染
│   ├── ContextRing.tsx     # Shared context ring / 共享上下文环组件
│   ├── InputArea.tsx       # Input area with file upload / 输入区域
│   ├── Markdown.tsx        # Markdown renderer / Markdown渲染器
│   ├── Sidebar.tsx         # Sidebar with AI status / 侧边栏
│   ├── TaskChecklist.tsx   # Task checklist / 任务检查清单
│   ├── TaskWorkspace.tsx   # Task workspace / 任务工作区
│   └── ThinkingBlock.tsx   # Collapsible thinking chain / 可折叠思考链
├── engine/              # Task orchestration engine / 任务编排引擎
│   └── agentEngine.ts      # Core: runAgentLoop + orchestrate / 核心引擎
├── hooks/               # Custom Hooks / 自定义Hooks
├── i18n/                # Internationalization / 国际化配置
├── stores/              # State management / 状态管理
├── types/               # TypeScript types / 类型定义
├── utils/               # Utilities / 工具函数
├── App.tsx              # Main app / 主应用
└── main.tsx             # Entry point / 入口
electron/
├── preload.ts           # Preload script / 预加载脚本
└── main.ts              # Electron main process / 主进程
```

---

## 🎮 User Guide / 使用指南

1. **New Session / 新建会话**：Click "+" in sidebar / 点击侧边栏"+"按钮
2. **Switch Session / 切换会话**：Click session entry / 点击侧边栏会话条目
3. **Select Model / 选择模型**：Click model tag above input / 点击输入框上方模型标签
4. **New Task / 新建任务**：Click "+新任务" button / 点击"+新任务"按钮
5. **Upload File / 上传文件**：Click attachment icon or drag & drop / 点击附件图标或直接拖拽
6. **View Thinking / 查看思考**：Click "查看完整思考过程" / 点击"查看完整思考过程"
7. **Collapse/Expand / 折叠/展开**：Click blue title bar / 点击蓝色标题栏
8. **Switch Language / 切换语言**：Click language icon in sidebar / 点击侧边栏底部语言图标

---

## ⚙️ Configuration / 配置

In the Settings page, you can: / 在"设置"页面中可以：
- Add/Edit/Delete AI models / 添加/编辑/删除AI模型
- Configure API address, key, parameters / 配置模型API地址、密钥、参数
- Set main model (with 👑 crown icon) / 设置主模型（带皇冠👑标识）
- Adjust temperature, Top-P, etc. / 调整温度、Top-P等生成参数

---

## 📦 Download / 下载

Go to [Releases](https://github.com/yzw123456-666/deepwork/releases) page to download the latest installer.

前往 [Releases](https://github.com/yzw123456-666/deepwork/releases) 页面下载最新安装包。

---

## 📄 License

MIT License / MIT 许可证
