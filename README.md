# PasteBoard Plus

给每一次复制，一个好去处。一个类似 Windows + V 的桌面剪贴板，基于 Electron、React 和 TypeScript，主要面向 Windows，也可在 macOS / Linux 上开发运行。

## 已实现

- **自动历史**：每 800 ms 检查系统剪贴板，记录文字和图片，去重并保存到本机；退出、重启后恢复。
- **可选快捷键**：默认 `Ctrl + Shift + V`，macOS 为 `⌘ + Shift + V`。在设置中按下新组合即可更改；注册失败时提示冲突。`Windows + V` 由系统占用。
- **智能分类**：文本、图片、URL、文件路径、代码。可以创建、删除自定义分类，并将记录收纳进去。
- **历史管理**：搜索原文 / 译文，置顶，网格 / 列表视图，排序，单条删除，清理时默认保留置顶内容。
- **图片**：保存原始 PNG、缩略图、尺寸及大小；支持查看原图和重新复制图片，不设文件大小或像素数量上限。
- **AI 翻译**：可配置 OpenAI Chat Completions 兼容服务、模型和 API Key，支持中 / 英 / 日 / 韩 / 德 / 法语。译文与历史一起保存，可以再次复制。
- **后台运行**：关闭窗口后继续在托盘记录；快捷键再次打开，托盘菜单可暂停或退出。

选择记录后点击「复制内容」，回到原应用按 `Ctrl + V` 粘贴。窗口中可用方向键选择，`Enter` 复制并收起，`Escape` 收起，`Ctrl + F` 搜索，`Ctrl + ,` 打开设置。macOS 使用 `⌘` 替代 `Ctrl`。

## 运行

需要 **Node.js 24+** 和 npm。使用已有 checkout；每个云任务已隔离，无需创建 Git worktree。

```bash
cd /workspace/pasteBoard-plus
npm ci
npx --no install-electron
npm run dev
```

`dev` 启动 Vite 和 Electron，界面修改会热更新。修改 `electron/` 或 `shared/` 的桌面逻辑后重启开发进程。

```bash
npm run build        # 类型检查、前端和 Electron 主进程 / preload 构建
npm start            # 运行已构建桌面版
npm run dev:web      # 仅浏览器界面预览
npm run dist:win     # Windows x64 安装程序 + 便携 ZIP
npm run pack         # 当前平台的未压缩应用目录
```

Windows 安装程序输出到 `release/PasteBoard-Plus-Setup-0.1.1-x64.exe`，可选择安装位置并创建桌面快捷方式。便携包输出到 `release/PasteBoard-Plus-0.1.1-win-x64.zip`。解压整个 ZIP 后运行 `PasteBoard Plus.exe`，不要只移动其中一个 EXE。包未做代码签名；Windows 原生兼容性仍需在 Windows 机器上验证。

浏览器预览明确标注其模式：只能在点击「捕获剪贴板」时读取浏览器获准访问的文字，历史保存在此浏览器中。示例须手动载入；不会把示例加入桌面历史。系统全局快捷键、自动监听和 AI 请求由桌面版提供。

## 配置翻译

打开「偏好设置 → AI 翻译」：

1. 填入基础 API 地址，例如 `https://api.openai.com/v1`；程序自动追加 `/chat/completions`。
2. 填入服务实际支持的模型名，例如 `gpt-4o-mini` 或 `deepseek-chat`。
3. 输入自己的 API 密钥，保存。选择一条文字记录，点击「翻译这段内容」。

服务需支持 `POST /chat/completions`、Bearer 认证及 `choices[0].message.content` 响应。远程服务必须使用 HTTPS；本地模型可使用 `http://localhost:端口/v1` 或 `http://127.0.0.1:端口/v1`。支持环境已有的 HTTP(S) 代理和 CA 信任；不跟随 API 重定向。

