import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rehypeRaw from "rehype-raw";
import { describe, expect, it } from "vitest";
import { rehypeBasePath } from "./rehype-base-path";

describe("content paths in a repository deployment", () => {
  it("rewrites Markdown and HTML URLs while preserving code and remote URLs", async () => {
    const processor = await createMarkdownProcessor({
      syntaxHighlight: false,
      rehypePlugins: [rehypeRaw, [rehypeBasePath, { base: "/Blog/" }]],
    });
    const { code } = await processor.render([
      "[学习](/learn) ![图](/images/example.png)",
      '<figure><img src="/images/notes/IBM370.png" alt="指令" /></figure>',
      '<a href="/Blog/writing?tag=树#recent">随笔</a>',
      '<!-- <img src="/images/comment.png" /> -->',
      "[外部](https://example.com) ![外部图](//cdn.example.com/image.png)",
      '`src="/images/code.png"`',
      "```html\n<img src=\"/images/fenced-code.png\" />\n```",
    ].join("\n\n"));

    expect(code).toContain('href="/Blog/learn"');
    expect(code).toContain('src="/Blog/images/example.png"');
    expect(code).toContain('src="/Blog/images/notes/IBM370.png"');
    expect(code).toContain('href="/Blog/writing?tag=树#recent"');
    expect(code).toContain('<!-- <img src="/images/comment.png" /> -->');
    expect(code).toContain('href="https://example.com"');
    expect(code).toContain('src="//cdn.example.com/image.png"');
    expect(code).toContain('/images/code.png');
    expect(code).toContain('/images/fenced-code.png');
    expect(code).not.toContain('/Blog/images/code.png');
    expect(code).not.toContain('/Blog/images/fenced-code.png');
  });
});
