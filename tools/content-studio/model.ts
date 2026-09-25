export type EntryKind = "course" | "note" | "essay";

export interface EntryReference { kind: EntryKind; id: string; course?: string }
export interface CourseChapter { id: string; title: string }
export interface CourseDraft { kind: "course"; id: string; title: string; semester: string; description?: string; order: number; chapters: CourseChapter[] }
interface ArticleDraftBase { id: string; title: string; summary: string; pubDate: string; updated?: string; tags: string[]; draft: boolean; body: string }
export interface NoteDraft extends ArticleDraftBase { kind: "note"; course: string; chapter: string; order: number }
export interface EssayDraft extends ArticleDraftBase { kind: "essay"; featured: boolean }
export type EntryDraft = CourseDraft | NoteDraft | EssayDraft;

export interface CatalogChapter extends CourseChapter { noteCount: number; draftCount: number; emptyCount: number }
export interface CatalogCourse { kind: "course"; id: string; title: string; semester: string; description?: string; order: number; chapters: CatalogChapter[]; noteCount: number; draftCount: number; repoPath: string; revision: string; error?: string }
export interface BodySummary { characterCount: number; headingCount: number; empty: boolean }
export interface CatalogArticle { kind: "note" | "essay"; id: string; course?: string; title: string; summary: string; pubDate: string; updated?: string; tags: string[]; draft: boolean; featured?: boolean; chapter?: string; chapterTitle?: string; order?: number; extension: ".md" | ".mdx"; bodyReadOnly: boolean; body: BodySummary; issues: string[]; repoPath: string; revision: string; error?: string }
export interface Catalog { courses: CatalogCourse[]; articles: CatalogArticle[]; tags: string[]; issues: number }
export interface EditorEntry { ref: EntryReference; draft: EntryDraft; revision: string; repoPath: string; sitePath: string; extension: ".yaml" | ".yml" | ".md" | ".mdx"; bodyReadOnly: boolean }
export interface DeleteEntryRequest { ref: EntryReference; expectedRevision: string }
export interface DeleteEntryResult { ref: EntryReference; deletedPath: string; trashedPaths: string[] }

export interface StatusCounts { total: number; draft: number; published: number; issues: number }
export type ArticleSummary = CatalogArticle;
export interface WorkspaceChapter extends CourseChapter { notes: ArticleSummary[] }
export interface WorkspaceCourse extends Omit<CatalogCourse, "chapters" | "noteCount" | "draftCount"> {
  chapters: WorkspaceChapter[];
  unfiled: ArticleSummary[];
  counts: StatusCounts;
  structureRevision: string;
}
export interface WorkspaceSnapshot {
  revision: string;
  courses: WorkspaceCourse[];
  essays: ArticleSummary[];
  tags: string[];
  counts: StatusCounts;
}

export interface StructureNoteChange { ref: EntryReference; expectedRevision: string; chapter: string; order: number }
export interface StructureRequest { course: { id: string; expectedRevision: string; chapters: CourseChapter[] }; notes: StructureNoteChange[] }
export interface StructurePreviewNote { ref: EntryReference; chapter: string; order: number }
export interface StructurePreviewRequest {
  courseId: string;
  expectedStructureRevision: string;
  chapters: CourseChapter[];
  notes: StructurePreviewNote[];
}
export interface StudioIssue { severity: "warning" | "error"; message: string; ref?: EntryReference }
export interface StructureFileChange {
  ref: EntryReference;
  path: string;
  changes: Array<{ field: "chapters" | "chapter" | "order"; before: unknown; after: unknown }>;
}
export interface StructurePreview {
  changeSetId: string;
  files: StructureFileChange[];
  issues: StudioIssue[];
  expiresAt: string;
}

export class StudioError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: unknown) { super(message); this.name = "StudioError"; }
}

const articleIdPattern = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const kebabIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyArticleId(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
}
export function isValidCourseId(value: string): boolean { return value.length <= 64 && kebabIdPattern.test(value); }
export function isValidChapterId(value: string): boolean { return value.length <= 64 && kebabIdPattern.test(value); }
export function isValidArticleId(value: string): boolean { return [...value].length <= 80 && articleIdPattern.test(value); }

export function validateChapters(chapters: CourseChapter[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const chapter of chapters) {
    if (!isValidChapterId(chapter.id)) errors.push(`章节 ID“${chapter.id}”必须是小写 kebab-case。`);
    if (!chapter.title || [...chapter.title].length > 80) errors.push("章节标题不能为空且不能超过 80 个字符。");
    if (ids.has(chapter.id)) errors.push(`章节 ID“${chapter.id}”重复。`);
    ids.add(chapter.id);
  }
  return errors;
}

