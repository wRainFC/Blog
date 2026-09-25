import { describe, expect, it } from "vitest";
import type { WorkspaceCourse } from "./model";
import { createStructureState, moveChapter, moveNotes, structureChangeCount, structurePreviewPayload } from "./workspace-state";

const article = (id: string, chapter: string, order: number) => ({
  kind: "note" as const,
  id,
  course: "math",
  title: id,
  summary: "摘要",
  pubDate: "2026-09-11",
  tags: [],
  draft: false,
  chapter,
  order,
  extension: ".md" as const,
  bodyReadOnly: false,
  body: { characterCount: 1, headingCount: 0, empty: false },
  issues: [],
  repoPath: "src/content/notes/math/" + id + ".md",
  revision: id + "-revision",
});

const course: WorkspaceCourse = {
  kind: "course",
  id: "math",
  title: "数学",
  semester: "秋",
  order: 0,
  repoPath: "src/content/courses/math.yaml",
  revision: "course-revision",
  structureRevision: "structure-revision",
  chapters: [
    { id: "chapter-01", title: "第一章", notes: [article("a", "chapter-01", 0), article("b", "chapter-01", 1)] },
    { id: "chapter-02", title: "第二章", notes: [] },
  ],
  unfiled: [],
  counts: { total: 2, draft: 0, published: 2, issues: 0 },
};

describe("content studio workspace state", () => {
  it("moves chapters and notes while producing a normalized final-state payload", () => {
    const state = createStructureState(course);
    moveChapter(state, "chapter-02", 0);
    moveNotes(state, ["b"], "chapter-02");
    expect(state.chapters.map((chapter) => chapter.id)).toEqual(["chapter-02", "chapter-01"]);
    expect(state.notes.find((note) => note.id === "b")).toMatchObject({ chapter: "chapter-02", order: 0 });
    expect(structureChangeCount(state)).toBe(2);
    expect(structurePreviewPayload(state)).toMatchObject({
      courseId: "math",
      expectedStructureRevision: "structure-revision",
    });
  });
});
