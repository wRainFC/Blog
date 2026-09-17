# 添加新内容

本文说明如何为「砚边」添加课程、课程笔记和随笔。所有内容都会在构建时经过 Astro 内容 schema 校验。

## 0. 使用本地内容工作台

如果不想手写 frontmatter，可以在仓库根目录运行：

~~~bash
pnpm studio
~~~

Windows 也可以双击 `content-studio.cmd`。工作台只监听本机地址，打开后访问 `/studio`。

工作台采用 Markdown 优先的最小流程：选择“写课程笔记”或“写随笔”，填写标题并写正文即可。文章 ID 和发布日期会自动生成；摘要留空时会从正文开头生成；课程笔记的章节留空时使用“未分类”。标签、更新时间、精选状态等低频字段收在“发布设置”中。

顶部只有两个主要动作：

- “保存草稿”只写入本地内容文件，并自动运行 `pnpm check`。
- “发布到网站”将文章设为公开，依次运行 `pnpm check`、`pnpm build`，创建内容提交并推送到 `origin/main`。GitHub Actions 随后根据 main 分支构建并发布到 GitHub Pages。

一键发布只会提交当前文章、文章专属图片，以及课程笔记依赖的课程 YAML。发布前如果发现其他工作区改动、当前分支不是 main、构建失败或 Git 推送失败，会停止并在“发布与检查记录”中显示原因。运行电脑需要已经配置好 GitHub 推送凭据。

工作台 v1 对 `.mdx` 文件只读，因为含有 Astro/JSX 组件的正文仍应使用代码编辑器维护。文章 ID、课程 ID 和笔记所属课程在首次保存后不能在工作台内重命名；需要迁移 URL 时请手动处理并同步检查引用。

图片上传后会放到文章旁的 `assets/{article-id}/` 目录，并插入相对路径，例如：

~~~text
![图片说明](./assets/my-article/diagram.png)
~~~

工作台不会删除未使用的资源。一键发布会创建内容提交，但不会修改或提交与当前文章无关的文件。

## 1. 添加一门课程

课程信息放在：

~~~text
src/content/courses/{course-id}.yaml
~~~

course-id 是稳定的英文标识，也会成为课程 URL 的一部分。建议使用小写 kebab-case，例如 data-structures。

示例：

~~~yaml
title: 数据结构
semester: 大二 · 秋
description: 用不变量、递归和可运行代码建立对数据结构的理解。
order: 1
~~~

字段说明：

- title：课程显示名称，必填。
- semester：学期，必填。
- description：课程简介，可选。
- order：课程在首页和课程列表中的顺序，可选，默认是 0。

文件名会成为课程 ID。例如：

~~~text
src/content/courses/linear-algebra.yaml
~~~

对应的课程 ID 是 linear-algebra。

## 2. 添加课程笔记

课程笔记放在对应课程目录下：

~~~text
src/content/notes/{course-id}/{article-id}.md
src/content/notes/{course-id}/{article-id}.mdx
~~~

course-id 必须和课程 YAML 文件名一致，article-id 会成为文章 URL 的最后一段。

例如：

~~~text
src/content/notes/data-structures/binary-search-tree.mdx
~~~

对应 URL：

~~~text
/learn/data-structures/binary-search-tree/
~~~

笔记的 frontmatter：

~~~yaml
---
title: "二叉搜索树：从递归定义到可运行代码"
summary: "用不变量理解插入与查找，并用 TypeScript 写出一个结构清晰的二叉搜索树。"
pubDate: 2026-06-09
updated: 2026-06-12
course: data-structures
chapter: "第五章 · 树"
tags: ["树", "递归", "TypeScript"]
draft: false
---
~~~

笔记字段说明：

- title：文章标题，必填。
- summary：列表、SEO 和 RSS 使用的摘要，必填。
- pubDate：发布日期，格式为 YYYY-MM-DD，必填。
- updated：最后更新时间，可选。
- course：课程 ID，必须能在 src/content/courses/ 中找到。
- chapter：章节名称，必填。
- tags：标签数组，可选，默认为空数组。
- draft：是否草稿，可选，默认为 false。

笔记不需要填写课程名称或学期；这些信息会从课程集合自动读取。

## 3. 添加随笔

随笔放在：

~~~text
src/content/essays/{article-id}.md
src/content/essays/{article-id}.mdx
~~~

示例：

~~~text
src/content/essays/learning-slowly.md
~~~

对应 URL：

~~~text
/writing/learning-slowly/
~~~

随笔 frontmatter：

~~~yaml
---
title: "允许自己学得慢一点"
summary: "真正的理解常常发生在第二次、第三次回望时。"
pubDate: 2026-06-29
tags: ["学习", "成长", "节奏"]
draft: false
featured: true
---
~~~

随笔字段与笔记基本相同，但不需要 course 和 chapter。只有随笔可以使用 featured: true，首页会优先展示精选随笔。

## 4. 选择 .md 还是 .mdx

- 使用 .md：普通 Markdown、公式、代码块和引用已经足够时。
- 使用 .mdx：需要在文章中写 JSX/Astro 组件、交互内容或更复杂的 HTML 时。

数学公式可以直接使用 LaTeX：

~~~md
$$
\lim_{n\to\infty} a_n = A
$$
~~~

代码块可以指定语言和标题：

~~~~md
~~~ts title="example.ts"
const answer = 42;
~~~
~~~~

## 5. 草稿与发布

新文章可以先写成草稿：

~~~yaml
draft: true
~~~

草稿不会出现在：

- 首页
- 课程和随笔归档
- 标签页
- RSS
- Pagefind 搜索索引

准备发布时，将它改为：

~~~yaml
draft: false
~~~

## 6. 添加标签

标签直接写在 frontmatter 中：

~~~yaml
tags: ["极限", "连续", "证明"]
~~~

构建后会自动生成对应的主题页：

~~~text
/topics/极限/
~~~

标签名称会直接影响 URL 和页面标题。已经公开使用的标签建议保持原样，不要随意改名。

## 7. 本地检查

添加或修改内容后，至少运行：

~~~bash
pnpm check
pnpm build
~~~

pnpm check 会检查 frontmatter、课程引用和 Astro/TypeScript 类型；pnpm build 会生成静态页面、sitemap、RSS 和 Pagefind 搜索索引。

如果构建失败，优先检查：

1. course 是否与课程文件名完全一致。
2. title、summary、pubDate、chapter 是否缺失。
3. 日期是否使用 YYYY-MM-DD 格式。
4. 文件扩展名是否为 .md 或 .mdx。
5. 文件名和目录名是否包含空格或不稳定的显示名称。

## 8. 推荐写作流程

~~~text
在 Studio 中选择“写课程笔记”或“写随笔”
    ↓
填写标题与课程，完成 Markdown 正文
    ↓
需要时保存草稿
    ↓
点击“发布到网站”
    ↓
Studio 自动检查、构建、提交并推送
    ↓
GitHub Actions 构建并发布到 GitHub Pages
~~~

站点的 canonical、RSS 和 sitemap 地址由 PUBLIC_SITE_URL 控制，部署子目录由 PUBLIC_BASE_PATH 控制。GitHub Actions 已配置网站域名与 `/Blog` 子目录；首次发布步骤见 [GitHub Pages 发布](github-pages.md)。其他静态托管平台应设置真实域名，例如：

~~~text
PUBLIC_SITE_URL=https://example.com
~~~
