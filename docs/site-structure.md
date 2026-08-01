# 页面结构与代码对应关系

这份文档用于快速定位页面区域对应的 Astro 组件、样式和脚本。页面采用 Astro 静态生成，内容来自 `src/content/`，公共外壳由 `BaseLayout` 统一提供。

## 1. 页面公共外壳

| 页面部分 | 主要文件 | 作用 |
| --- | --- | --- |
| HTML、SEO、主题初始化 | `src/layouts/BaseLayout.astro` | 设置 `<html data-theme>`、标题、描述、canonical、主题色，并挂载页眉、正文和页脚。 |
| 顶部导航 | `src/components/shell/Header.astro` | 品牌、主导航、搜索入口、桌面 / 移动端主题切换按钮。 |
| 页脚 | `src/components/shell/Footer.astro` | 深墨色单行落款与右侧英文导航。 |
| 品牌字标 | `src/components/shell/Wordmark.astro` | 复用 `wRain From Chu` 字标，支持首页、页脚等尺寸和反色状态。 |
| 全局基础样式 | `src/styles/global.css` | 页面背景、导航、卡片、归档布局、页脚、响应式规则和焦点状态。 |
| 设计变量 | `src/styles/tokens.css` | 纸张、墨色、文字、边框、朱砂 / 月光蓝等主题变量。 |

## 2. 主页

入口文件是 `src/pages/index.astro`，页面从上到下分为四部分：

### 首屏山水与天气动画

- 结构和 SVG 山体：`src/components/home/InkHero.astro`
- 滚动、主题切换、雨滴、涟漪和流星 Canvas：`src/scripts/ink-hero.ts`
- 首屏布局、昼夜色彩、滚动揭幕和下方内容桥接：`src/styles/home.css`

首屏使用同一组山体几何，浅色主题显示山雨，深色主题显示星空和流星。雨滴和流星使用 Canvas，山体、天空、雾和月光使用内联 SVG。

### 精选文章区

`src/pages/index.astro` 中的 `.home-editorial`：

- 精选随笔由 `getPublishedEssays()` 获取。
- 最新文章由 `getPublishedNotes()`、`getPublishedEssays()` 合并后排序。
- 每篇最新文章使用 `src/components/article/ArticleCard.astro`。

### 学习课程区

`src/pages/index.astro` 中的 `.home-courses`：

- 课程数据由 `getCourseSummaries()` 获取。
- 课程链接通过 `src/lib/content/urls.ts` 生成。
- 行式课程列表的视觉样式位于 `src/styles/home.css`。

### 首页收束语

`src/pages/index.astro` 中的 `.home-coda`，只负责显示页尾寄语；具体页脚由公共的 `Footer.astro` 提供。

## 3. 文章阅读页

文章页统一使用 `src/layouts/ArticleLayout.astro`，由两个动态路由进入：

- `src/pages/learn/[course]/[...slug].astro`：课程笔记。
- `src/pages/writing/[...slug].astro`：随笔文章。

文章布局包含：

- 文章标题、摘要、面包屑和元信息：`ArticleLayout.astro`。
- 课程章信息和标签：`ArticleLayout.astro`。
- 正文 Markdown / MDX：由内容集合渲染后插入 `.prose`。
- 目录：`src/components/article/ArticleToc.astro`。
- 正文、代码块、引用、公式、Callout：`src/styles/prose.css`。

文章元信息的格式化逻辑位于 `src/components/article/ArticleMeta.astro` 和 `src/lib/content/format.ts`。

内容页的页眉使用普通 `site-header`，目前通过 `src/styles/global.css` 的 `position: sticky` 跟随滚动；主页页眉则由 `home.css` 单独使用 overlay fixed 模式。

## 4. 课程、随笔和主题列表

| 页面 | 入口文件 | 主要内容 |
| --- | --- | --- |
| 课程总览 | `src/pages/learn/index.astro` | 课程列表、课程数量和筛选信息。 |
| 单门课程 | `src/pages/learn/[course].astro` | 课程介绍和该课程下的笔记归档。 |
| 随笔列表 | `src/pages/writing/index.astro` | 随笔归档和文章摘要。 |
| 主题页 | `src/pages/topics/[tag].astro` | 某个标签下的文章列表。 |
| 关于页 | `src/pages/about.astro` | 网站介绍、写作方向和联系入口。 |
| 搜索页 | `src/pages/search.astro` | Pagefind 搜索输入、摘要和结果列表。 |
| 404 | `src/pages/404.astro` | 未找到页面时的提示和返回入口。 |

归档页中的文章行主要复用 `src/components/article/ArticleCard.astro`，公共布局和响应式规则集中在 `src/styles/global.css`。

## 5. 主题系统

- 初始主题读取：`src/layouts/BaseLayout.astro` 的内联脚本。
- 主题按钮和主题记忆：`src/scripts/theme.ts`。
- 状态位置：`<html data-theme="light|dark">`。
- 本地存储键：`wrain-theme`。
- 主题变量：`src/styles/tokens.css`。
- 内容页深色样式：`src/styles/global.css`、`src/styles/prose.css`。
- 主页夜景和天气切换：`src/components/home/InkHero.astro`、`src/scripts/ink-hero.ts`。

主页首屏使用自己的夜景变量；主页首屏下方、文章页和其他内容页共享全站主题状态，但各自保留适合区域的背景和层次。

## 6. 内容数据流

```text
src/content/courses/*.yaml
src/content/notes/**/*.{md,mdx}
src/content/essays/*.{md,mdx}
              ↓
      src/content.config.ts
              ↓
      src/lib/content/queries.ts
              ↓
      页面 / ArticleLayout / ArticleCard
```

- 内容 schema：`src/content.config.ts`。
- 查询、排序、草稿过滤：`src/lib/content/queries.ts`。
- URL 生成：`src/lib/content/urls.ts`。
- 课程和文章数据的添加方式：`docs/adding-content.md`。

## 7. 常用检查

```bash
pnpm check
pnpm build
```

本地环境也可以使用项目内的 Astro 可执行文件运行同等检查。生产构建后，Pagefind 会从 `dist/` 重新生成搜索索引。
