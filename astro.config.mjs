import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import expressiveCode from "astro-expressive-code";
import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeCallouts from "rehype-callouts";

const studioIntegrations = process.env.CONTENT_STUDIO === "1"
  ? [(await import("./tools/content-studio/integration.ts")).contentStudio()]
  : [];

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "http://localhost:4321",
  output: "static",
  integrations: [
    expressiveCode({
      themes: ["github-light-default", "github-dark-default"],
      useDarkModeMediaQuery: false,
      themeCssSelector: (theme) => theme.name === "github-dark-default"
        ? "[data-theme=\"dark\"]"
        : "[data-theme=\"light\"]",
      frames: { showCopyToClipboardButton: true },
    }),
    mdx(),
    sitemap(),
    ...studioIntegrations,
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [
        [rehypeKatex, { throwOnError: true, output: "htmlAndMathml" }],
        rehypeCallouts,
      ],
    }),
  },
});
