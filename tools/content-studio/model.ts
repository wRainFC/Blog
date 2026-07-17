export type EntryKind = "course" | "note" | "essay";

export interface EntryReference {
  kind: EntryKind;
  id: string;
  course?: string;
}

export interface CourseDraft {
  kind: "course";
  id: string;
  title: string;
  semester: string;
  description?: string;
  order: number;
}

interface ArticleDraftBase {
  id: string;
  title: string;
  summary: string;
  pubDate: string;
  updated?: string;
  tags: string[];
  draft: boolean;
  body: string;
}

export interface NoteDraft extends ArticleDraftBase {
  kind: "note";
  course: string;
  chapter: string;
}

export interface EssayDraft extends ArticleDraftBase {
  kind: "essay";
  featured: boolean;
}

export type EntryDraft = CourseDraft | NoteDraft | EssayDraft;

export interface CatalogCourse {
  kind: "course";
  id: string;
  title: string;
  semester: string;
  order: number;
  repoPath: string;
  error?: string;
}

export interface CatalogArticle {
  kind: "note" | "essay";
  id: string;
  course?: string;
  title: string;
  summary: string;
  pubDate: string;
  updated?: string;
  tags: string[];
  draft: boolean;
  featured?: boolean;
  chapter?: string;
  extension: ".md" | ".mdx";
  readOnly: boolean;
  repoPath: string;
  error?: string;
}

export interface Catalog {
  courses: CatalogCourse[];
  articles: CatalogArticle[];
  tags: string[];
}

export interface EditorEntry {
  ref: EntryReference;
  draft: EntryDraft;
  revision: string;
  repoPath: string;
  sitePath: string;
  readOnly: boolean;
  extension: ".yaml" | ".yml" | ".md" | ".mdx";
}

export class StudioError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

const articleIdPattern = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const courseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyArticleId(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function isValidCourseId(value: string): boolean {
  return value.length <= 64 && courseIdPattern.test(value);
}

export function isValidArticleId(value: string): boolean {
  return [...value].length <= 80 && articleIdPattern.test(value);
}

export function validateDraft(draft: EntryDraft): string[] {
  const errors: string[] = [];

  if (draft.kind === "course") {
    if (!isValidCourseId(draft.id)) {
      errors.push("课程 ID 必须是小写英文 kebab-case，最长 64 个字符。");
    }
    if (!draft.title) errors.push("课程名称不能为空。");
    if (!draft.semester) errors.push("学期不能为空。");
    if (!Number.isInteger(draft.order)) errors.push("排序值必须是整数。");
    return errors;
  }

  if (!isValidArticleId(draft.id)) {
    errors.push("文章 ID 只能包含中英文字母、数字和单个连字符，最长 80 个字符。");
  }
  if (!draft.title) errors.push("标题不能为空。");
  if (!draft.summary) errors.push("摘要不能为空。");
  if (!isIsoDate(draft.pubDate)) errors.push("发布日期必须是有效的 YYYY-MM-DD 日期。");
  if (draft.updated && !isIsoDate(draft.updated)) {
    errors.push("更新时间必须是有效的 YYYY-MM-DD 日期。");
  }
  if (draft.tags.some((tag) => !tag || tag.length > 40)) {
    errors.push("标签不能为空且每个标签不能超过 40 个字符。");
  }
  if (draft.kind === "note") {
    if (!isValidCourseId(draft.course)) errors.push("请选择有效课程。");
    if (!draft.chapter) errors.push("章节不能为空。");
  }

  return errors;
}

export function parseDraft(value: unknown): EntryDraft {
  if (!isRecord(value)) throw new StudioError("内容数据格式不正确。");
  const kind = stringValue(value.kind, "内容类型");

  if (kind === "course") {
    const draft: CourseDraft = {
      kind,
      id: stringValue(value.id, "课程 ID").trim(),
      title: stringValue(value.title, "课程名称").trim(),
      semester: stringValue(value.semester, "学期").trim(),
      description: optionalString(value.description)?.trim() || undefined,
      order: numberValue(value.order, "排序值"),
    };
    assertValidDraft(draft);
    return draft;
  }

  if (kind !== "note" && kind !== "essay") {
    throw new StudioError("未知的内容类型。");
  }

  const common = {
    id: stringValue(value.id, "文章 ID").trim(),
    title: stringValue(value.title, "标题").trim(),
    summary: stringValue(value.summary, "摘要").trim(),
    pubDate: stringValue(value.pubDate, "发布日期").trim(),
    updated: optionalString(value.updated)?.trim() || undefined,
    tags: stringArray(value.tags, "标签"),
    draft: booleanValue(value.draft, "草稿状态"),
    body: stringValue(value.body, "正文"),
  };

  const draft: EntryDraft = kind === "note"
    ? {
        kind,
        ...common,
        course: stringValue(value.course, "课程").trim(),
        chapter: stringValue(value.chapter, "章节").trim(),
      }
    : {
        kind,
        ...common,
        featured: booleanValue(value.featured, "精选状态"),
      };

  draft.tags = [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))];
  assertValidDraft(draft);
  return draft;
}

export function parseReference(value: unknown): EntryReference {
  if (!isRecord(value)) throw new StudioError("内容引用格式不正确。");
  const kind = stringValue(value.kind, "内容类型");
  if (kind !== "course" && kind !== "note" && kind !== "essay") {
    throw new StudioError("未知的内容类型。");
  }
  const id = stringValue(value.id, "内容 ID").trim();
  const course = optionalString(value.course)?.trim() || undefined;
  if (kind === "course" ? !isValidCourseId(id) : !isValidArticleId(id)) {
    throw new StudioError("内容 ID 不合法。");
  }
  if (kind === "note" && (!course || !isValidCourseId(course))) {
    throw new StudioError("课程引用不合法。");
  }
  return { kind, id, course };
}

function assertValidDraft(draft: EntryDraft): void {
  const errors = validateDraft(draft);
  if (errors.length) throw new StudioError(errors[0], 422, errors);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new StudioError(`${label}格式不正确。`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new StudioError("可选文本字段格式不正确。");
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new StudioError(`${label}格式不正确。`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioError(`${label}格式不正确。`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new StudioError(`${label}格式不正确。`);
  }
  return value as string[];
}
