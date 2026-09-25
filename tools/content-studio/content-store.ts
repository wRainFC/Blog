import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import YAML, { type Document } from "yaml";
import type {
  Catalog,
  CatalogArticle,
  CatalogCourse,
  CourseChapter,
  DeleteEntryRequest,
  DeleteEntryResult,
  EditorEntry,
  EntryDraft,
  EntryReference,
  StructureFileChange,
  StructurePreview,
  StructurePreviewRequest,
  StructureRequest,
  WorkspaceSnapshot,
} from "./model";
import {
  isValidArticleId,
  isValidCourseId,
  StudioError,
  validateChapters,
  validateDraft,
} from "./model";

interface ParsedMarkdown {
  document: Document;
  data: Record<string, unknown>;
  body: string;
  eol: "\n" | "\r\n";
}

interface ParsedYaml {
  document: Document;
  data: Record<string, unknown>;
  eol: "\n" | "\r\n";
}

interface LocatedEntry {
  path: string;
  extension: ".yaml" | ".yml" | ".md" | ".mdx";
}

export interface SaveRequest {
  mode: "create" | "update";
  draft: EntryDraft;
  ref?: EntryReference;
  expectedRevision?: string;
}

export interface SaveResult {
  ref: EntryReference;
  repoPath: string;
  sitePath: string;
  revision: string;
}

export interface StructureResult {
  course: SaveResult;
  notes: SaveResult[];
  modifiedPaths: string[];
}

interface PlannedStructureFile {
  path: string;
  raw: Buffer;
  output: string;
  ref: EntryReference;
  changes: StructureFileChange["changes"];
}

interface PlannedStructure {
  files: PlannedStructureFile[];
  courseResult: SaveResult;
  noteResults: SaveResult[];
}

interface StoredChangeSet {
  request: StructureRequest;
  expiresAt: number;
  preview: StructurePreview;
}

const imageTypes: Record<string, string[]> = {
  ".png": ["image/png"], ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"], ".gif": ["image/gif"], ".avif": ["image/avif"], ".svg": ["image/svg+xml"],
};

export class ContentStore {
  readonly contentRoot: string;
  private readonly structureChangeSets = new Map<string, StoredChangeSet>();

  constructor(readonly workspaceRoot: string) {
    this.contentRoot = resolve(workspaceRoot, "src", "content");
  }

  async catalog(): Promise<Catalog> {
    const courses: CatalogCourse[] = [];
    const articles: CatalogArticle[] = [];

    for (const path of await listDirectFiles(join(this.contentRoot, "courses"), [".yaml", ".yml"])) {
      const id = basename(path, extname(path));
      try {
        const raw = await readFile(path);
        const parsed = parseYaml(raw.toString("utf8"));
        const parsedChapters = chapterList(parsed.data.chapters);
        const chapterErrors = validateChapters(parsedChapters);
        if (Array.isArray(parsed.data.chapters) && parsedChapters.length !== parsed.data.chapters.length) chapterErrors.push("章节必须包含有效的 id 与 title。");
        courses.push({
          kind: "course",
          id,
          title: text(parsed.data.title) || id,
          semester: text(parsed.data.semester),
          description: optionalText(parsed.data.description),
          order: Number(parsed.data.order) || 0,
          chapters: parsedChapters.map((chapter) => ({
            ...chapter,
            noteCount: 0,
            draftCount: 0,
            emptyCount: 0,
          })),
          noteCount: 0,
          draftCount: 0,
          repoPath: this.repoPath(path),
          revision: revisionOf(raw),
          error: chapterErrors.length ? chapterErrors.join("；") : undefined,
        });
      } catch (error) {
        courses.push({
          kind: "course",
          id,
          title: id,
          semester: "",
          order: 0,
          chapters: [],
          noteCount: 0,
          draftCount: 0,
          repoPath: this.repoPath(path),
          revision: "",
          error: errorMessage(error),
        });
      }
    }

    const noteRoot = join(this.contentRoot, "notes");
    for (const courseDir of await listDirectories(noteRoot)) {
      for (const path of await listDirectFiles(courseDir.path, [".md", ".mdx"])) {
        articles.push(await this.articleSummary(path, "note", courseDir.name));
      }
    }

    for (const path of await listDirectFiles(join(this.contentRoot, "essays"), [".md", ".mdx"])) {
      articles.push(await this.articleSummary(path, "essay"));
    }

    const courseIds = new Set(courses.map((course) => course.id));
    for (const article of articles) {
      if (article.kind === "note" && (!article.course || !courseIds.has(article.course))) {
        article.issues.push("课程不存在");
      }
    }

    courses.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh-CN"));
    articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || a.title.localeCompare(b.title, "zh-CN"));

