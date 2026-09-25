import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStore } from "./content-store";
import type { CourseDraft, NoteDraft } from "./model";

const chapters = [{ id: "chapter-01", title: "第一章" }, { id: "chapter-02", title: "第二章" }];

describe("content store", () => {
  let root = ""; let store: ContentStore;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "yanbian-studio-")); await mkdir(join(root, "src", "content", "courses"), { recursive: true }); await mkdir(join(root, "src", "content", "notes"), { recursive: true }); await mkdir(join(root, "src", "content", "essays"), { recursive: true }); store = new ContentStore(root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function seed() {
    const course: CourseDraft = { kind: "course", id: "math", title: "数学", semester: "秋", order: 1, chapters };
    const courseSave = await store.save({ mode: "create", draft: course });
    const note: NoteDraft = { kind: "note", id: "limits", title: "极限", summary: "摘要", pubDate: "2026-07-17", tags: [], draft: true, body: "## 定义\n\n正文\n", course: "math", chapter: "chapter-01", order: 0 };
    const noteSave = await store.save({ mode: "create", draft: note });
    return { course, courseSave, note, noteSave };
  }

  it("creates and edits Markdown body, then detects stale revisions", async () => {
    const { note, noteSave } = await seed(); const entry = await store.getEntry(noteSave.ref);
    expect(entry.draft).toMatchObject({ body: "## 定义\n\n正文\n", order: 0 });
    const next = await store.save({ mode: "update", draft: { ...note, title: "新标题", body: "## 新正文\n" }, ref: noteSave.ref, expectedRevision: entry.revision });
    expect(next.revision).not.toBe(entry.revision);
    await expect(store.save({ mode: "update", draft: note, ref: noteSave.ref, expectedRevision: entry.revision })).rejects.toMatchObject({ status: 409 });
  });

  it("preserves unknown frontmatter and MDX body while allowing metadata edits", async () => {
    const path = join(root, "src", "content", "essays", "interactive.mdx"); const body = "<InteractiveDemo client:load />\n\n## 说明\n";
    await writeFile(path, `---\ntitle: 交互文章\nsummary: 原摘要\npubDate: 2026-07-17\ntags: []\ndraft: true\nfeatured: false\ncustom: keep-me\n---\n\n${body}`, "utf8");
    const entry = await store.getEntry({ kind: "essay", id: "interactive" }); expect(entry.bodyReadOnly).toBe(true);
    await store.save({ mode: "update", ref: entry.ref, expectedRevision: entry.revision, draft: { ...(entry.draft as Extract<typeof entry.draft, { kind: "essay" }>), summary: "新摘要", body: "被忽略" } });
    const saved = await readFile(path, "utf8"); expect(saved).toContain("custom: keep-me"); expect(saved).toContain(body); expect(saved).not.toContain("被忽略");
  });

  it("moves an article and its managed assets to a recoverable trash after revision validation", async () => {
    const { noteSave } = await seed();
    const notePath = join(root, "src", "content", "notes", "math", "limits.md");
    const assetPath = join(root, "src", "content", "notes", "math", "assets", "limits", "graph.png");
    await mkdir(join(root, "src", "content", "notes", "math", "assets", "limits"), { recursive: true });
    await writeFile(assetPath, "managed asset");
    const noteBefore = await readFile(notePath);
    const assetBefore = await readFile(assetPath);

    await expect(store.deleteEntry({ ref: noteSave.ref, expectedRevision: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    await expect(access(notePath)).resolves.toBeUndefined();

    const deleted = await store.deleteEntry({ ref: noteSave.ref, expectedRevision: noteSave.revision });
    expect(deleted.deletedPath).toBe("src/content/notes/math/limits.md");
    expect(deleted.trashedPaths).toHaveLength(2);
    await expect(access(notePath)).rejects.toThrow();
    await expect(access(assetPath)).rejects.toThrow();
    for (const path of deleted.trashedPaths) await expect(access(join(root, path))).resolves.toBeUndefined();
    expect(await readFile(join(root, deleted.trashedPaths[0]))).toEqual(noteBefore);
    expect(await readFile(join(root, deleted.trashedPaths[1], "graph.png"))).toEqual(assetBefore);
    await expect(store.getEntry(noteSave.ref)).rejects.toMatchObject({ status: 404 });
  });

  it("restores an article when moving its managed assets to trash fails", async () => {
    class FailSecondMoveStore extends ContentStore {
      moves = 0;
      protected override async movePath(source: string, target: string): Promise<void> {
        this.moves += 1;
        if (this.moves === 2) throw new Error("simulated asset move failure");
        return super.movePath(source, target);
      }
    }
    const { noteSave } = await seed();
    const notePath = join(root, "src", "content", "notes", "math", "limits.md");
    const assetPath = join(root, "src", "content", "notes", "math", "assets", "limits", "graph.png");
    await mkdir(join(root, "src", "content", "notes", "math", "assets", "limits"), { recursive: true });
    await writeFile(assetPath, "managed asset");

    const failing = new FailSecondMoveStore(root);
    await expect(failing.deleteEntry({ ref: noteSave.ref, expectedRevision: noteSave.revision }))
      .rejects.toMatchObject({ status: 500, details: { rollbackFailures: [] } });
    await expect(access(notePath)).resolves.toBeUndefined();
    await expect(access(assetPath)).resolves.toBeUndefined();
    expect((await failing.getEntry(noteSave.ref)).draft.title).toBe("极限");
  });

  it("applies chapter rename and note move as one structure transaction without changing body", async () => {
    const { courseSave, noteSave } = await seed(); const before = await readFile(join(root, "src", "content", "notes", "math", "limits.md"), "utf8");
    const result = await store.applyStructure({ course: { id: "math", expectedRevision: courseSave.revision, chapters: [{ id: "chapter-02", title: "第二章（更新）" }, chapters[0]] }, notes: [{ ref: noteSave.ref, expectedRevision: noteSave.revision, chapter: "chapter-02", order: 0 }] });
    expect(result.modifiedPaths).toHaveLength(2);
    const after = await readFile(join(root, "src", "content", "notes", "math", "limits.md"), "utf8");
    expect(after.split("---\n\n")[1]).toBe(before.split("---\n\n")[1]); expect(after).toContain("chapter: chapter-02");
    expect(await readFile(join(root, "src", "content", "courses", "math.yaml"), "utf8")).toContain("第二章（更新）");
  });

  it("builds a nested workspace and previews structure changes without writing", async () => {
    await seed();
    const workspace = await store.workspace();
    const course = workspace.courses[0];
    expect(course.chapters[0].notes[0].title).toBe("极限");
    expect(course.counts).toMatchObject({ total: 1, draft: 1, issues: 0 });
    const notePath = join(root, "src", "content", "notes", "math", "limits.md");
    const before = await readFile(notePath, "utf8");
    const preview = await store.previewStructure({
      courseId: "math",
      expectedStructureRevision: course.structureRevision,
      chapters: [chapters[1], { ...chapters[0], title: "第一章（更新）" }],
      notes: [{ ref: { kind: "note", id: "limits", course: "math" }, chapter: "chapter-02", order: 0 }],
    });
    expect(preview.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "src/content/courses/math.yaml",
      "src/content/notes/math/limits.md",
    ]));
    expect(await readFile(notePath, "utf8")).toBe(before);
    const applied = await store.applyStructureChangeSet(preview.changeSetId);
    expect(applied.modifiedPaths).toHaveLength(2);
    expect(await readFile(notePath, "utf8")).toContain("chapter: chapter-02");
  });

  it("preflights all revisions before writing any structure file", async () => {
    const { courseSave, noteSave } = await seed(); const coursePath = join(root, "src", "content", "courses", "math.yaml"); const before = await readFile(coursePath, "utf8");
    await expect(store.applyStructure({ course: { id: "math", expectedRevision: courseSave.revision, chapters }, notes: [{ ref: noteSave.ref, expectedRevision: "stale", chapter: "chapter-02", order: 0 }] })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(coursePath, "utf8")).toBe(before);
  });

  it("rolls back files already written when a later structure write fails", async () => {
    class FailOnceStore extends ContentStore {
      writes = 0;
      protected override async atomicWrite(target: string, value: string | Buffer, createOnly: boolean): Promise<void> {
        this.writes += 1;
        if (this.writes === 2) throw new Error("simulated write failure");
        return super.atomicWrite(target, value, createOnly);
      }
    }
    const failing = new FailOnceStore(root); const { courseSave, noteSave } = await seed();
    const coursePath = join(root, "src", "content", "courses", "math.yaml"); const notePath = join(root, "src", "content", "notes", "math", "limits.md");
    const [courseBefore, noteBefore] = await Promise.all([readFile(coursePath, "utf8"), readFile(notePath, "utf8")]);
    await expect(failing.applyStructure({ course: { id: "math", expectedRevision: courseSave.revision, chapters: [...chapters].reverse() }, notes: [{ ref: noteSave.ref, expectedRevision: noteSave.revision, chapter: "chapter-02", order: 0 }] })).rejects.toMatchObject({ status: 500, details: { rollbackFailures: [] } });
    expect(await readFile(coursePath, "utf8")).toBe(courseBefore); expect(await readFile(notePath, "utf8")).toBe(noteBefore);
  });

  it("reports unknown chapters and duplicate orders in the catalog", async () => {
    await seed(); const path = join(root, "src", "content", "notes", "math", "other.md");
    await writeFile(path, "---\ntitle: 另一篇\nsummary: 摘要\npubDate: 2026-07-17\ncourse: math\nchapter: chapter-01\norder: 0\ntags: []\ndraft: false\n---\n\n正文\n");
    const catalog = await store.catalog(); expect(catalog.articles.flatMap((article) => article.issues).some((issue) => issue.includes("重复"))).toBe(true);
  });
});
