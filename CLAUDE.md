# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

CialloForDesktop —— 基于 Electron + PixiJS + Live2D 的 Windows 桌面宠物。将柚子社（Yuzu-Soft）丛雨浴衣模型渲染在透明置顶窗口中，支持拖拽、点击互动、鼠标追踪、自动表情切换、设置面板等。

开发环境是 **树莓派 aarch64 Linux**，通过 **GitHub Actions (windows-latest)** 交叉编译为 Windows x64 安装包/便携版/ZIP。

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

# 生成图标 (需要 Python 3 + Pillow)
python3 scripts/generate-icons.py

# CI 构建 Windows 安装包 (在 GitHub Actions 上执行)
npm run build
# 等价于: download:core → build:renderer → electron-builder --win --x64
```

### 前置条件

- **Node.js 20+** (CI 使用 22)
- **npm 9+**
- **Python 3 + Pillow** (图标生成: `pip3 install Pillow`)
- **Linux/macOS 开发**：仅能构建 renderer bundle；Windows 安装包需 GitHub Actions 或 Windows 环境

## 关键架构

### 进程模型

| 文件 | 职责 |
|------|------|
| `main/main.js` | Electron 主进程：透明窗口、系统托盘、IPC 路由、设置应用 |
| `main/settings.js` | 纯数据层：默认值、验证、加载/保存 JSON |
| `main/settings-window.js` | 设置窗口管理 (480x620 modal，单例模式) |
| `main/preload.js` | 主窗口 contextBridge：暴露 `window.electronAPI` |
| `main/preload-settings.js` | 设置窗口 contextBridge：暴露 `window.settingsAPI` |
| `src/renderer.js` | PixiJS + Live2D 渲染，由 esbuild 打包为 `dist/renderer.js` |
| `src/settings-renderer.js` | 设置面板 UI 渲染和交互逻辑 |
| `src/index.html` + `style.css` | 主窗口（透明背景，只放 canvas） |
| `src/settings.html` + `settings.css` | 设置面板的粉色主题 HTML/CSS |

### 数据流

```
renderer 进程 → IPC → main 进程 → 验证/存储 → 广播到所有窗口
                                        ↓
                               settings.json (userData)
```

### Renderer 初始化顺序

`src/renderer.js` 的 `main()` 执行顺序：
1. 检查 `Live2DCubismCore` 是否加载
2. 通过 IPC 加载初始设置
3. 初始化 PixiJS Application（透明背景，autoResize）
4. 加载 Live2D 模型（`Live2DModel.from(modelUrl)`，自动调整窗口大小）
5. 初始化交互系统（拖拽、鼠标追踪、键盘快捷键、resize 处理）
6. 启动动画系统（表情循环 + idle 呼吸动画）
7. 监听设置变更
8. 通知主进程 `window-ready`

### 交互系统

| 交互 | 触发 | 行为 |
|------|------|------|
| 拖拽 | `mousedown` + `mousemove` | 通过 IPC 移动窗口位置（3px 死区防误触） |
| 点击反应 | `mouseup` 且无拖拽移动 | 50% 概率随机切换表情，20% 概率脸红 2 秒 |
| 鼠标追踪 | `mousemove` 在 canvas 内 | 更新模型 `focus(x, y)`，30fps 节流 |
| 鼠标离开 | `mouseleave` | 重置 `focus(0, 0)` |
| 键盘快捷键 | `keydown` | 见下方快捷键表 |

### 动画系统

- **表情循环**：`setTimeout` 调度，每隔 `expressionInterval` 秒随机切换表情
- **Idle 动画**：PixiJS ticker 驱动，模拟呼吸（`ParamBodyAngleZ` 摇摆 + `ParamBreath` 起伏）

### 表情列表

```js
EXPRESSIONS = [
  '01_LianHei',   // 脸黑（默认表情）
  '02_LianHei2',  // 脸黑2
  '03_GaoGuang',  // 高光
  '04_LiuHan',    // 流汗
  '05_LianHong',  // 脸红
  '06_KuMei',     // 哭眉
  '07_HengYan',   // 横眼
  '08_qYan',      // Q眼
]
```

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+T` | 切换点击穿透模式 |
| `Esc` | 重置表情为 `01_LianHei` |
| `1` - `8` | 切换到对应编号的表情 |

### IPC 通信

**主窗口通道** (`window.electronAPI`)：

| 方向 | 通道 | 用途 |
|------|------|------|
| `send` | `window-move-by` | 移动窗口 (dx, dy) |
| `send` | `window-set-position` | 设置窗口位置 (x, y) |
| `invoke` | `window-get-position` | 获取窗口位置 |
| `send` | `window-set-size` | 设置窗口大小 (width, height) |
| `invoke` | `window-get-size` | 获取窗口大小 |
| `invoke` | `screen-get-info` | 获取屏幕尺寸 |
| `send` | `toggle-click-through` | 切换点击穿透 |
| `invoke` | `is-click-through` | 获取点击穿透状态 |
| `send` | `window-ready` | 通知主进程窗口就绪 |
| `send` | `open-settings` | 打开设置窗口 |
| `on` | `settings:changed` | 监听设置变更广播 |

**设置窗口通道** (`window.settingsAPI`)：

| 方向 | 用途 |
|------|------|
| `invoke` | `settings:get` — 获取当前设置 |
| `invoke` | `settings:update(key, value)` — 更新单条设置，自动验证 |
| `invoke` | `settings:reset` — 重置为默认 |
| `on` | `settings:changed` — 监听设置变更广播 |
| `invoke` | `settings:open-external(url)` — 打开外部链接 |

### 设置架构（`main/settings.js`）

完整设置对象及约束：