    for (const course of courses) {
      const notes = articles.filter((article) => article.kind === "note" && article.course === course.id);
      const chapterMap = new Map(course.chapters.map((chapter) => [chapter.id, chapter]));
      const seenOrders = new Map<string, CatalogArticle>();
      for (const note of notes) {
        const chapter = note.chapter ? chapterMap.get(note.chapter) : undefined;
        if (!chapter) note.issues.push(note.chapter ? `未知章节 ID：${note.chapter}` : "缺少章节");
        else note.chapterTitle = chapter.title;
        if (chapter && note.order !== undefined) {
          const key = `${note.chapter}:${note.order}`;
          const previous = seenOrders.get(key);
          if (previous) {
            note.issues.push(`章节内顺序 ${note.order} 与“${previous.title}”重复`);
            if (!previous.issues.some((issue) => issue.includes(`章节内顺序 ${note.order}`))) previous.issues.push(`章节内顺序 ${note.order} 与“${note.title}”重复`);
          } else seenOrders.set(key, note);
        }
      }
      course.chapters = course.chapters.map((chapter) => {
        const chapterNotes = notes.filter((note) => note.chapter === chapter.id);
        return {
          id: chapter.id,
          title: chapter.title,
          noteCount: chapterNotes.length,
          draftCount: chapterNotes.filter((note) => note.draft).length,
          emptyCount: chapterNotes.filter((note) => note.body.empty).length,
        };
      });
      course.noteCount = notes.length;
      course.draftCount = notes.filter((note) => note.draft).length;
    }