export function validateDraft(draft: EntryDraft): string[] {
  const errors: string[] = [];
  if (draft.kind === "course") {
    if (!isValidCourseId(draft.id)) errors.push("课程 ID 必须是小写英文 kebab-case，最长 64 个字符。");
    if (!draft.title) errors.push("课程名称不能为空。");
    if (!draft.semester) errors.push("学期不能为空。");
    if (!Number.isInteger(draft.order)) errors.push("排序值必须是整数。");
    return [...errors, ...validateChapters(draft.chapters)];
  }
  if (!isValidArticleId(draft.id)) errors.push("文章 ID 只能包含中英文字母、数字和单个连字符，最长 80 个字符。");
  if (!draft.title) errors.push("标题不能为空。");
  if (!draft.summary) errors.push("摘要不能为空。");
  if (!isIsoDate(draft.pubDate)) errors.push("发布日期必须是有效的 YYYY-MM-DD 日期。");
  if (draft.updated && !isIsoDate(draft.updated)) errors.push("更新时间必须是有效的 YYYY-MM-DD 日期。");
  if (draft.tags.some((tag) => !tag || tag.length > 40)) errors.push("标签不能为空且每个标签不能超过 40 个字符。");
  if (draft.kind === "note") {
    if (!isValidCourseId(draft.course)) errors.push("请选择有效课程。");
    if (!isValidChapterId(draft.chapter)) errors.push("请选择有效章节。");
    if (!Number.isInteger(draft.order) || draft.order < 0) errors.push("章节内顺序必须是非负整数。");
  }
  return errors;
}

export function parseDraft(value: unknown): EntryDraft {
  if (!isRecord(value)) throw new StudioError("内容数据格式不正确。");
  const kind = stringValue(value.kind, "内容类型");
  if (kind === "course") {
    const draft: CourseDraft = { kind, id: stringValue(value.id, "课程 ID").trim(), title: stringValue(value.title, "课程名称").trim(), semester: stringValue(value.semester, "学期").trim(), description: optionalString(value.description)?.trim() || undefined, order: numberValue(value.order, "排序值"), chapters: chapterArray(value.chapters) };
    assertValidDraft(draft); return draft;
  }
  if (kind !== "note" && kind !== "essay") throw new StudioError("未知的内容类型。");
  const common = { id: stringValue(value.id, "文章 ID").trim(), title: stringValue(value.title, "标题").trim(), summary: stringValue(value.summary, "摘要").trim(), pubDate: stringValue(value.pubDate, "发布日期").trim(), updated: optionalString(value.updated)?.trim() || undefined, tags: uniqueStrings(value.tags, "标签"), draft: booleanValue(value.draft, "草稿状态"), body: stringValue(value.body, "正文") };
  const draft: EntryDraft = kind === "note"
    ? { kind, ...common, course: stringValue(value.course, "课程").trim(), chapter: stringValue(value.chapter, "章节").trim(), order: numberValue(value.order, "章节内顺序") }
    : { kind, ...common, featured: booleanValue(value.featured, "精选状态") };
  assertValidDraft(draft); return draft;
}

export function parseReference(value: unknown): EntryReference {
  if (!isRecord(value)) throw new StudioError("内容引用格式不正确。");
  const kind = stringValue(value.kind, "内容类型");
  if (kind !== "course" && kind !== "note" && kind !== "essay") throw new StudioError("未知的内容类型。");
  const id = stringValue(value.id, "内容 ID").trim();
  const course = optionalString(value.course)?.trim() || undefined;
  if (kind === "course" ? !isValidCourseId(id) : !isValidArticleId(id)) throw new StudioError("内容 ID 不合法。");
  if (kind === "note" && (!course || !isValidCourseId(course))) throw new StudioError("课程引用不合法。");
  return { kind, id, course };
}

export function parseDeleteEntryRequest(value: unknown): DeleteEntryRequest {
  if (!isRecord(value)) throw new StudioError("删除请求格式不正确。");
  const ref = parseReference(value.ref);
  const expectedRevision = stringValue(value.expectedRevision, "内容 revision").trim();
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new StudioError("内容 revision 不合法。");
  return { ref, expectedRevision };
}

