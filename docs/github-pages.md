# GitHub Pages 发布

博客源码位于 `wRainFC/Blog`，默认网站地址为 `https://wrainfc.github.io/Blog/`。

## 首次发布

1. 将代码和内容提交并推送到 `main`。
2. 在仓库 **Settings → Pages → Build and deployment** 中，将 **Source** 设置为 **GitHub Actions**。
3. 在 **Actions → Deploy to GitHub Pages** 中查看 `build` 与 `deploy` 任务。
4. 两个任务成功后，打开 `https://wrainfc.github.io/Blog/`。如果之前设置过自定义域名，请在 **Settings → Pages → Custom domain** 中清空并保存。

工作流位于 `.github/workflows/deploy.yml`。每次推送到 `main` 都会重新发布；也可以在 Actions 页面使用 **Run workflow**，选择 `main` 手动发布。其他分支手动运行时只构建，不部署。

工作流使用 Node.js 24 与 `package.json` 中锁定的 pnpm 版本，安装锁文件中的依赖，执行 `pnpm build`，然后上传并发布 `dist/`。`pnpm build` 包含 Pagefind 搜索索引生成；内容工作台仅供本地使用，不进入公开站点。

本地未提交或未推送的改动不会出现在网页中。`draft: true` 的文章不会公开。

## 网站地址与子目录

工作流设置了以下构建环境变量：

```text
PUBLIC_SITE_URL=https://wrainfc.github.io
PUBLIC_BASE_PATH=/Blog
```

`PUBLIC_SITE_URL` 控制网站域名，`PUBLIC_BASE_PATH` 控制网站所在子目录。Astro 的 `site` 和 `base` 分别读取这两个值；导航、文章链接、正文图片、RSS、搜索与分享图片会使用相同的前缀。

写正文时可以继续使用 `/images/...` 或 `/learn/...` 等站内根路径，Markdown 与 HTML 中的静态 URL 会在构建时自动补上 `/Blog`。MDX 中动态表达式生成的站内 URL 需要使用 `src/lib/site-path.ts` 的 `withBasePath()`。外部地址、页内锚点和相对地址会保持原样。

本地 `pnpm dev` 与 `pnpm studio` 默认使用根路径 `/`，写作工作台地址仍为 `/studio`。

## 在本地预览 Pages 构建

PowerShell 中运行：

```powershell
$env:PUBLIC_SITE_URL = 'https://wrainfc.github.io'
$env:PUBLIC_BASE_PATH = '/Blog'
pnpm build
pnpm preview
```

打开终端显示的本地首页地址。结束后关闭该终端，或移除这两个临时环境变量，再启动本地写作工作台：

```powershell
Remove-Item Env:PUBLIC_SITE_URL, Env:PUBLIC_BASE_PATH -ErrorAction SilentlyContinue
```

如果以后重新绑定自定义域名，需要在 GitHub Pages 设置中添加域名，并同步将工作流中的 `PUBLIC_SITE_URL` 改为该域名、将 `PUBLIC_BASE_PATH` 改为 `/`。DNS 配置和 HTTPS 证书签发遵循 [GitHub 自定义域名管理](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 的说明。

官方参考：[Astro GitHub Pages 部署](https://docs.astro.build/zh-cn/guides/deploy/github/)、[GitHub Pages 创建站点](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)。