# GitHub Pages 发布

博客源码位于 `wRainFC/Blog`，默认 Pages 地址为 `https://wrainfc.github.io/Blog/`。

## 首次发布

1. 在仓库 **Settings → Pages → Build and deployment** 中，将 **Source** 设置为 **GitHub Actions**。
2. 将部署配置、页面代码和要公开的内容提交并推送到 `main`。在其他分支上修改时，先合并到 `main`。
3. 在 **Actions → Deploy to GitHub Pages** 中查看 `build` 与 `deploy` 的结果。
4. 两个任务成功后，打开部署任务显示的网站链接。

工作流位于 `.github/workflows/deploy.yml`。每次推送到 `main` 都会重新发布；也可以在 Actions 页面使用 **Run workflow**，选择 `main` 手动发布。其他分支手动运行时只构建，不部署。

工作流使用 Node.js 24 与 `package.json` 中锁定的 pnpm 版本，安装锁文件中的依赖，执行 `pnpm build`，然后上传并发布 `dist/`。`pnpm build` 包含 Pagefind 搜索索引生成；内容工作台仅供本地使用，不进入公开站点。

本地未提交或未推送的改动不会出现在网页中。`draft: true` 的文章不会公开。

## 网站地址与子目录

工作流已设置以下构建环境变量：

```text
PUBLIC_SITE_URL=https://wrainfc.github.io
PUBLIC_BASE_PATH=/Blog
```

`PUBLIC_SITE_URL` 控制网站域名，`PUBLIC_BASE_PATH` 控制网站所在子目录。Astro 的 `site` 和 `base` 分别读取这两个值；导航、文章链接、正文图片、RSS、搜索与分享图片会使用相同的前缀。

写正文时可以继续使用 `/images/...` 或 `/learn/...` 等站内根路径，Markdown 与 HTML 中的静态 URL 会在构建时自动补上子目录。MDX 中动态表达式生成的站内 URL 需要使用 `src/lib/site-path.ts` 的 `withBasePath()`。外部地址、页内锚点和相对地址会保持原样。

本地 `pnpm dev` 与 `pnpm studio` 默认使用根路径 `/`。不要把生产用的 `PUBLIC_BASE_PATH=/Blog` 长期写入本地 `.env`，写作工作台的地址仍为 `/studio`。

## 在本地预览 Pages 构建

PowerShell 中运行：

```powershell
$env:PUBLIC_SITE_URL = 'https://wrainfc.github.io'
$env:PUBLIC_BASE_PATH = '/Blog'
pnpm build
pnpm preview
```

打开终端显示的本地地址下的 `/Blog/`。结束后关闭该终端，或移除这两个临时环境变量，再启动本地写作工作台：

```powershell
Remove-Item Env:PUBLIC_SITE_URL, Env:PUBLIC_BASE_PATH -ErrorAction SilentlyContinue
```

## 自定义域名

如改用自定义域名，在 GitHub Pages 设置中配置域名和 DNS，同时把工作流的 `PUBLIC_SITE_URL` 改为完整域名，`PUBLIC_BASE_PATH` 改为 `/`。若使用 `public/CNAME`，文件只需包含域名。

官方参考：[Astro GitHub Pages 部署](https://docs.astro.build/zh-cn/guides/deploy/github/)、[GitHub Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。
