import { fileURLToPath } from "node:url";
import type { AstroConfig, AstroIntegration } from "astro";
import type { AstroMarkdownOptions } from "@astrojs/markdown-remark";
import { createStudioMiddleware } from "./api";

export function contentStudio(): AstroIntegration {
  let resolvedConfig: AstroConfig | undefined;

  return {
    name: "yanbian-content-studio",
    hooks: {
      "astro:config:setup": ({ command, injectRoute }) => {
        if (command !== "dev") return;
        injectRoute({
          pattern: "/studio",
          entrypoint: new URL("./page.astro", import.meta.url),
          prerender: false,
        });
      },
      "astro:config:done": ({ config }) => {
        resolvedConfig = config;
      },
      "astro:server:setup": ({ server, logger, refreshContent }) => {
        if (!resolvedConfig) throw new Error("Content Studio 未获得 Astro 配置。");
        const token = process.env.CONTENT_STUDIO_TOKEN;
        if (!token) throw new Error("Content Studio 缺少本地访问令牌。");
        const workspaceRoot = fileURLToPath(resolvedConfig.root);
        server.middlewares.use(createStudioMiddleware({
          workspaceRoot,
          token,
          markdown: resolvedConfig.markdown as AstroMarkdownOptions,
          refreshContent: refreshContent ? () => refreshContent({ loaders: ["courses", "notes", "essays"] }) : undefined,
        }));
        logger.info("本地内容工作台已启用：/studio");
      },
    },
  };
}
