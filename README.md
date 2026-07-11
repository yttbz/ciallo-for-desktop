# Ciallo～(∠?ω< )⌒★! — Live2D Desktop Pet

一款基于 Live2D 的 Windows 桌面宠物，使用柚子社（Yuzu-Soft）的丛雨（Murasame）浴衣模型。

## 预览效果

（安装后运行即可看到丛雨酱在桌面上）

## 功能

- 🖼️ **透明窗口** - 模型显示在透明窗口上，始终置顶
- 🖱️ **拖动移动** - 点击并拖动模型在桌面上随意摆放
- 👀 **鼠标追踪** - 眼睛跟随鼠标移动
- 😊 **表情切换** - 8种表情随机切换，点击有反应
  - 脸黑、脸黑2、高光、流汗、脸红、哭眉、横眼、Q眼
- 📦 **系统托盘** - 右键托盘图标显示菜单
- 🔄 **点击穿透** - 切换穿透模式，不影响其他窗口操作
- ⌨️ **快捷键** - Ctrl+T 切换穿透，Esc 重置表情，1-8 数字键切换对应表情

## 技术栈

- **Electron** - 桌面窗口框架
- **PixiJS 6** - WebGL 渲染
- **pixi-live2d-display** - Live2D 模型渲染
- **Live2D Cubism 4 SDK R4** - Cubism 核心引擎（纯 JS 实现）
- **esbuild** - 打包工具
- **electron-builder** - Windows 安装包构建

## 模型版权

- 模型: **浴衣丛雨 (Murasame Yukata)**
- 版权: **© ゆずソフト (Yuzu-Soft)**
- 仅供个人使用，请勿用于直播或商业用途

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

# 构建 Windows 安装包
npm run build
```

### 通过 GitHub Actions 构建

1. 推送到 GitHub
2. 触发 `Build Windows Desktop Pet` workflow
3. 下载生成的 `CialloForDesktop-Setup.exe` 安装包

## 使用说明

1. 安装运行后，丛雨酱会出现在屏幕中央
2. 点击并拖动可以移动位置
3. 右键系统托盘图标可打开菜单
4. 点击模型会随机切换表情（有一定几率脸红）
5. 使用键盘 1-8 键直接切换对应表情

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+T | 切换点击穿透模式 |
| Esc | 重置为默认表情 |
| 1-8 | 切换到对应编号的表情 |
