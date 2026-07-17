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
  EditorEntry,
  EntryDraft,
  EntryReference,
} from "./model";
import {
  isValidArticleId,
  isValidCourseId,
  StudioError,
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

const imageTypes: Record<string, string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".avif": ["image/avif"],
  ".svg": ["image/svg+xml", "application/svg+xml"],
};

export class ContentStore {
  readonly contentRoot: string;

  constructor(readonly workspaceRoot: string) {
    this.contentRoot = resolve(workspaceRoot, "src", "content");
  }

  async catalog(): Promise<Catalog> {
    const courses: CatalogCourse[] = [];
    const articles: CatalogArticle[] = [];

    for (const path of await listDirectFiles(join(this.contentRoot, "courses"), [".yaml", ".yml"])) {
      const id = basename(path, extname(path));
      try {
        const parsed = await parseYamlFile(path);
        courses.push({
          kind: "course",
          id,
          title: text(parsed.data.title) || id,
          semester: text(parsed.data.semester),
          order: Number(parsed.data.order) || 0,
          repoPath: this.repoPath(path),
        });
      } catch (error) {
        courses.push({
          kind: "course",
          id,
          title: id,
          semester: "",
          order: 0,
          repoPath: this.repoPath(path),
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

    courses.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "zh-CN"));
    articles.sort((a, b) => b.pubDate.localeCompare(a.pubDate) || a.title.localeCompare(b.title, "zh-CN"));

    const tags = [...new Set(articles.flatMap((article) => article.tags))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));

    return { courses, articles, tags };
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
      };
      return {
        ref,
        draft,
        revision,
        repoPath: this.repoPath(located.path),
        sitePath: sitePathFor(ref),
        readOnly: false,
        extension: located.extension,
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
      readOnly: located.extension === ".mdx",
      extension: located.extension,
    };
  }

  async save(request: SaveRequest): Promise<SaveResult> {
    const errors = validateDraft(request.draft);
    if (errors.length) throw new StudioError(errors[0], 422, errors);

    if (request.draft.kind === "note") {
      const course = await this.locateExisting({ kind: "course", id: request.draft.course });
      if (!course) throw new StudioError("所选课程不存在，请先创建课程。", 422);
    }

    const targetRef = referenceForDraft(request.draft);
    let targetPath = this.pathForNewDraft(request.draft);
    let existingDocument: Document | undefined;
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
      if (located.extension === ".mdx") {
        throw new StudioError("MDX 内容在 v1 中为只读。", 422);
      }
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
      output = withEol(document.toString({ lineWidth: 0 }), eol);
    } else {
      setYamlValue(document, "title", request.draft.title);
      setYamlValue(document, "summary", request.draft.summary);
      setYamlValue(document, "pubDate", request.draft.pubDate);
      setOptionalYamlValue(document, "updated", request.draft.updated);
      if (request.draft.kind === "note") {
        setYamlValue(document, "course", request.draft.course);
        setYamlValue(document, "chapter", request.draft.chapter);
      }
      setYamlValue(document, "tags", request.draft.tags);
      setYamlValue(document, "draft", request.draft.draft);
      if (request.draft.kind === "essay") {
        setYamlValue(document, "featured", request.draft.featured);
      }
      output = serializeMarkdown(document, request.draft.body, eol);
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

  async saveAsset(
    ref: EntryReference,
    requestedName: string,
    mime: string,
    contents: Buffer,
  ): Promise<{ filename: string; markdownPath: string; repoPath: string }> {
    if (ref.kind === "course") throw new StudioError("课程不能添加正文图片。", 422);
    if (contents.length === 0 || contents.length > 10 * 1024 * 1024) {
      throw new StudioError("图片大小必须在 1 字节到 10 MB 之间。", 413);
    }
    const entry = await this.locateExisting(ref);
    if (!entry) throw new StudioError("请先保存文章，再添加图片。", 422);
    if (entry.extension !== ".md") throw new StudioError("MDX 内容在 v1 中为只读。", 422);

    const filename = sanitizeAssetFilename(requestedName);
    const extension = extname(filename).toLowerCase();
    const expectedMimes = imageTypes[extension];
    if (!expectedMimes || !expectedMimes.includes(mime.toLowerCase())) {
      throw new StudioError("图片扩展名与 MIME 类型不匹配。", 415);
    }
    if (!matchesImageSignature(extension, contents)) {
      throw new StudioError("图片文件内容与扩展名不匹配。", 415);
    }

    const assetDir = resolve(dirname(entry.path), "assets", ref.id);
    const target = this.resolveWithinContent(assetDir, filename);
    await this.ensureSafeParent(target);
    await assertNoCaseInsensitiveFile(assetDir, filename);
    await this.atomicWrite(target, contents, true);

    return {
      filename,
      markdownPath: `./assets/${ref.id}/${filename}`,
      repoPath: this.repoPath(target),
    };
  }

  async resolvePreviewAsset(ref: EntryReference, source: string): Promise<string> {
    if (ref.kind === "course") throw new StudioError("资源引用无效。", 400);
    if (/^(?:[a-z]+:|\/\/|\/)/i.test(source)) throw new StudioError("不是相对资源。", 400);
    const cleanSource = source.split(/[?#]/, 1)[0];
    const existing = await this.locateExisting(ref);
    const base = existing
      ? dirname(existing.path)
      : dirname(this.pathForNewDraft({ kind: ref.kind, id: ref.id, course: ref.course } as EntryDraft));
    const candidate = this.resolveWithinContent(base, cleanSource);
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
      const parsed = await parseMarkdownFile(path);
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
        extension,
        readOnly: extension === ".mdx",
        repoPath: this.repoPath(path),
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
        readOnly: extension === ".mdx",
        repoPath: this.repoPath(path),
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

  private async atomicWrite(target: string, value: string | Buffer, createOnly: boolean): Promise<void> {
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

function sanitizeAssetFilename(value: string): string {
  const original = value.normalize("NFKC").trim();
  if (!original || original !== basename(original) || /[\\/\0-\x1f]/.test(original)) {
    throw new StudioError("图片文件名不合法。", 422);
  }
  const extension = extname(original).toLowerCase();
  const stem = basename(original, extname(original))
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const filename = `${stem}${extension}`;
  if (!stem || filename.startsWith(".") || [...filename].length > 120) {
    throw new StudioError("图片文件名不合法或过长。", 422);
  }
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

async function parseMarkdownFile(path: string): Promise<ParsedMarkdown> {
  return parseMarkdown(await readFile(path, "utf8"));
}

async function parseYamlFile(path: string): Promise<ParsedYaml> {
  return parseYaml(await readFile(path, "utf8"));
}

async function listDirectFiles(directory: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && extensions.includes(extname(entry.name).toLowerCase()))
    .map((entry) => join(directory, entry.name));
}

async function listDirectories(directory: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }));
}

async function assertNoCaseInsensitiveFile(directory: string, filename: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isFile() && entry.name.toLocaleLowerCase() === filename.toLocaleLowerCase())) {
    throw new StudioError("同名图片已经存在，请先修改文件名。", 409);
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
