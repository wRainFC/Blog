import { describe, expect, it } from "vitest";
import { isValidArticleId, isValidChapterId, isValidCourseId, parseDeleteEntryRequest, parseDraft, parseStructurePreviewRequest, parseStructureRequest, slugifyArticleId, StudioError } from "./model";
import { sitePathFor } from "./content-store";

describe("content studio model", () => {
  it("validates stable ids", () => {
    expect(slugifyArticleId("A note: On Limits & Continuity")).toBe("a-note-on-limits-continuity");
    expect(isValidArticleId("从极限到连续")).toBe(true);
    expect(isValidCourseId("data-structures")).toBe(true);
    expect(isValidChapterId("chapter-01")).toBe(true);
    expect(isValidChapterId("第一章")).toBe(false);
  });

  it("parses article body and de-duplicates tags", () => {
    const draft = parseDraft({ kind: "essay", id: "learning-slowly", title: "允许自己学得慢一点", summary: "摘要", pubDate: "2026-06-29", tags: ["学习", "成长", "学习"], draft: true, featured: false, body: "正文" });
    expect(draft).toMatchObject({ kind: "essay", tags: ["学习", "成长"], body: "正文" });
  });

  it("rejects duplicate chapter ids and bad note order", () => {
    expect(() => parseDraft({ kind: "course", id: "math", title: "数学", semester: "秋", order: 0, chapters: [{ id: "chapter-01", title: "一" }, { id: "chapter-01", title: "二" }] })).toThrow(StudioError);
    expect(() => parseDraft({ kind: "note", id: "limits", title: "极限", summary: "摘要", pubDate: "2026-06-29", tags: [], draft: true, body: "", course: "math", chapter: "chapter-01", order: -1 })).toThrow(StudioError);
  });

  it("parses a complete structure transaction", () => {
    expect(parseStructureRequest({ course: { id: "math", expectedRevision: "rev", chapters: [{ id: "chapter-01", title: "第一章" }] }, notes: [{ ref: { kind: "note", id: "limits", course: "math" }, expectedRevision: "note-rev", chapter: "chapter-01", order: 0 }] }).notes).toHaveLength(1);
  });

  it("parses the final-state structure preview contract", () => {
    const request = parseStructurePreviewRequest({
      courseId: "math",
      expectedStructureRevision: "workspace-rev",
      chapters: [{ id: "chapter-01", title: "第一章" }],
      notes: [{ ref: { kind: "note", id: "limits", course: "math" }, chapter: "chapter-01", order: 0 }],
    });
    expect(request.notes[0]).toMatchObject({ chapter: "chapter-01", order: 0 });
  });

  it("requires a valid reference and revision when deleting an article", () => {
    const expectedRevision = "a".repeat(64);
    expect(parseDeleteEntryRequest({
      ref: { kind: "essay", id: "learning-slowly" },
      expectedRevision,
    })).toEqual({ ref: { kind: "essay", id: "learning-slowly", course: undefined }, expectedRevision });
    expect(() => parseDeleteEntryRequest({ ref: { kind: "essay", id: "learning-slowly" }, expectedRevision: "stale" })).toThrow(StudioError);
  });

  it("builds site urls", () => {
    expect(sitePathFor({ kind: "note", id: "极限与连续", course: "mathematical-analysis" })).toBe("/learn/mathematical-analysis/极限与连续/");
  });
});