    const tags = [...new Set(articles.flatMap((article) => article.tags))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));

    return {
      courses,
      articles,
      tags,
      issues: articles.reduce((total, article) => total + article.issues.length, 0)
        + courses.filter((course) => Boolean(course.error)).length,
    };
  }

  async workspace(): Promise<WorkspaceSnapshot> {
    const catalog = await this.catalog();
    const courses = catalog.courses.map((course) => {
      const notes = catalog.articles.filter((article) => article.kind === "note" && article.course === course.id);
      const chapters = course.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        notes: notes.filter((note) => note.chapter === chapter.id).sort(noteOrder),
      }));
      const unfiled = notes.filter((note) => !course.chapters.some((chapter) => chapter.id === note.chapter)).sort(noteOrder);
      const counts = statusCounts(notes);
      const structureRevision = revisionOf(JSON.stringify([
        course.revision,
        ...notes.map((note) => `${note.id}:${note.revision}`).sort(),
      ]));
      return {
        kind: course.kind,
        id: course.id,
        title: course.title,
        semester: course.semester,
        description: course.description,
        order: course.order,
        repoPath: course.repoPath,
        revision: course.revision,
        error: course.error,
        chapters,
        unfiled,
        counts,
        structureRevision,
      };
    });
    const essays = catalog.articles.filter((article) => article.kind === "essay");
    return {
      revision: revisionOf(JSON.stringify([
        ...courses.map((course) => `${course.id}:${course.structureRevision}`),
        ...essays.map((essay) => `${essay.id}:${essay.revision}`),
      ])),
      courses,
      essays,
      tags: catalog.tags,
      counts: statusCounts(catalog.articles),
    };
  }

  async getEntry(ref: EntryReference): Promise<EditorEntry> {
    const located = await this.locateExisting(ref);
    if (!located) throw new StudioError("没有找到对应内容。", 404);
    const raw = await readFile(located.path);
    const revision = revisionOf(raw);

    if (ref.kind === "course") {
      const parsed = parseYaml(raw.toString("utf8"));
      const draft: EntryDraft = {
        kind: "course",
        id: ref.id,
        title: text(parsed.data.title),
        semester: text(parsed.data.semester),
        description: optionalText(parsed.data.description),
        order: Number(parsed.data.order) || 0,
        chapters: chapterList(parsed.data.chapters),
      };
      return {
        ref,
        draft,
        revision,
        repoPath: this.repoPath(located.path),
        sitePath: sitePathFor(ref),
        extension: located.extension,
        bodyReadOnly: false,
      };
    }

    const parsed = parseMarkdown(raw.toString("utf8"));
    const common = {
      id: ref.id,
      title: text(parsed.data.title),
      summary: text(parsed.data.summary),
      pubDate: dateText(parsed.data.pubDate),
      updated: optionalDateText(parsed.data.updated),
      tags: stringList(parsed.data.tags),
      draft: Boolean(parsed.data.draft),
      body: parsed.body,
    };
    const draft: EntryDraft = ref.kind === "note"
      ? {
          kind: "note",
          ...common,
          course: ref.course ?? text(parsed.data.course),
          chapter: text(parsed.data.chapter),
          order: integer(parsed.data.order),
        }
      : {
          kind: "essay",
          ...common,
          featured: Boolean(parsed.data.featured),
        };

    return {
      ref,
      draft,
      revision,
      repoPath: this.repoPath(located.path),
      sitePath: sitePathFor(ref),
      extension: located.extension,
      bodyReadOnly: located.extension === ".mdx",
    };
  }

  async save(request: SaveRequest): Promise<SaveResult> {
    const errors = validateDraft(request.draft);
    if (errors.length) throw new StudioError(errors[0], 422, errors);

    if (request.draft.kind === "note") {
      const noteDraft = request.draft;
      const course = await this.locateExisting({ kind: "course", id: noteDraft.course });
      if (!course) throw new StudioError("所选课程不存在，请先创建课程。", 422);
      const courseData = parseYaml((await readFile(course.path, "utf8"))).data;
      if (!chapterList(courseData.chapters).some((chapter) => chapter.id === noteDraft.chapter)) {
        throw new StudioError(`课程中不存在章节“${noteDraft.chapter}”。`, 422);
      }
      const siblings = await listDirectFiles(this.resolveWithinContent("notes", noteDraft.course), [".md", ".mdx"]);
      for (const path of siblings) {
        const siblingId = basename(path, extname(path));
        if (request.mode === "update" && siblingId.toLocaleLowerCase() === noteDraft.id.toLocaleLowerCase()) continue;
        const data = parseMarkdown(await readFile(path, "utf8")).data;
        if (text(data.chapter) === noteDraft.chapter && optionalInteger(data.order) === noteDraft.order) {
          throw new StudioError(`章节内顺序 ${noteDraft.order} 已被笔记“${siblingId}”使用。`, 422);
        }
      }
    }

    const targetRef = referenceForDraft(request.draft);
    let targetPath = this.pathForNewDraft(request.draft);
    let existingDocument: Document | undefined;
    let existingBody = "";
    let eol: "\n" | "\r\n" = "\n";

    if (request.mode === "create") {
      await this.assertNoContentCollision(targetRef);
    } else {
      if (!request.ref || !request.expectedRevision) {
        throw new StudioError("更新内容时缺少 revision。", 400);
      }
      assertLockedIdentity(request.ref, targetRef);
      const located = await this.locateExisting(request.ref);
      if (!located) throw new StudioError("内容已被移走或删除。", 409);
      const raw = await readFile(located.path);
      if (revisionOf(raw) !== request.expectedRevision) {
        throw new StudioError("文件已在工作台之外发生变化。", 409);
      }
      targetPath = located.path;
      if (request.draft.kind === "course") {
        const parsed = parseYaml(raw.toString("utf8"));
        existingDocument = parsed.document;
        eol = parsed.eol;
      } else {
        const parsed = parseMarkdown(raw.toString("utf8"));
        existingDocument = parsed.document;
        existingBody = located.extension === ".mdx" ? parsed.body : request.draft.body;
        eol = parsed.eol;
      }
    }

    const document = existingDocument ?? createDocument();
    let output: string;
    if (request.draft.kind === "course") {
      setYamlValue(document, "title", request.draft.title);
      setYamlValue(document, "semester", request.draft.semester);
      setOptionalYamlValue(document, "description", request.draft.description);
      setYamlValue(document, "order", request.draft.order);
      setOptionalYamlChapters(document, "chapters", request.draft.chapters);
      output = withEol(document.toString({ lineWidth: 0 }), eol);
    } else {
      setYamlValue(document, "title", request.draft.title);
      setYamlValue(document, "summary", request.draft.summary);
      setYamlValue(document, "pubDate", request.draft.pubDate);
      setOptionalYamlValue(document, "updated", request.draft.updated);
      if (request.draft.kind === "note") {
        setYamlValue(document, "course", request.draft.course);
        setYamlValue(document, "chapter", request.draft.chapter);
        setYamlValue(document, "order", request.draft.order);
      }
      setYamlValue(document, "tags", request.draft.tags);
      setYamlValue(document, "draft", request.draft.draft);
      if (request.draft.kind === "essay") {
        setYamlValue(document, "featured", request.draft.featured);
      }
      const body = request.mode === "create" ? request.draft.body : existingBody;
      output = serializeMarkdown(document, body, eol);
    }

    await this.atomicWrite(targetPath, output, request.mode === "create");
    const revision = revisionOf(Buffer.from(output, "utf8"));
    return {
      ref: targetRef,
      repoPath: this.repoPath(targetPath),
      sitePath: sitePathFor(targetRef),
      revision,
    };
  }

  async deleteEntry(request: DeleteEntryRequest): Promise<DeleteEntryResult> {
    if (request.ref.kind === "course") {
      throw new StudioError("课程不能通过文章删除操作移除。", 422);
    }
    const located = await this.locateExisting(request.ref);
    if (!located) throw new StudioError("文章已被移走或删除。", 409);
    const raw = await readFile(located.path);
    if (revisionOf(raw) !== request.expectedRevision) {
      throw new StudioError("文章已在工作台之外发生变化。", 409);
    }

    const contentRoot = await realpath(this.contentRoot);
    const sources = [located.path];
    const assetDirectory = resolve(dirname(located.path), "assets", request.ref.id);
    const assetInfo = await stat(assetDirectory).catch(() => undefined);
    if (assetInfo) {
      if (!assetInfo.isDirectory()) throw new StudioError("文章资源路径不是目录，无法安全删除。", 422);
      assertContained(contentRoot, await realpath(assetDirectory));
      sources.push(assetDirectory);
    }

    const batch = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
    const trashRoot = resolve(this.workspaceRoot, ".content-studio-trash", batch);
    const moves = sources.map((source) => {
      const repoRelative = relative(this.workspaceRoot, source);
      if (!repoRelative || repoRelative === ".." || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
        throw new StudioError("删除目标超出了工作区。", 400);
      }
      return { source, target: resolve(trashRoot, repoRelative) };
    });
    await Promise.all(moves.map((move) => mkdir(dirname(move.target), { recursive: true })));

    const moved: typeof moves = [];
    try {
      for (const move of moves) {
        await this.movePath(move.source, move.target);
        moved.push(move);
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const move of [...moved].reverse()) {
        try { await this.movePath(move.target, move.source); }
        catch { rollbackFailures.push(this.repoPath(move.source)); }
      }
      throw new StudioError("删除文章失败，已尝试恢复原文件。", 500, {
        cause: errorMessage(error), rollbackFailures,
      });
    }

    this.structureChangeSets.clear();
    return {
      ref: request.ref,
      deletedPath: this.repoPath(located.path),
      trashedPaths: moves.map((move) => this.repoPath(move.target)),
    };
  }

  async applyStructure(request: StructureRequest): Promise<StructureResult> {
    return this.commitStructurePlan(await this.planStructure(request));
  }

  async previewStructure(request: StructurePreviewRequest): Promise<StructurePreview> {
    this.pruneChangeSets();
    const workspace = await this.workspace();
    const course = workspace.courses.find((item) => item.id === request.courseId);
    if (!course) throw new StudioError("课程已被移走或删除。", 409);
    if (course.structureRevision !== request.expectedStructureRevision) {
      throw new StudioError("课程目录已在工作台之外发生变化。", 409, {
        expected: request.expectedStructureRevision,
        actual: course.structureRevision,
      });
    }
    const currentNotes = [...course.chapters.flatMap((chapter) => chapter.notes), ...course.unfiled];
    const revisionById = new Map(currentNotes.map((note) => [note.id.toLocaleLowerCase(), note.revision]));
    if (request.notes.length !== currentNotes.length) {
      throw new StudioError("结构预览必须包含该课程当前的全部笔记；目录可能已发生变化。", 409);
    }
    const notes = request.notes.map((note) => {
      const expectedRevision = revisionById.get(note.ref.id.toLocaleLowerCase());
      if (!expectedRevision) throw new StudioError(`没有找到笔记“${note.ref.id}”，目录可能已发生变化。`, 409);
      return { ...note, expectedRevision };
    });
    const legacyRequest: StructureRequest = {
      course: {
        id: course.id,
        expectedRevision: course.revision,
        chapters: request.chapters,
      },
      notes,
    };
    const plan = await this.planStructure(legacyRequest);
    const changeSetId = randomBytes(16).toString("hex");
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const preview: StructurePreview = {
      changeSetId,
      files: plan.files
        .filter((file) => file.changes.length > 0)
        .map((file) => ({ ref: file.ref, path: this.repoPath(file.path), changes: file.changes })),
      issues: [],
      expiresAt: new Date(expiresAt).toISOString(),
    };
    this.structureChangeSets.set(changeSetId, { request: legacyRequest, expiresAt, preview });
    return preview;
  }

  async applyStructureChangeSet(changeSetId: string): Promise<StructureResult> {
    this.pruneChangeSets();
    const changeSet = this.structureChangeSets.get(changeSetId);
    if (!changeSet) throw new StudioError("结构变更集不存在或已经过期，请重新审阅。", 409);
    const plan = await this.planStructure(changeSet.request);
    const result = await this.commitStructurePlan(plan);
    this.structureChangeSets.delete(changeSetId);
    return result;
  }

  private async planStructure(request: StructureRequest): Promise<PlannedStructure> {
    const courseRef: EntryReference = { kind: "course", id: request.course.id };
    const courseEntry = await this.locateExisting(courseRef);
    if (!courseEntry) throw new StudioError("课程已被移走或删除。", 409);
    const chapterErrors = validateChapters(request.course.chapters);
    if (chapterErrors.length) throw new StudioError(chapterErrors[0], 422, chapterErrors);

    const courseRaw = await readFile(courseEntry.path);
    if (revisionOf(courseRaw) !== request.course.expectedRevision) throw new StudioError("课程文件已在工作台之外发生变化。", 409);

    const notePaths = await listDirectFiles(this.resolveWithinContent("notes", request.course.id), [".md", ".mdx"]);
    const changes = new Map(request.notes.map((note) => [note.ref.id.toLocaleLowerCase(), note]));
    if (changes.size !== request.notes.length || notePaths.length !== request.notes.length) {
      throw new StudioError("结构调整必须包含该课程当前的全部笔记；目录可能已发生变化。", 409);
    }

    const chapterIds = new Set(request.course.chapters.map((chapter) => chapter.id));
    const orders = new Set<string>();
    const pending: PlannedStructureFile[] = [];
    for (const path of notePaths) {
      const extension = extname(path).toLowerCase();
      const id = basename(path, extension);
      const change = changes.get(id.toLocaleLowerCase());
      if (!change) throw new StudioError(`结构调整缺少笔记“${id}”。`, 409);
      const raw = await readFile(path);
      if (revisionOf(raw) !== change.expectedRevision) throw new StudioError(`笔记“${id}”已在工作台之外发生变化。`, 409);
      if (!chapterIds.has(change.chapter)) throw new StudioError(`笔记“${id}”引用了不存在的章节“${change.chapter}”。`, 422);
      const orderKey = `${change.chapter}:${change.order}`;
      if (orders.has(orderKey)) throw new StudioError(`章节“${change.chapter}”中存在重复顺序 ${change.order}。`, 422);
      orders.add(orderKey);
      const parsed = parseMarkdown(raw.toString("utf8"));
      if (text(parsed.data.course) !== request.course.id) throw new StudioError(`笔记“${id}”的课程引用与目录不一致。`, 422);
      const changesForFile: StructureFileChange["changes"] = [];
      const beforeChapter = text(parsed.data.chapter);
      const beforeOrder = optionalInteger(parsed.data.order);
      if (beforeChapter !== change.chapter) changesForFile.push({ field: "chapter", before: beforeChapter, after: change.chapter });
      if (beforeOrder !== change.order) changesForFile.push({ field: "order", before: beforeOrder, after: change.order });
      setYamlValue(parsed.document, "chapter", change.chapter);
      setYamlValue(parsed.document, "order", change.order);
      pending.push({ path, raw, output: serializeMarkdown(parsed.document, parsed.body, parsed.eol), ref: change.ref, changes: changesForFile });
    }

    const courseParsed = parseYaml(courseRaw.toString("utf8"));
    const beforeChapters = chapterList(courseParsed.data.chapters);
    setOptionalYamlChapters(courseParsed.document, "chapters", request.course.chapters);
    const courseChanges: StructureFileChange["changes"] = JSON.stringify(beforeChapters) === JSON.stringify(request.course.chapters)
      ? []
      : [{ field: "chapters", before: beforeChapters, after: request.course.chapters }];
    pending.unshift({ path: courseEntry.path, raw: courseRaw, output: withEol(courseParsed.document.toString({ lineWidth: 0 }), courseParsed.eol), ref: courseRef, changes: courseChanges });

    const results = pending.map((file) => ({ ref: file.ref, repoPath: this.repoPath(file.path), sitePath: sitePathFor(file.ref), revision: revisionOf(file.output) }));
    return { files: pending, courseResult: results[0], noteResults: results.slice(1) };
  }

  private async commitStructurePlan(plan: PlannedStructure): Promise<StructureResult> {
    const changed = plan.files.filter((file) => file.changes.length > 0);
    const written: PlannedStructureFile[] = [];
    try {
      for (const file of changed) {
        await this.atomicWrite(file.path, file.output, false);
        written.push(file);
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const file of [...written].reverse()) {
        try { await this.atomicWrite(file.path, file.raw, false); }
        catch { rollbackFailures.push(this.repoPath(file.path)); }
      }
      throw new StudioError("应用结构调整失败，已尝试恢复原文件。", 500, {
        cause: errorMessage(error), rollbackFailures,
      });
    }

    return {
      course: plan.courseResult,
      notes: plan.noteResults,
      modifiedPaths: changed.map((file) => this.repoPath(file.path)),
    };
  }

  private pruneChangeSets(): void {
    const now = Date.now();
    for (const [id, changeSet] of this.structureChangeSets) {
      if (changeSet.expiresAt <= now) this.structureChangeSets.delete(id);
    }
  }

  async saveAsset(ref: EntryReference, requestedName: string, mime: string, contents: Buffer): Promise<{ filename: string; markdownPath: string; repoPath: string }> {
    if (ref.kind === "course") throw new StudioError("课程不能添加正文图片。", 422);
    if (contents.length === 0 || contents.length > 10 * 1024 * 1024) throw new StudioError("图片大小必须在 1 字节到 10 MB 之间。", 413);
    const entry = await this.locateExisting(ref);
    if (!entry) throw new StudioError("请先保存文章，再添加图片。", 422);
    if (entry.extension !== ".md") throw new StudioError("MDX 正文只读，不能添加图片。", 422);
    const filename = sanitizeAssetFilename(requestedName);
    const extension = extname(filename).toLowerCase();
    const expectedMimes = imageTypes[extension];
    if (!expectedMimes?.includes(mime.toLowerCase())) throw new StudioError("图片扩展名与 MIME 类型不匹配。", 415);
    if (!matchesImageSignature(extension, contents)) throw new StudioError("图片文件内容与扩展名不匹配。", 415);
    const assetDir = resolve(dirname(entry.path), "assets", ref.id);
    const target = this.resolveWithinContent(assetDir, filename);
    await this.ensureSafeParent(target);
    await assertNoCaseInsensitiveFile(assetDir, filename);
    await this.atomicWrite(target, contents, true);
    return { filename, markdownPath: `./assets/${ref.id}/${filename}`, repoPath: this.repoPath(target) };
  }

  async resolvePreviewAsset(ref: EntryReference, source: string): Promise<string> {
    if (ref.kind === "course") throw new StudioError("资源引用无效。", 400);
    if (/^(?:[a-z]+:|\/\/|\/)/i.test(source)) throw new StudioError("不是相对资源。", 400);
    const cleanSource = source.split(/[?#]/, 1)[0];
    const existing = await this.locateExisting(ref);
    if (!existing) throw new StudioError("请先保存文章再预览相对资源。", 422);
    const candidate = this.resolveWithinContent(dirname(existing.path), cleanSource);
    const info = await stat(candidate).catch(() => undefined);
    if (!info?.isFile()) throw new StudioError("预览图片不存在。", 404);
    const realCandidate = await realpath(candidate);
    assertContained(await realpath(this.contentRoot), realCandidate);
    return realCandidate;
  }

  private async articleSummary(
    path: string,
    kind: "note" | "essay",
    course?: string,
  ): Promise<CatalogArticle> {
    const extension = extname(path).toLowerCase() as ".md" | ".mdx";
    const id = basename(path, extension);
    try {
      const raw = await readFile(path);
      const parsed = parseMarkdown(raw.toString("utf8"));
      const body = summarizeBody(parsed.body);
      const issues = articleIssues(parsed.data, kind, course, body);
      return {
        kind,
        id,
        course,
        title: text(parsed.data.title) || id,
        summary: text(parsed.data.summary),
        pubDate: dateText(parsed.data.pubDate),
        updated: optionalDateText(parsed.data.updated),
        tags: stringList(parsed.data.tags),
        draft: Boolean(parsed.data.draft),
        featured: kind === "essay" ? Boolean(parsed.data.featured) : undefined,
        chapter: kind === "note" ? text(parsed.data.chapter) : undefined,
        order: kind === "note" ? optionalInteger(parsed.data.order) : undefined,
        extension,
        bodyReadOnly: extension === ".mdx",
        body,
        issues,
        repoPath: this.repoPath(path),
        revision: revisionOf(raw),
      };
    } catch (error) {
      return {
        kind,
        id,
        course,
        title: id,
        summary: "",
        pubDate: "",
        tags: [],
        draft: true,
        extension,
        bodyReadOnly: extension === ".mdx",
        body: { characterCount: 0, headingCount: 0, empty: true },
        issues: [errorMessage(error)],
        repoPath: this.repoPath(path),
        revision: "",
        error: errorMessage(error),
      };
    }
  }

  private pathForNewDraft(draft: EntryDraft): string {
    if (draft.kind === "course") {
      if (!isValidCourseId(draft.id)) throw new StudioError("课程 ID 不合法。", 422);
      return this.resolveWithinContent("courses", `${draft.id}.yaml`);
    }
    if (!isValidArticleId(draft.id)) throw new StudioError("文章 ID 不合法。", 422);
    if (draft.kind === "note") {
      if (!isValidCourseId(draft.course)) throw new StudioError("课程 ID 不合法。", 422);
      return this.resolveWithinContent("notes", draft.course, `${draft.id}.md`);
    }
    return this.resolveWithinContent("essays", `${draft.id}.md`);
  }

  private async locateExisting(ref: EntryReference): Promise<LocatedEntry | undefined> {
    const directory = ref.kind === "course"
      ? this.resolveWithinContent("courses")
      : ref.kind === "note"
        ? this.resolveWithinContent("notes", ref.course ?? "")
        : this.resolveWithinContent("essays");
    const extensions = ref.kind === "course" ? [".yaml", ".yml"] : [".md", ".mdx"];
    const files = await listDirectFiles(directory, extensions);
    const wanted = ref.id.toLocaleLowerCase();
    const match = files.find((path) => basename(path, extname(path)).toLocaleLowerCase() === wanted);
    if (!match) return undefined;
    assertContained(await realpath(this.contentRoot), await realpath(match));
    return { path: match, extension: extname(match).toLowerCase() as LocatedEntry["extension"] };
  }

  private async assertNoContentCollision(ref: EntryReference): Promise<void> {
    if (await this.locateExisting(ref)) {
      throw new StudioError("相同 ID 的内容已经存在。", 409);
    }
  }

  private resolveWithinContent(...segments: string[]): string {
    const candidate = resolve(this.contentRoot, ...segments);
    const rel = relative(this.contentRoot, candidate);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return candidate;
    throw new StudioError("路径超出了内容目录。", 400);
  }

  private async ensureSafeParent(target: string): Promise<void> {
    const rootReal = await realpath(this.contentRoot);
    let existing = dirname(target);
    while (!(await exists(existing))) {
      const parent = dirname(existing);
      if (parent === existing) throw new StudioError("无法确认目标目录。", 400);
      existing = parent;
    }
    assertContained(rootReal, await realpath(existing));
    await mkdir(dirname(target), { recursive: true });
    assertContained(rootReal, await realpath(dirname(target)));
  }

  protected async atomicWrite(target: string, value: string | Buffer, createOnly: boolean): Promise<void> {
    await this.ensureSafeParent(target);
    if (createOnly && await exists(target)) throw new StudioError("目标文件已经存在。", 409);
    const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await writeFile(temp, value, { flag: "wx" });
      if (createOnly && await exists(target)) throw new StudioError("目标文件已经存在。", 409);
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }

  protected async movePath(source: string, target: string): Promise<void> {
    await rename(source, target);
  }

  private repoPath(path: string): string {
    return relative(this.workspaceRoot, path).split(sep).join("/");
  }
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) throw new StudioError("Markdown 缺少有效的 frontmatter。", 422);
  const document = parseDocument(match[1]);
  let body = match[2] ?? "";
  if (body.startsWith("\n")) body = body.slice(1);
  return { document, data: document.toJS() as Record<string, unknown>, body, eol };
}

