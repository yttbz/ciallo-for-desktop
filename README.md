# Ciallo~(∠?ω< ) - Live2D Desktop Pet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/yttbz/ciallo-for-desktop)](https://github.com/yttbz/ciallo-for-desktop/releases/latest)
[![Windows Build](https://github.com/yttbz/ciallo-for-desktop/actions/workflows/build.yml/badge.svg)](https://github.com/yttbz/ciallo-for-desktop/actions/workflows/build.yml)

一款基于 Live2D 的 Windows 桌面宠物，使用柚子社（Yuzu-Soft）的丛雨（Murasame）浴衣模型。

## 预览效果

![]()

## 功能

- **透明窗口** - 模型显示在透明窗口上，始终置顶
- **拖动移动** - 点击并拖动模型在桌面上随意摆放
- **鼠标追踪** - 眼睛跟随鼠标移动
- **表情切换** - 8种表情随机切换，点击有反应
  - 脸黑、脸黑2、高光、流汗、脸红、哭眉、横眼、Q眼
- **系统托盘** - 右键托盘图标显示菜单
- **点击穿透** - 切换穿透模式，不影响其他窗口操作
- **快捷键** - Ctrl+T 切换穿透，Esc 重置表情，1-8 数字键切换对应表情

## 技术栈

- **Electron** - 桌面窗口框架
- **PixiJS 6** - WebGL 渲染
- **pixi-live2d-display** - Live2D 模型渲染
- **Live2D Cubism 4 SDK R4** - Cubism 核心引擎（纯 JS 实现）
- **esbuild** - 打包工具
- **electron-builder** - Windows 安装包构建

## 模型版权与法律声明

> **重要法律声明**
>
> 本项目代码采用 **MIT 许可证** 开源，但请注意以下限制：

| 组件 | 许可类型 | 版权方 |
|------|----------|--------|
| 项目源代码（除下方列出的组件外） | MIT 开源 | yttbz |
| Live2D Cubism Web Core (Cubism 4 SDK R4) | **专有软件** | Live2D Inc. |
| 浴衣丛雨 Live2D 模型 (Murasame Yukata) | **版权所有，仅限个人使用** | (C) Yuzu-Soft |

### 你必须遵守的

- 可以自由使用、修改、分发本项目**代码**（MIT 许可）
- **不得**在未经授权的情况下分发 Live2D Cubism Core 文件
- **不得**将浴衣丛雨模型用于商业用途（直播、视频、商业软件等）
- **不得**在未经 Yuzu-Soft 授权的情况下单独分发模型文件

详细法律声明请参阅 [DISCLAIMER.md](./DISCLAIMER.md)。

## 构建方法

### 前置条件

- Node.js 20+
- npm 9+

### 本地开发

```bash
# 安装依赖
npm install

# 下载 Cubism Core
npm run download:core

# 构建 renderer
npm run build:renderer

# 启动应用（需要 Windows/macOS/Linux 桌面环境）
npm start

# 构建 Windows 安装包 + 便携版
npm run build
```

### 通过 GitHub Actions 构建

1. 推送到 GitHub
2. 触发 `Build Windows Desktop Pet` workflow
3. 从 Release 页面下载安装包或便携版

## 使用说明

1. 安装运行后，丛雨酱会出现在屏幕中央
2. 点击并拖动可以移动位置
3. 右键系统托盘图标可打开菜单
4. 点击模型会随机切换表情（有一定几率脸红）
5. 使用键盘 1-8 键直接切换对应表情

### 便携版 (Portable)

下载 `CialloForDesktop-*-Portable.exe`，直接运行即可，无需安装。用户数据存储在：

- NSIS 安装版：`%APPDATA%/Ciallo~(∠?ω< )/`
- 便携版：`%LOCALAPPDATA%/CialloForDesktop-Portable/`

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+T | 切换点击穿透模式 |
| Esc | 重置为默认表情 |
| 1-8 | 切换到对应编号的表情 |

## 致谢

- **Claude (Anthropic)** -- 代码生成、调试协助与技术指导
- **pixi-live2d-display** -- Live2D 渲染库
- **Electron** -- 桌面应用框架
- **Live2D Inc.** -- Cubism SDK
- **Yuzu-Soft / 柚子社** -- 丛雨（Murasame）模型版权方

## 贡献

欢迎提 Issue 或 Pull Request！请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md)。
