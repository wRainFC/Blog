# AGENTS.md

本文件适用于整个仓库。除非更深层目录存在自己的 `AGENTS.md`，否则所有修改都应遵循这里的约定。

## 项目概览

- 本项目是使用 Astro 构建的中文个人学习博客，采用静态输出。
- 包管理器使用 pnpm；Node.js 版本要求为 20 或更高。
- 页面内容包括课程笔记、随笔、主题归档、数学公式、代码块和静态搜索。
- 保持现有技术栈与视觉语言，不要在没有明确需求时引入新的 UI 框架、状态库或构建系统。

## 主要目录

- `src/pages/`：页面与路由入口。
- `src/layouts/`：公共页面和文章布局。
- `src/components/`：页面组件；按 `home`、`article`、`shell` 等区域组织。
- `src/scripts/`：浏览器端交互、主题、动画和天气 Canvas 逻辑。
- `src/styles/`：设计变量、全局样式、正文样式和页面专用样式。
- `src/content/`：课程、笔记和随笔内容。
- `src/lib/content/`：内容查询、排序和 URL 生成逻辑。
- `tools/content-studio/`：本地内容工作台。
- `docs/`：内容编辑与站点结构文档。

新增或调整内容前先阅读 `docs/adding-content.md`；定位页面职责时参考 `docs/site-structure.md`。

## 开发命令

使用仓库锁定的依赖，不要随意更换包管理器或生成其他锁文件。

```bash
pnpm dev
pnpm check
pnpm test:unit
pnpm test:studio
pnpm build
```

- 小范围样式或组件修改至少运行 `pnpm check`。
- 修改 TypeScript 业务逻辑时运行对应单元测试和 `pnpm check`。
- 修改构建配置、内容管线、路由或发布相关逻辑时运行 `pnpm build`。
- 提交前运行 `git diff --check`。

## 代码约定

- 遵循现有 Astro、TypeScript 和 CSS 写法，保持 TypeScript 严格模式可通过。
- 优先复用现有组件、设计变量和工具函数，避免复制相同逻辑。
- 保持模块职责单一；不要把全局状态重新分散到页面组件中。
- 使用语义化 HTML，并保留键盘操作、焦点样式、ARIA 标签和减少动态效果支持。
- 响应式修改至少考虑桌面端、窄屏移动端和 `prefers-reduced-motion`。
- 保持中文内容为 UTF-8，不要无意义地重排 Markdown、YAML 或生成资源。
- 不要直接修改 `dist/`、`.astro/` 或 `node_modules/` 中的生成文件。

## 样式与交互

- 全局颜色、间距和排版变量位于 `src/styles/tokens.css`；优先使用变量而不是新增散落的硬编码值。
- 公共外壳样式位于 `src/styles/global.css`，主页专用样式位于 `src/styles/home.css`，正文样式位于 `src/styles/prose.css`。
- 动画应有明确的静止终态，避免依赖固定延时恢复关键状态。
- 新动画必须提供无动画或低动态降级路径，且不能阻塞实际状态更新。

## 主题系统

- 初始主题由 `src/layouts/BaseLayout.astro` 的内联脚本在首帧前写入。
- 运行时主题状态统一由 `src/scripts/theme.ts` 管理；所有 `[data-theme-control]` 都必须通过该模块切换。
- 主题持久化键为 `wrain-theme`，状态存放在 `<html data-theme="light|dark">`。
- 全局主题揭幕样式位于 `src/styles/theme-transition.css`。
- `src/scripts/ink-hero.ts` 只是主题变化的消费者，负责同步 Canvas 天气；不要让它重新承担全局主题写入或按钮绑定。
- 修改主题动画时同步检查普通页面、主页首屏、页眉按钮、移动端菜单、Canvas 和减少动态效果模式。

## 内容约定

- 课程元数据位于 `src/content/courses/`。
- 课程笔记位于 `src/content/notes/`，随笔位于 `src/content/essays/`。
- 内容必须符合 `src/content.config.ts` 中的 schema。
- 草稿、发布日期、课程 ID、标签和 URL 逻辑应继续通过现有查询与 URL 工具处理，不要在页面中重复实现。
- 添加内容时同时确认相关课程、主题归档、RSS 和搜索构建不会报错。

## Git 工作规范

- 开始修改前检查当前分支和 `git status --short`。
- 默认在当前分支工作；只有用户明确要求时才切换、创建或删除分支。
- 工作区可能包含用户尚未提交的改动，必须保留无关改动并避免覆盖。
- 不要执行 `git reset --hard`、`git clean`、强制推送或其他破坏性操作，除非用户明确授权。
- 不要自行提交、推送或发布；仅在用户明确要求时执行。
- 最终说明应概括改动、验证结果以及任何未能运行的检查。
