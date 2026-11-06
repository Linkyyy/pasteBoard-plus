# PasteBoard Plus 官网

中文静态官网：功能介绍、可点击的粘贴/翻译演示、Windows 安装版和便携版下载、隐私说明与常见问题。演示只操作网页内的便签，不读取访客剪贴板，也不发送 AI 请求。

## 本地运行

需要 Node.js 20+，没有第三方运行依赖。下列命令从仓库根目录执行：

```bash
node website/build.mjs
node website/serve.mjs
```

开发服务使用 4174 端口，`PORT` 可覆盖。修改文件后重新执行构建并刷新页面。`website/dist` 是生成目录，不提交到 Git。

`release.json` 保存已发布软件的版本、下载体积和 SHA-256。发布新桌面版本后同步更新；构建会检查它与根目录软件版本一致。下载链接指向 GitHub 版本标签下的安装包，不把 Electron 和历史记录放进官网部署。

## Vercel 发布

仓库根目录的 `vercel.json` 已配置独立构建：

- Framework Preset：Other。
- Root Directory：仓库根目录。
- Install Command：`npm --prefix website ci --ignore-scripts --no-audit --no-fund`。
- Build Command：`node website/build.mjs`。
- Output Directory：`website/dist`。

在 Vercel 中导入 `Linkyyy/pasteBoard-plus` 即可使用这些配置。官网没有运行时环境变量或后端服务，不需要把 AI Key 配到 Vercel。

在已登录的命令行中也可以发布：

```bash
npx --yes vercel@65.12.1 deploy --project pasteboard-plus --create-if-missing --prod --yes
```

如果由云环境代为发布，在环境设置中安全配置 `VERCEL_TOKEN`，并允许 `api.vercel.com` 以及上线站点对应的 `*.vercel.app` 访问。不要把 Token 写进源码、README 或聊天。CLI 读取 Token 时使用其 `--token` 参数；需要指定团队时使用 `--scope`。部署前先验证账号/团队，完成后检查返回的实际线上地址；本地构建通过并不表示已经发布。

安全响应头在 `vercel.json` 配置。站点使用本地字体、图标和脚本，没有分析追踪脚本或外部字体请求。
