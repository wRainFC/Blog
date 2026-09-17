# 砚边

一个使用 Astro 构建的个人学习博客，包含课程笔记、随笔、数学公式、代码块、静态搜索与水墨动画。

## 内容结构

- `src/content/courses/`：课程的名称、学期和描述
- `src/content/notes/`：按课程组织的课程笔记
- `src/content/essays/`：随笔与思考
- `src/pages/learn/`、`src/pages/writing/`、`src/pages/topics/`：知识花园路由

文章的课程、标签和发布日期由内容 schema 校验，草稿不会进入公开页面、RSS 或搜索索引。

新增课程、笔记或随笔时，请先阅读 [添加新内容](docs/adding-content.md)。

## 常用命令

- `pnpm dev`：本地预览
- `pnpm check`：检查 Astro、TypeScript 和内容结构
- `pnpm build`：生成静态站点与 Pagefind 搜索索引
- `pnpm preview`：预览生产构建
- `pnpm studio`：启动 Markdown 优先的本地写作工作台；可保存草稿或检查、构建并发布到 `origin/main`（Windows 也可以双击 `content-studio.cmd`）

## GitHub Pages 发布

仓库已配置 GitHub Actions：推送到 `main` 后自动构建并发布到 GitHub Pages。默认地址为 <https://wrainfc.github.io/Blog/>。

首次发布需要在 GitHub 仓库的 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后将代码和内容提交、推送到 `main`。部署进度与网站链接位于仓库的 Actions 页面。

详细步骤、路径配置和本地发布预览见 [GitHub Pages 发布](docs/github-pages.md)。

## 其他静态托管

源码托管在 GitHub，外部静态托管平台负责构建和发布。构建环境需要 Node.js 20+，并执行：

```bash
pnpm install --frozen-lockfile
pnpm build
```

如果需要正确生成 canonical、RSS 和 sitemap，请在构建环境设置：

```text
PUBLIC_SITE_URL=https://example.com
```

部署到子目录时，还需设置 `PUBLIC_BASE_PATH`（例如 `/Blog`）。本地开发默认使用根路径 `/`。