```js
{
  modelScale: 0.85,           // 0.3 ~ 1.5
  alwaysOnTop: true,
  windowOpacity: 1.0,         // 0.3 ~ 1.0
  clickThrough: false,
  dragEnabled: true,
  clickReaction: true,
  mouseTracking: true,
  expressionCycle: true,
  expressionInterval: 30,     // 10 ~ 120 秒
  idleAnimation: true,
  autoStart: false,
  minimizeToTray: true,
}
```

- `validate()` 自动裁剪值到约束范围，缺失值用默认值填充
- 损坏的 JSON 文件自动备份为 `.bak` 后缀
- 设置保存在 `app.getPath('userData')/ciallo-settings.json`

### 窗口管理

- **透明窗口**：`transparent: true`, `frame: false`, `backgroundColor: '#00000000'`
- **置顶**：`alwaysOnTop: true`（可在设置中关闭）
- **点击穿透**：`setIgnoreMouseEvents(true, { forward: true })`
- **不显示在任务栏**：`skipTaskbar: true`
- **窗口大小自适应**：`adjustWindowSize()` 计算模型包围盒 + 20px padding，上限 800x1000
- **单实例锁**：`app.requestSingleInstanceLock()` 防止多开

### 系统托盘

- 图标来源：`assets/app-icon.png`（通过 Python Pillow 生成为真正的 256x256 RGBA PNG）
- 缩放至 32x32 供 Windows 托盘使用
- 菜单项：显示/隐藏、打开设置、点击穿透切换、关于、退出

### CI/CD（`.github/workflows/build.yml`）

| Job | 触发条件 | 功能 |
|-----|----------|------|
| `build` | push main / tag v\* / workflow_dispatch | windows-latest 构建 3 种 artifact（.exe 安装包、.exe 便携版、.zip 压缩包），上传到 Actions artifact |
| `release` | tag v\*（依赖 build） | 创建 GitHub Draft Release，附加 3 种 artifact |
| `publish-package` | tag v\*（依赖 build） | 发布 `@yttbz/ciallo-for-desktop` 到 GitHub Packages（npm registry） |

### 构建产物

| 目标 | 文件名模式 | 说明 |
|------|-----------|------|
| NSIS 安装包 | `CialloForDesktop-<version>-Setup.exe` | 可自定义安装目录，创建桌面/开始菜单快捷方式 |
| 便携版 | `CialloForDesktop-<version>-Portable.exe` | 免安装直接运行，数据在 `%LOCALAPPDATA%` |
| ZIP | `CialloForDesktop-<version>-x64.zip` | 绿色压缩包 |

### 图标生成（`scripts/generate-icons.py`）

- 用 Python Pillow 从源文件生成真正的 RGBA PNG 图标
- 输入源：`build/tray-icon.png`（支持 PNG/WebP 格式）
- 输出：16/32/64/128/256 尺寸 PNG + 多页 ICO（16/32/48/256）
- ICO 格式：手动 struct 打包，使用 PNG 数据包裹（现代 Windows 标准）
- CI 中不自动运行，需手动生成后提交

## 依赖关键点

- **`pixi-live2d-display@0.4.0`**：必须从 `pixi-live2d-display/cubism4` 导入（默认入口需要 Cubism 2 运行时 `window.Live2D`）
- **`pixi.js@^6.5.10`**：v6 系，v7+ 不兼容 pixi-live2d-display v0.4.0
- **`esbuild`**：打包 renderer（pixi.js 是 ESM，需要 bundler）
- **`electron@^33`** + **`electron-builder@^26`**
- **`@yttbz/ciallo-for-desktop`**：scoped npm 包名，发布到 GitHub Packages
- **Python 3 + Pillow**：开发时生成图标用，CI 不需要

## 安全与注意事项

### 内容安全策略 (CSP)

`index.html` 中定义的 CSP：
```
default-src 'self' 'unsafe-inline' 'unsafe-eval';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
img-src 'self' file: data:;
media-src 'self' file:;
connect-src 'self' file:;
```

- `'unsafe-eval'` 是 pixi-live2d-display 需要的（评估 cubism 模型中的脚本）
- `'unsafe-inline'` 是 PixiJS 和 esbuild 产物需要的

### 安全性

- `contextIsolation: true` — 渲染进程隔离
- `nodeIntegration: false` — 渲染进程无 Node 访问
- `sandbox: false` — 需要访问 `preload.js` 中的 `ipcRenderer`
- 所有 `BrowserWindow` 使用独立的 preload 脚本
- 不提交 `.env` 文件到 git

### .gitignore 排除

```
node_modules/       # 依赖
dist/               # esbuild 产物 (renderer bundle)
cubism-core/        # Live2D SDK（构建时自动下载）
*.7z                # 模型压缩包
.env / .env.*       # 环境变量
```

### 注意事项

- **模型文件**（`assets/model/Murasame_Yukata/`）：太大且涉及版权，不提交 git，从外部 ZIP 解压
- **Cubism Core**（`cubism-core/`）：Live2D 专有 SDK，不提交 git，`npm start` / `npm run build` 自动从 Live2D CDN 下载
- **图标文件**：由 `scripts/generate-icons.py` 用 Python Pillow 生成，ICO 格式为 PNG 数据包裹在 ICO 容器中
- **模型**：Murasame_Yukata.moc3 (~800KB) + Murasame_Yukata.8192 纹理目录
- **窗口透明边缘 padding**：20px，`adjustWindowSize()` 控制窗口紧贴模型
- **模型版权**：© ゆずソフト (Yuzu-Soft)，仅供个人使用，不得商用或单独分发
- **Live2D Cubism Core**：Live2D Inc. 专有软件，不得在未授权情况下分发
- **项目代码**：MIT 开源，贡献者包含 Claude AI (Anthropic)