export function parseYaml(raw: string): ParsedYaml {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const document = parseDocument(raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
  return { document, data: document.toJS() as Record<string, unknown>, eol };
}

export function serializeMarkdown(
  document: Document,
  body: string,
  eol: "\n" | "\r\n" = "\n",
): string {
  const yaml = document.toString({ lineWidth: 0 }).trimEnd();
  const normalizedBody = body.replace(/\r\n?/g, "\n").replace(/^\n/, "");
  return withEol(`---\n${yaml}\n---\n\n${normalizedBody}`, eol);
}

export function revisionOf(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sitePathFor(ref: EntryReference): string {
  if (ref.kind === "course") return `/learn/${encodeURIComponent(ref.id)}/`;
  if (ref.kind === "essay") return `/writing/${ref.id}/`;
  return `/learn/${encodeURIComponent(ref.course ?? "")}/${ref.id}/`;
}

function referenceForDraft(draft: EntryDraft): EntryReference {
  return draft.kind === "note"
    ? { kind: "note", id: draft.id, course: draft.course }
    : { kind: draft.kind, id: draft.id };
}

function assertLockedIdentity(original: EntryReference, target: EntryReference): void {
  if (original.kind !== target.kind || original.id !== target.id || original.course !== target.course) {
    throw new StudioError("已保存内容的类型、ID 和所属课程不能在工作台中修改。", 422);
  }
}

function createDocument(): Document {
  const document = new YAML.Document();
  document.contents = document.createNode({});
  return document;
}

function parseDocument(source: string): Document {
  const document = YAML.parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) throw new StudioError(`YAML 解析失败：${document.errors[0].message}`, 422);
  const data = document.toJS();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new StudioError("YAML 顶层必须是对象。", 422);
  }
  return document;
}

