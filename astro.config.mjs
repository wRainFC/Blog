import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import expressiveCode from "astro-expressive-code";
import { unified } from "@astrojs/markdown-remark";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeCallouts from "rehype-callouts";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || "http://localhost:4321",
  output: "static",
  integrations: [
    expressiveCode({
      themes: ["github-dark-default"],
      frames: { showCopyToClipboardButton: true },
    }),
    mdx(),
    sitemap(),
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