export function parseStructureRequest(value: unknown): StructureRequest {
  if (!isRecord(value) || !isRecord(value.course) || !Array.isArray(value.notes)) throw new StudioError("结构调整请求格式不正确。");
  const course = { id: stringValue(value.course.id, "课程 ID").trim(), expectedRevision: stringValue(value.course.expectedRevision, "课程 revision"), chapters: chapterArray(value.course.chapters) };
  if (!isValidCourseId(course.id)) throw new StudioError("课程 ID 不合法。");
  const chapterErrors = validateChapters(course.chapters);
  if (chapterErrors.length) throw new StudioError(chapterErrors[0], 422, chapterErrors);
  const notes = value.notes.map((item) => {
    if (!isRecord(item)) throw new StudioError("笔记结构调整格式不正确。");
    const ref = parseReference(item.ref);
    if (ref.kind !== "note" || ref.course !== course.id) throw new StudioError("结构调整包含其他课程或非笔记内容。", 422);
    const chapter = stringValue(item.chapter, "章节 ID").trim();
    const order = numberValue(item.order, "章节内顺序");
    if (!isValidChapterId(chapter) || !Number.isInteger(order) || order < 0) throw new StudioError("笔记章节或顺序不合法。", 422);
    return { ref, expectedRevision: stringValue(item.expectedRevision, "笔记 revision"), chapter, order };
  });
  return { course, notes };
}

export function parseStructurePreviewRequest(value: unknown): StructurePreviewRequest {
  if (!isRecord(value) || !Array.isArray(value.notes)) throw new StudioError("结构预览请求格式不正确。");
  const courseId = stringValue(value.courseId, "课程 ID").trim();
  const expectedStructureRevision = stringValue(value.expectedStructureRevision, "结构 revision");
  const chapters = chapterArray(value.chapters);
  if (!isValidCourseId(courseId)) throw new StudioError("课程 ID 不合法。");
  const chapterErrors = validateChapters(chapters);
  if (chapterErrors.length) throw new StudioError(chapterErrors[0], 422, chapterErrors);
  const seen = new Set<string>();
  const notes = value.notes.map((item) => {
    if (!isRecord(item)) throw new StudioError("笔记结构格式不正确。");
    const ref = parseReference(item.ref);
    if (ref.kind !== "note" || ref.course !== courseId) throw new StudioError("结构预览包含其他课程或非笔记内容。", 422);
    const key = `${ref.course}/${ref.id}`.toLocaleLowerCase();
    if (seen.has(key)) throw new StudioError(`笔记“${ref.id}”重复。`, 422);
    seen.add(key);
    const chapter = stringValue(item.chapter, "章节 ID").trim();
    const order = numberValue(item.order, "章节内顺序");
    if (!isValidChapterId(chapter) || !Number.isInteger(order) || order < 0) throw new StudioError("笔记章节或顺序不合法。", 422);
    return { ref, chapter, order };
  });
  return { courseId, expectedStructureRevision, chapters, notes };
}

export function parseChangeSetId(value: unknown): string {
  if (!isRecord(value)) throw new StudioError("应用结构调整的请求格式不正确。");
  const id = stringValue(value.changeSetId, "变更集 ID").trim();
  if (!/^[a-f0-9]{32}$/.test(id)) throw new StudioError("变更集 ID 不合法。");
  return id;
}

function assertValidDraft(draft: EntryDraft): void { const errors = validateDraft(draft); if (errors.length) throw new StudioError(errors[0], 422, errors); }
function isIsoDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown, label: string): string { if (typeof value !== "string") throw new StudioError(`${label}格式不正确。`); return value; }
function optionalString(value: unknown): string | undefined { if (value == null || value === "") return undefined; if (typeof value !== "string") throw new StudioError("可选文本字段格式不正确。"); return value; }
function booleanValue(value: unknown, label: string): boolean { if (typeof value !== "boolean") throw new StudioError(`${label}格式不正确。`); return value; }
function numberValue(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new StudioError(`${label}格式不正确。`); return value; }
function uniqueStrings(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new StudioError(`${label}格式不正确。`); return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))]; }
function chapterArray(value: unknown): CourseChapter[] { if (!Array.isArray(value)) throw new StudioError("章节列表格式不正确。"); return value.map((item) => { if (!isRecord(item)) throw new StudioError("章节必须包含 ID 和标题。"); return { id: stringValue(item.id, "章节 ID").trim(), title: stringValue(item.title, "章节标题").trim() }; }); }