function setYamlValue(document: Document, key: string, value: unknown): void {
  const oldNode = document.get(key, true) as { comment?: string; commentBefore?: string; spaceBefore?: boolean } | undefined;
  document.set(key, value);
  const newNode = document.get(key, true) as { comment?: string; commentBefore?: string; spaceBefore?: boolean } | undefined;
  if (oldNode && newNode) {
    newNode.comment = oldNode.comment;
    newNode.commentBefore = oldNode.commentBefore;
    newNode.spaceBefore = oldNode.spaceBefore;
  }
}

function setOptionalYamlValue(document: Document, key: string, value?: string): void {
  if (value) setYamlValue(document, key, value);
  else document.delete(key);
}

function setOptionalYamlChapters(document: Document, key: string, value: CourseChapter[]): void {
  if (value.length) setYamlValue(document, key, value);
  else document.delete(key);
}

function summarizeBody(body: string) {
  const meaningful = body.trim();
  return {
    characterCount: [...meaningful.replace(/\s/g, "")].length,
    headingCount: meaningful.split("\n").filter((line) => /^#{1,6}\s+/.test(line)).length,
    empty: meaningful.length === 0,
  };
}

function articleIssues(
  data: Record<string, unknown>,
  kind: "note" | "essay",
  directoryCourse: string | undefined,
  body: ReturnType<typeof summarizeBody>,
): string[] {
  const issues: string[] = [];
  if (!text(data.title)) issues.push("缺少标题");
  if (!text(data.summary)) issues.push("缺少摘要");
  if (!dateText(data.pubDate)) issues.push("缺少发布日期");
  if (body.empty) issues.push("正文尚未撰写");
  if (kind === "note") {
    if (!text(data.chapter)) issues.push("缺少章节");
    if (!Number.isInteger(data.order) || Number(data.order) < 0) issues.push("缺少有效章节内顺序");
    if (text(data.course) !== directoryCourse) issues.push("课程引用与目录不一致");
  }
  if (optionalDateText(data.updated) && dateText(data.pubDate)
    && optionalDateText(data.updated)! < dateText(data.pubDate)) {
    issues.push("更新时间早于发布日期");
  }
  return issues;
}

async function listDirectFiles(directory: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && extensions.includes(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name));
}

