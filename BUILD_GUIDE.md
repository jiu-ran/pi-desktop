# Pi Desktop v0.1.0 - 各平台构建指南

## 📦 当前已构建版本

### Windows (已完成 ✅)

**安装程序**：
- 文件名：`Pi Desktop Setup 0.1.0.exe`
- 大小：106 MB
- 类型：NSIS 安装程序
- 特性：允许用户选择安装路径，支持卸载

**便携版**：
- 文件名：`Pi Desktop-0.1.0-win.zip`
- 大小：143 MB
- 类型：ZIP 压缩包
- 特性：无需安装，解压即用

**位置**：`dist/` 目录下

---

## 🔨 macOS 和 Linux 构建方案

### 环境要求

```bash
# 安装 Node.js 18+
node --version  # v18.0.0+
npm --version   # 9.0.0+

# macOS 特殊要求
# - Xcode Command Line Tools
xcode-select --install

# Linux 特殊要求
# - Python 3
# - GCC/G++ 编译工具
sudo apt-get install build-essential python3
```

### 快速构建步骤

#### macOS（Intel 和 Apple Silicon）

```bash
cd /path/to/pi-desktop

# 安装依赖
npm install
npm install --prefix packages/ui

# 构建应用
npm run build

# 打包 macOS 应用
npm run dist

# 输出文件：
# - dist/Pi.Desktop-0.1.0-arm64.dmg        (Apple Silicon)
# - dist/Pi.Desktop-0.1.0-arm64-mac.zip    (Apple Silicon 便携版)
# - dist/Pi Desktop.app                    (本地运行)
```

**预期输出**：
- DMG 安装程序 (~140 MB)
- ZIP 便携版 (~130 MB)

#### Linux

```bash
cd /path/to/pi-desktop

# 安装依赖
npm install
npm install --prefix packages/ui

# 构建应用
npm run build

# 打包 Linux 应用
npm run dist

# 输出文件：
# - dist/Pi.Desktop-0.1.0.AppImage         (AppImage 格式)
# - dist/pi-desktop-0.1.0.tar.gz           (源代码归档)
```

**预期输出**：
- AppImage 可执行文件 (~143 MB)
- tar.gz 源代码包 (~132 MB)

---

## 📊 预期的构建产物

### Windows
```
dist/
├── Pi Desktop Setup 0.1.0.exe      (106 MB, 安装程序)
├── Pi Desktop-0.1.0-win.zip        (143 MB, 便携版)
└── win-unpacked/                   (418 MB, 未压缩的应用)
```

### macOS
```
dist/
├── Pi Desktop.app/                 (应用包)
├── Pi.Desktop-0.1.0-arm64.dmg      (~140 MB, DMG 安装程序)
├── Pi.Desktop-0.1.0-arm64-mac.zip  (~130 MB, 便携版)
└── mac-unpacked/                   (未压缩的应用)
```

### Linux
```
dist/
├── Pi.Desktop-0.1.0.AppImage       (~143 MB, 可执行应用)
├── pi-desktop-0.1.0.tar.gz         (~132 MB, 源代码包)
└── linux-unpacked/                 (未压缩的应用)
```

---

## 🔧 配置说明

### electron/main.ts
- Electron 应用主进程
- 处理系统集成、IPC 通信
- 网络层（代理支持、自动重试）

### packages/ui/
- Vue 3 + TypeScript 前端
- 会话管理、消息显示
- 工作流支持

### 构建配置 (package.json build 字段)

```json
{
  "build": {
    "appId": "dev.pi.desktop",
    "productName": "Pi Desktop",
    "win": {
      "target": ["zip", "nsis"],
      "icon": "build/icon.ico"
    },
    "mac": {
      "target": ["zip", "dmg"],
      "icon": "build/icon.png"
    },
    "linux": {
      "target": ["tar.gz", "AppImage"],
      "icon": "build/icon.png"
    }
  }
}
```

---

