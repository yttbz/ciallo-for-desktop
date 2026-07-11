# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

CialloForDesktop —— 基于 Electron + PixiJS + Live2D 的 Windows 桌面宠物。将柚子社（Yuzu-Soft）丛雨浴衣模型渲染在透明置顶窗口中，支持拖拽、点击互动、鼠标追踪、自动表情切换、设置面板等。

开发环境是 **树莓派 aarch64 Linux**，通过 **GitHub Actions (windows-latest)** 交叉编译为 Windows x64 NSIS 安装包。

## 构建与运行

```bash
# 安装依赖
npm install

# 下载 Live2D Cubism Web Core (SDK R4，从 Live2D CDN)
npm run download:core

# 本地开发运行 (自动下载 Core + 打包 renderer)
npm start

# 单独打包 renderer (esbuild)
npm run build:renderer

# CI 构建 Windows 安装包 (在 GitHub Actions 上执行)
npm run build
# 等价于: download:core → build:renderer → electron-builder --win --x64
```

## 关键架构

### 数据流

```
renderer 进程 → IPC → main 进程 → 验证/存储 → 广播到所有窗口
                                        ↓
                               settings.json (userData)
```

### 进程模型

| 文件 | 职责 |
|------|------|
| `main/main.js` | Electron 主进程：透明窗口、系统托盘、IPC 路由、设置应用 |
| `main/preload.js` | 主窗口 contextBridge：暴露 `window.electronAPI` |
| `main/settings.js` | 纯数据层：默认值、验证、加载/保存 JSON |
| `main/settings-window.js` | 设置窗口管理 (480x620 modal) |
| `main/preload-settings.js` | 设置窗口 contextBridge：暴露 `window.settingsAPI` |

| 文件 | 职责 |
|------|------|
| `src/renderer.js` | PixiJS + Live2D 渲染，由 esbuild 打包为 `dist/renderer.js` |
| `src/settings-renderer.js` | 设置面板 UI 渲染和交互逻辑 |
| `src/settings.html` + `settings.css` | 设置面板的粉色主题 HTML/CSS |
| `src/index.html` + `style.css` | 主窗口（透明背景，只放 canvas） |

### 依赖关键点

- `pixi-live2d-display@0.4.0`：**必须从 `pixi-live2d-display/cubism4` 导入**（默认入口需要 Cubism 2 运行时 `window.Live2D`）
- `pixi.js@^6.5.10`：v6 系，v7+ 不兼容 pixi-live2d-display v0.4.0
- `esbuild`：打包 renderer（pixi.js 是 ESM，需要 bundler）
- `electron@^33` + `electron-builder@^26`

### 设置面板架构

- 四标签页：显示 / 交互 / 动画 / 关于
- 开关组件 (iOS 风格 switch) + 滑块 + 尺寸选择器
- 修改通过 IPC 发送到主进程，主进程验证后保存到 `userData/ciallo-settings.json`，再广播给所有窗口
- 设置窗口是 modal 子窗口，单例模式（已打开时 focus 复用）

### CI/CD

- `.github/workflows/build.yml`：push 到 main / 打 tag v* 时触发
- `windows-latest` runner + Node 22 + `npm ci`
- 步骤：install → download:core → esbuild → electron-builder → 上传 .exe artifact
- release job：tag 触发，打 draft release，附加 .exe

### 注意事项

- 模型文件（`assets/model/Murasame_Yukata/`）太大，不提交 git，从外部 ZIP 解压
- Cubism Core（`cubism-core/`）不提交 git，构建时 `npm start` / `npm run build` 自动下载
- 图标文件由 `scripts/generate-icons.js` 生成，ICO 格式为 PNG 封装在 ICO 容器
- 窗口透明边缘 padding 为 20px，`adjustWindowSize()` 控制窗口紧贴模型
- 模型版权：© ゆずソフト (Yuzu-Soft)，仅供个人使用