async function assertNoCaseInsensitiveFile(directory: string, filename: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name.toLocaleLowerCase() === filename.toLocaleLowerCase())) {
    throw new StudioError("同名图片已经存在，请先修改文件名。", 409);
  }
}

async function listDirectories(directory: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }));
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
  throw new StudioError("解析后的路径超出了内容目录。", 400);
}

function withEol(value: string, eol: "\n" | "\r\n"): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return eol === "\n" ? normalized : normalized.replace(/\n/g, "\r\n");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function optionalText(value: unknown): string | undefined {
  const result = text(value).trim();
  return result || undefined;
}

function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function optionalDateText(value: unknown): string | undefined {
  const result = dateText(value);
  return result || undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function chapterList(value: unknown): CourseChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = text(record.id).trim();
    const title = text(record.title).trim();
    return id && title ? [{ id, title }] : [];
  });
}

function integer(value: unknown): number { return Number.isInteger(value) ? Number(value) : 0; }
function optionalInteger(value: unknown): number | undefined { return Number.isInteger(value) ? Number(value) : undefined; }

function sanitizeAssetFilename(value: string): string {
  const original = value.normalize("NFKC").trim();
  if (!original || original !== basename(original) || /[\\/\0-\x1f]/.test(original)) throw new StudioError("图片文件名不合法。", 422);
  const extension = extname(original).toLowerCase();
  const stem = basename(original, extname(original)).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  const filename = `${stem}${extension}`;
  if (!stem || filename.startsWith(".") || [...filename].length > 120) throw new StudioError("图片文件名不合法或过长。", 422);
  return filename;
}

function matchesImageSignature(extension: string, value: Buffer): boolean {
  if (extension === ".png") return value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === ".jpg" || extension === ".jpeg") return value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff;
  if (extension === ".gif") return /^GIF8[79]a/.test(value.subarray(0, 6).toString("ascii"));
  if (extension === ".webp") return value.subarray(0, 4).toString("ascii") === "RIFF" && value.subarray(8, 12).toString("ascii") === "WEBP";
  if (extension === ".avif") return value.subarray(4, 12).toString("ascii").includes("ftyp") && /avif|avis/.test(value.subarray(8, 32).toString("ascii"));
  if (extension === ".svg") return /^(?:\uFEFF)?\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(value.subarray(0, 4096).toString("utf8"));
  return false;
}

function noteOrder(a: CatalogArticle, b: CatalogArticle): number {
  return (a.order ?? 0) - (b.order ?? 0)
    || b.pubDate.localeCompare(a.pubDate)
    || a.id.localeCompare(b.id, "zh-CN");
}

function statusCounts(articles: CatalogArticle[]) {
  return {
    total: articles.length,
    draft: articles.filter((article) => article.draft).length,
    published: articles.filter((article) => !article.draft).length,
    issues: articles.filter((article) => article.issues.length > 0).length,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