## 📝 构建命令详解

### 开发模式
```bash
npm run dev
# 启动 Vite 开发服务器和 Electron 应用
# 用于开发和调试
```

### 生产构建
```bash
npm run build
# 编译 TypeScript + 构建 Vue 应用
# 生成优化的生产代码
```

### 打包应用（当前平台）
```bash
npm run dist
# 使用 electron-builder 打包应用
# 生成可分发的安装程序和便携版
```

### 检查代码质量
```bash
npm run check
# 运行 TypeScript 类型检查
# 执行自检脚本（11 个）
# 验证代码质量
```

---

## 🌍 跨平台打包

### 使用 GitHub Actions（已禁用）
原项目使用 GitHub Actions 在多个平台上自动构建。当前已删除所有工作流。

### 本地跨平台打包方案

**选项 1：在各平台本地构建**
- Windows: 在 Windows 上运行 `npm run dist`
- macOS: 在 Mac 上运行 `npm run dist`
- Linux: 在 Linux 上运行 `npm run dist`

**选项 2：使用 Docker（推荐）**
```bash
# 构建 Linux 版本
docker run --rm -v $(pwd):/workspace node:24-alpine
cd /workspace && npm install && npm run dist

# 构建 macOS 版本需要 macOS 环境
```

**选项 3：使用 CI/CD 服务**
- GitHub Actions（需要创建新的工作流）
- GitLab CI
- Jenkins

---

## 📋 系统要求

### 运行时
- **Windows**: 7+ (x64)
- **macOS**: 10.13+ (Intel/Apple Silicon)
- **Linux**: glibc 2.29+ 的发行版

### 开发环境
- Node.js 18+
- npm 9+
- Python 3（仅 Linux/macOS）

---

## 🚀 发布流程

### 1. 本地打包
```bash
npm run dist
```

### 2. 验证文件
```bash
ls -lh dist/
# 检查所有预期的输出文件
```

### 3. 上传到 GitHub Release
```bash
# 使用 GitHub CLI
export HTTPS_PROXY=http://127.0.0.1:7890
gh release upload v0.1.0 dist/Pi*Desktop*.exe dist/Pi*Desktop*.zip
```

### 4. 更新下载链接
- 编辑 README.md 中的下载链接
- 更新用户指南

---

## 🔍 故障排查

### Windows
```bash
# 如果构建失败，检查：
npm run build:electron  # 编译检查
npm run check          # 自检脚本
```

### macOS/Linux
```bash
# 检查依赖
npm install
npm install --prefix packages/ui

# 重新构建
npm run build
```

### 常见问题

**Q: 打包失败，显示"icon not found"**
- A: 检查 `build/icon.png` 和 `build/icon.ico` 是否存在

**Q: 构建过慢**
- A: 第一次构建会下载 Electron，耗时 5-10 分钟。后续构建会快很多

**Q: 输出文件很大（>100MB）**
- A: 这是正常的。Electron + 完整的依赖树会比较大。可以考虑代码分割优化

---

## 📦 发布清单

- [x] Windows 安装程序 (.exe)
- [x] Windows 便携版 (.zip)
- [ ] macOS DMG (.dmg)
- [ ] macOS 便携版 (.zip)
- [ ] Linux AppImage
- [ ] Linux tar.gz

**已完成**: Windows 版本 (2/6)
**待完成**: macOS 和 Linux 版本（需要相应环境）

---

## 📝 版本信息

- **版本**: 0.1.0
- **发布日期**: 2026-10-20
- **构建工具**: Electron Builder 26.15.3
- **Electron 版本**: 35.7.5
- **Node 版本**: 24.19.0

---

## 🔗 相关文档

- [README.md](./README.md) - 项目说明和使用指南
- [LICENSE](./LICENSE) - MIT 许可证

---

**提示**: 所有平台都可以从源代码本地构建。如需完整的跨平台发布，建议使用 CI/CD 服务在各平台自动构建。

