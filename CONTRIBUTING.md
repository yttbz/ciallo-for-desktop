# Contributing to CialloForDesktop

感谢您考虑为 CialloForDesktop 做出贡献！

## 开发环境

本项目在 **树莓派 aarch64 Linux** 上开发，通过 GitHub Actions 交叉编译为 Windows x64 应用。
您可以在任何支持 Node.js 20+ 的系统上进行开发。

```bash
# 克隆仓库
git clone https://github.com/yttbz/ciallo-for-desktop.git
cd ciallo-for-desktop

# 安装依赖
npm install

# 下载 Cubism Core
npm run download:core

# 启动开发模式
npm start
```

## 提交 Pull Request

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开一个 Pull Request

### PR 指南

- 请使用清晰的提交信息，遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
- 确保构建通过：`npm run build`
- 如果有新功能，请更新 README
- 保持代码风格一致

## Issue 报告

提交 Issue 时，请提供：

- 问题描述
- 复现步骤
- 预期行为和实际行为
- 截图（如果适用）
- 系统环境信息

## 代码风格

- 使用 2 空格缩进
- 使用 `const` 和 `let`，不要使用 `var`
- 遵循 ES2020+ 标准
- 文件编码：UTF-8

## 许可

通过提交 Pull Request，您同意您的贡献将在 MIT 许可证下授权。
