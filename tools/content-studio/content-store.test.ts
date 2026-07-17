import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentStore } from "./content-store";
import type { CourseDraft, NoteDraft } from "./model";

describe("content store", () => {
  let root = "";
  let store: ContentStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yanbian-studio-"));
    await mkdir(join(root, "src", "content", "courses"), { recursive: true });
    await mkdir(join(root, "src", "content", "notes"), { recursive: true });
    await mkdir(join(root, "src", "content", "essays"), { recursive: true });
    store = new ContentStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates a course and a note, then detects stale revisions", async () => {
    const course: CourseDraft = {
      kind: "course",
      id: "data-structures",
      title: "数据结构",
      semester: "大二 · 秋",
      description: "简介",
      order: 1,
    };
    await store.save({ mode: "create", draft: course });

    const note: NoteDraft = {
      kind: "note",
      id: "binary-search-tree",
      title: "二叉搜索树",
      summary: "摘要",
      pubDate: "2026-07-17",
      tags: ["树"],
      draft: true,
      body: "## 正文",
      course: course.id,
      chapter: "第五章",
    };
    const saved = await store.save({ mode: "create", draft: note });
    expect(saved.repoPath).toBe("src/content/notes/data-structures/binary-search-tree.md");
    expect(saved.sitePath).toBe("/learn/data-structures/binary-search-tree/");

    const entry = await store.getEntry(saved.ref);
    expect(entry.draft).toMatchObject({ title: "二叉搜索树", body: "## 正文" });
    const updated = { ...note, body: "## 更新后的正文" };
    const next = await store.save({ mode: "update", draft: updated, ref: saved.ref, expectedRevision: entry.revision });
    expect(next.revision).not.toBe(entry.revision);
    await expect(store.save({ mode: "update", draft: note, ref: saved.ref, expectedRevision: entry.revision }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("preserves unknown frontmatter keys while editing known fields", async () => {
    const path = join(root, "src", "content", "essays", "existing.md");
    await writeFile(path, `---\ntitle: 原标题\nsummary: 原摘要\npubDate: 2026-07-17\ntags: []\ndraft: true\nfeatured: false\ncustom: keep-me\n---\n\n正文\n`, "utf8");
    const entry = await store.getEntry({ kind: "essay", id: "existing" });
    await store.save({
      mode: "update",
      ref: entry.ref,
      expectedRevision: entry.revision,
      draft: { ...(entry.draft as Extract<typeof entry.draft, { kind: "essay" }>), title: "新标题" },
    });
    const saved = await readFile(path, "utf8");
    expect(saved).toContain("custom: keep-me");
    expect(saved).toContain("title: 新标题");
    expect(saved).toContain("正文");
  });

  it("rejects duplicate content and accepts a valid PNG asset", async () => {
    const course: CourseDraft = { kind: "course", id: "course", title: "课程", semester: "春", order: 0 };
    await store.save({ mode: "create", draft: course });
    const note: NoteDraft = {
      kind: "note", id: "asset-note", title: "图片", summary: "摘要", pubDate: "2026-07-17", tags: [], draft: true,
      body: "", course: "course", chapter: "第一章",
    };
    const saved = await store.save({ mode: "create", draft: note });
    await expect(store.save({ mode: "create", draft: note })).rejects.toMatchObject({ status: 409 });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const asset = await store.saveAsset(saved.ref, "diagram.png", "image/png", png);
    expect(asset.markdownPath).toBe("./assets/asset-note/diagram.png");
    await expect(store.saveAsset(saved.ref, "diagram.png", "image/png", png)).rejects.toMatchObject({ status: 409 });
    await expect(store.saveAsset(saved.ref, "../outside.png", "image/png", png)).rejects.toMatchObject({ status: 422 });
  });
});
