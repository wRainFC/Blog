import { describe, expect, it } from "vitest";
import {
  isValidArticleId,
  isValidCourseId,
  parseDraft,
  slugifyArticleId,
  StudioError,
} from "./model";
import { sitePathFor } from "./content-store";

describe("content studio model", () => {
  it("creates stable suggestions for English and Chinese titles", () => {
    expect(slugifyArticleId("A note: On Limits & Continuity")).toBe("a-note-on-limits-continuity");
    expect(slugifyArticleId("从极限到连续：把无限接近写清楚")).toBe("从极限到连续-把无限接近写清楚");
    expect(isValidArticleId("从极限到连续-把无限接近写清楚")).toBe(true);
    expect(isValidArticleId("../escape")).toBe(false);
    expect(isValidCourseId("data-structures")).toBe(true);
    expect(isValidCourseId("数据结构")).toBe(false);
  });

  it("parses and validates the union draft shape", () => {
    const draft = parseDraft({
      kind: "essay",
      id: "learning-slowly",
      title: "允许自己学得慢一点",
      summary: "摘要",
      pubDate: "2026-06-29",
      tags: ["学习", "成长", "学习"],
      draft: true,
      featured: false,
      body: "正文",
    });
    expect(draft).toMatchObject({ kind: "essay", id: "learning-slowly", tags: ["学习", "成长"] });
  });

  it("rejects invalid dates and paths", () => {
    expect(() => parseDraft({
      kind: "essay",
      id: "ok",
      title: "标题",
      summary: "摘要",
      pubDate: "2026-02-31",
      tags: [],
      draft: true,
      featured: false,
      body: "",
    })).toThrow(StudioError);
  });

  it("builds the same URLs as the site", () => {
    expect(sitePathFor({ kind: "note", id: "极限与连续", course: "mathematical-analysis" }))
      .toBe("/learn/mathematical-analysis/极限与连续/");
    expect(sitePathFor({ kind: "essay", id: "learning-slowly" })).toBe("/writing/learning-slowly/");
  });
});
