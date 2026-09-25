import { describe, expect, it } from "vitest";
import { analyzeOutline } from "./outline";

describe("article outline", () => {
  it("returns H2/H3 navigation data and ignores fenced code", () => {
    const result = analyzeOutline("## 第一节\n### 小节\n```md\n## 代码\n```\n");
    expect(result.headings.map((heading) => heading.title)).toEqual(["第一节", "小节"]);
  });

  it("diagnoses H1, empty headings, jumps and duplicate slugs", () => {
    const result = analyzeOutline("# 标题\n### 跳级\n## 重复\n## 重复\n##\n");
    expect(result.diagnostics.join("\n")).toMatch(/H1/);
    expect(result.diagnostics.join("\n")).toMatch(/跳到 H3/);
    expect(result.diagnostics.join("\n")).toMatch(/重复标题 slug/);
    expect(result.diagnostics.join("\n")).toMatch(/标题为空/);
  });
});