只在点击翻译时发送**所选条目的文字**，不发送整个历史或图片。不含 OCR。真实外部服务需要用户在桌面设置中配置有效凭据；自动测试使用本机模拟 API，不产生付费请求。

## 数据与存储

数据位于 Electron 的 `userData` 目录：

| 系统 | 默认位置 |
| --- | --- |
| Windows | `%APPDATA%/pasteboard-plus/` |
| macOS | `~/Library/Application Support/pasteboard-plus/` |
| Linux | `~/.config/pasteboard-plus/` |

`history.json` 保存文字、分类、设置及译文，`images/` 保存原图。JSON 通过临时文件和原子重命名保存；无法读取的历史文件保留为 `history.json.recovery-*`，不会直接覆盖。桌面应用以实际 `app.getPath('userData')` 为准，打包后的目录名可能随系统 / 产品名变化。

API 密钥通过 Electron `safeStorage` 使用系统能力加密。系统安全存储不可用（包括 Linux `basic_text` 后端）时，只保存在进程内存，退出后重新输入；不会降级为明文文件。密钥不会暴露给界面快照或保存到源码。历史内容本身为本地明文文件。

默认保留 300 条非置顶记录，可设为 50–1,000 条；最多另外置顶 100 条。图片不设文件大小或像素数量上限，原图完整保存，只缩放界面中的缩略图。原始文字上限 100,000 字；翻译每条最多 20,000 字，超限文字会提示。程序跳过来源应用标记为敏感的剪贴板内容，但并非所有密码来源都会附加这类标记。

文件路径分类保存的是路径文字；不复制文件内容，不移动文件。链接只作为文字展示，不主动访问网页。

## 验证

```bash
npm test                       # 分类、持久化、容量、恢复和翻译错误处理
npm run test:e2e                # 浏览器端到端交互
npm run test:desktop            # 在可用桌面中测试真实 Electron 剪贴板
npm run test:desktop:headless   # Linux 无显示器环境；自动启动 Xvfb 或 Xorg dummy
```

浏览器测试默认使用 `/usr/bin/chromium`；其他环境通过 `PLAYWRIGHT_CHROMIUM_PATH` 指向已安装的 Chrome / Chromium。例如 Windows 可设置为本机 Chrome 可执行文件路径。

桌面测试使用独立的临时数据目录和本机 HTTP 模拟服务，验证系统文字 / 图片读写、自动分类、敏感标记、暂停 / 恢复、全局快捷键注册、翻译 UI 到 API、重启恢复和图片清理。不会读取已有应用历史，也不会调用真实 AI 服务。

云环境通过现有网络代理访问 npm、GitHub 官方 Electron 发布资源。Node.js 下载器需要使用代理时：

```bash
NODE_USE_ENV_PROXY=1 npm ci --no-audit --no-fund
NODE_USE_ENV_PROXY=1 npx --no install-electron
npm run build
npm test
npm run test:e2e
npm run test:desktop:headless
```

当前云环境自带 Chromium、GTK 和 Xorg dummy，无需 Docker 或外部数据库。`scripts/with-display.mjs` 只启动自己的虚拟显示器，并在子进程退出后清理。对于不支持 Chromium 沙箱的隔离云容器，`npm run start:cloud` 使用测试用 `--no-sandbox` 启动；正常桌面用户请使用 `npm start`。

## 目录

```text
electron/        系统剪贴板、托盘、快捷键、IPC、历史文件与 API 请求
shared/          类型、默认设置、内容分类
src/             React 界面与独立浏览器预览适配器
scripts/         开发、构建、虚拟显示器与原生桌面烟测
tests/           单元测试和浏览器端到端测试
```

已在 Linux 云环境验证；Windows 便携包的原生运行、Windows 快捷键冲突和 macOS 权限行为需要对应系统验证。Linux Wayland 的全局快捷键 / 后台剪贴板访问受桌面会话限制，当前桌面验证使用 X11。
