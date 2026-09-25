# GitHub Pages 发布

博客源码位于 `wRainFC/Blog`，网站使用自定义域名 `https://wrain.art/`。

## 首次发布

1. 在仓库 **Settings → Pages → Build and deployment** 中，将 **Source** 设置为 **GitHub Actions**。
2. 在同一页面的 **Custom domain** 中填写 `wrain.art` 并保存，按本文的 DNS 表配置域名解析。
3. 将部署配置、页面代码和要公开的内容提交并推送到 `main`。在其他分支上修改时，先合并到 `main`。
4. 在 **Actions → Deploy to GitHub Pages** 中查看 `build` 与 `deploy` 的结果。
5. 两个任务成功且 DNS 检查通过后，打开网站；证书就绪后勾选 **Enforce HTTPS**。

工作流位于 `.github/workflows/deploy.yml`。每次推送到 `main` 都会重新发布；也可以在 Actions 页面使用 **Run workflow**，选择 `main` 手动发布。其他分支手动运行时只构建，不部署。

工作流使用 Node.js 24 与 `package.json` 中锁定的 pnpm 版本，安装锁文件中的依赖，执行 `pnpm build`，然后上传并发布 `dist/`。`pnpm build` 包含 Pagefind 搜索索引生成；内容工作台仅供本地使用，不进入公开站点。

本地未提交或未推送的改动不会出现在网页中。`draft: true` 的文章不会公开。

## 网站地址与子目录

工作流已设置以下构建环境变量：

```text
PUBLIC_SITE_URL=https://wrain.art
PUBLIC_BASE_PATH=/
```

`PUBLIC_SITE_URL` 控制网站域名，`PUBLIC_BASE_PATH` 控制网站所在子目录。Astro 的 `site` 和 `base` 分别读取这两个值；导航、文章链接、正文图片、RSS、搜索与分享图片会使用相同的前缀。

写正文时可以继续使用 `/images/...` 或 `/learn/...` 等站内根路径，Markdown 与 HTML 中的静态 URL 会在构建时自动补上子目录。MDX 中动态表达式生成的站内 URL 需要使用 `src/lib/site-path.ts` 的 `withBasePath()`。外部地址、页内锚点和相对地址会保持原样。

自定义域名从根路径 `/` 提供站点。若以后改回默认仓库地址 `https://wrainfc.github.io/Blog/`，把工作流中的 `PUBLIC_SITE_URL` 改为 `https://wrainfc.github.io`，`PUBLIC_BASE_PATH` 改为 `/Blog`。

本地 `pnpm dev` 与 `pnpm studio` 默认使用根路径 `/`，写作工作台地址仍为 `/studio`。

## 在本地预览 Pages 构建

PowerShell 中运行：

```powershell
$env:PUBLIC_SITE_URL = 'https://wrain.art'
$env:PUBLIC_BASE_PATH = '/'
pnpm build
pnpm preview
```

打开终端显示的本地首页地址。结束后关闭该终端，或移除这两个临时环境变量，再启动本地写作工作台：

```powershell
Remove-Item Env:PUBLIC_SITE_URL, Env:PUBLIC_BASE_PATH -ErrorAction SilentlyContinue
```

## 自定义域名

仓库 **Settings → Pages → Custom domain** 应填写 `wrain.art`。先保存 GitHub 中的域名绑定，再在域名服务商的 DNS 管理中添加以下记录：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `wrainfc.github.io` |

`www` 记录用于同时支持 `www.wrain.art`；GitHub 会将它重定向到已绑定的 `wrain.art`。DNS 服务商若有 TTL 选项，使用默认值即可。DNS 生效和 HTTPS 证书签发可能需要最多 24 小时，完成后在 Pages 设置中启用 **Enforce HTTPS**。

当前通过 GitHub Actions 发布，域名绑定由 GitHub Pages 设置管理，无需创建 `public/CNAME` 文件。建议在个人 GitHub **Settings → Pages** 中添加并验证 `wrain.art`，按提示配置 TXT 记录；验证完成后保留该记录。

官方参考：[Astro GitHub Pages 部署](https://docs.astro.build/zh-cn/guides/deploy/github/)、[GitHub 自定义域名管理](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)。
