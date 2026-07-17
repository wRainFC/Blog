import type {
  Catalog,
  CatalogArticle,
  CatalogCourse,
  EditorEntry,
  EntryDraft,
  EntryKind,
  EntryReference,
} from "./model";
import {
  isValidArticleId,
  isValidCourseId,
  slugifyArticleId,
  validateDraft,
} from "./model";
import type { CheckJob } from "./check-runner";

declare global {
  interface Window {
    __CONTENT_STUDIO_TOKEN__: string;
  }
}

interface CurrentState {
  exists: boolean;
  readOnly: boolean;
  ref?: EntryReference;
  revision?: string;
  repoPath?: string;
  sitePath?: string;
  draft: EntryDraft;
}

interface SaveResponse {
  ref: EntryReference;
  repoPath: string;
  sitePath: string;
  revision: string;
  checkJob: CheckJob;
  refreshWarning?: string;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
  }
}

const elements = {
  workspace: query<HTMLElement>(".studio-workspace"),
  catalogList: byId<HTMLElement>("catalog-list"),
  catalogSearch: byId<HTMLInputElement>("catalog-search"),
  welcomePanel: byId<HTMLElement>("welcome-panel"),
  welcomeStats: byId<HTMLElement>("welcome-stats"),
  editor: byId<HTMLElement>("entry-editor"),
  form: byId<HTMLFormElement>("metadata-form"),
  kindLabel: byId<HTMLElement>("entry-kind-label"),
  headingTitle: byId<HTMLElement>("entry-heading-title"),
  entryPath: byId<HTMLElement>("entry-path"),
  sitePath: byId<HTMLAnchorElement>("entry-site-path"),
  readOnlyBadge: byId<HTMLElement>("readonly-badge"),
  readOnlyNotice: byId<HTMLElement>("readonly-notice"),
  slugNotice: byId<HTMLElement>("slug-notice"),
  courseFields: byId<HTMLElement>("course-fields"),
  articleFields: byId<HTMLElement>("article-fields"),
  courseSelectField: byId<HTMLElement>("course-select-field"),
  chapterField: byId<HTMLElement>("chapter-field"),
  featuredField: byId<HTMLElement>("featured-field"),
  markdownSection: byId<HTMLElement>("markdown-section"),
  id: byId<HTMLInputElement>("field-id"),
  title: byId<HTMLInputElement>("field-title"),
  semester: byId<HTMLInputElement>("field-semester"),
  order: byId<HTMLInputElement>("field-order"),
  description: byId<HTMLTextAreaElement>("field-description"),
  summary: byId<HTMLTextAreaElement>("field-summary"),
  pubDate: byId<HTMLInputElement>("field-pub-date"),
  updated: byId<HTMLInputElement>("field-updated"),
  course: byId<HTMLSelectElement>("field-course"),
  chapter: byId<HTMLInputElement>("field-chapter"),
  tags: byId<HTMLInputElement>("field-tags"),
  tagChips: byId<HTMLElement>("tag-chips"),
  tagSuggestions: byId<HTMLDataListElement>("tag-suggestions"),
  draft: byId<HTMLInputElement>("field-draft"),
  featured: byId<HTMLInputElement>("field-featured"),
  body: byId<HTMLTextAreaElement>("field-body"),
  bodyCount: byId<HTMLElement>("body-count"),
  imageButton: byId<HTMLButtonElement>("image-button"),
  save: byId<HTMLButtonElement>("save-entry"),
  dirtyStatus: byId<HTMLElement>("dirty-status"),
  themeToggle: byId<HTMLButtonElement>("theme-toggle"),
  previewFrame: byId<HTMLIFrameElement>("preview-frame"),
  previewEmpty: byId<HTMLElement>("preview-empty"),
  previewStatus: byId<HTMLElement>("preview-status"),
  previewErrors: byId<HTMLElement>("preview-errors"),
  refreshPreview: byId<HTMLButtonElement>("refresh-preview"),
  runCheck: byId<HTMLButtonElement>("run-check"),
  checkStatus: byId<HTMLButtonElement>("check-status"),
  checkPanel: byId<HTMLDetailsElement>("check-panel"),
  checkOutput: byId<HTMLElement>("check-output"),
  assetDialog: byId<HTMLDialogElement>("asset-dialog"),
  assetFile: byId<HTMLInputElement>("asset-file"),
  assetAlt: byId<HTMLInputElement>("asset-alt"),
  uploadAsset: byId<HTMLButtonElement>("upload-asset"),
  toast: byId<HTMLElement>("toast"),
};

let catalog: Catalog = { courses: [], articles: [], tags: [] };
let current: CurrentState | undefined;
let currentTags: string[] = [];
let filter: "all" | "draft" | "published" = "all";
let dirty = false;
let slugTouched = false;
let backupTimer: number | undefined;
let previewTimer: number | undefined;
let previewSequence = 0;
let checkSequence = 0;
let toastTimer: number | undefined;
let previewCss: string | undefined;

initializeTheme();
bindEvents();
void loadCatalog();
void loadLatestCheck();

async function loadCatalog(): Promise<void> {
  try {
    catalog = await api<Catalog>("/__content-studio/api/catalog");
    renderCourseOptions();
    renderTagSuggestions();
    renderCatalog();
    renderWelcomeStats();
  } catch (error) {
    elements.catalogList.innerHTML = `<p class="sidebar-message">${escapeHtml(errorText(error))}</p>`;
    showToast(errorText(error), true);
  }
}

function renderCatalog(): void {
  const search = elements.catalogSearch.value.trim().toLocaleLowerCase();
  elements.catalogList.replaceChildren();

  const courseItems = catalog.courses.filter((item) => matchesCourse(item, search));
  const noteItems = catalog.articles.filter((item) => item.kind === "note" && matchesArticle(item, search));
  const essayItems = catalog.articles.filter((item) => item.kind === "essay" && matchesArticle(item, search));

  appendCatalogGroup("课程", courseItems, (item) => `${item.semester || "未填写学期"}`);
  appendCatalogGroup("课程笔记", noteItems, (item) => `${item.course ?? ""} · ${item.draft ? "草稿" : item.pubDate}`);
  appendCatalogGroup("随笔", essayItems, (item) => `${item.draft ? "草稿" : item.pubDate}${item.featured ? " · 精选" : ""}`);

  if (!elements.catalogList.children.length) {
    const message = document.createElement("p");
    message.className = "sidebar-message";
    message.textContent = "没有符合条件的内容。";
    elements.catalogList.append(message);
  }
}

function appendCatalogGroup<T extends CatalogCourse | CatalogArticle>(
  label: string,
  items: T[],
  meta: (item: T) => string,
): void {
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "catalog-group";
  const heading = document.createElement("div");
  heading.className = "catalog-group-title";
  heading.innerHTML = `<span>${label}</span><span>${items.length}</span>`;
  section.append(heading);

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `catalog-item${item.error ? " is-error" : ""}${isActiveItem(item) ? " is-active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = item.title || item.id;
    const detail = document.createElement("small");
    if ("draft" in item) {
      const dot = document.createElement("span");
      dot.className = `catalog-dot${item.draft ? " is-draft" : ""}`;
      detail.append(dot);
    }
    detail.append(document.createTextNode(item.error || meta(item)));
    button.append(title, detail);
    button.addEventListener("click", () => void openEntry(referenceForCatalogItem(item)));
    section.append(button);
  }
  elements.catalogList.append(section);
}

async function openEntry(ref: EntryReference): Promise<void> {
  if (!confirmSwitch()) return;
  try {
    const entry = await api<EditorEntry>(`/__content-studio/api/entry?${referenceParams(ref)}`);
    let draft = entry.draft;
    const backup = readBackup(backupKey({ exists: true, ref, draft }));
    if (backup && JSON.stringify(backup.draft) !== JSON.stringify(draft)) {
      if (window.confirm(`发现 ${formatBackupTime(backup.savedAt)} 的未保存内容，是否恢复？`)) {
        draft = backup.draft;
      }
    }
    current = {
      exists: true,
      readOnly: entry.readOnly,
      ref: entry.ref,
      revision: entry.revision,
      repoPath: entry.repoPath,
      sitePath: entry.sitePath,
      draft,
    };
    slugTouched = true;
    fillEditor();
    setDirty(JSON.stringify(draft) !== JSON.stringify(entry.draft));
    renderCatalog();
  } catch (error) {
    showToast(errorText(error), true);
  }
}

function createEntry(kind: EntryKind): void {
  if (!confirmSwitch()) return;
  if (kind === "note" && !catalog.courses.length) {
    showToast("请先创建一门课程。", true);
    kind = "course";
  }
  const today = localDate();
  const draft: EntryDraft = kind === "course"
    ? { kind, id: "", title: "", semester: "", description: undefined, order: 0 }
    : kind === "note"
      ? {
          kind,
          id: "",
          title: "",
          summary: "",
          pubDate: today,
          updated: undefined,
          tags: [],
          draft: true,
          body: "",
          course: catalog.courses[0]?.id ?? "",
          chapter: "",
        }
      : {
          kind,
          id: "",
          title: "",
          summary: "",
          pubDate: today,
          updated: undefined,
          tags: [],
          draft: true,
          body: "",
          featured: false,
        };
  current = { exists: false, readOnly: false, draft };
  const backup = readBackup(backupKey(current));
  if (backup && window.confirm(`发现 ${formatBackupTime(backup.savedAt)} 的未保存${kindLabel(kind)}，是否恢复？`)) {
    current.draft = backup.draft;
  }
  slugTouched = Boolean(current.draft.id);
  fillEditor();
  setDirty(Boolean(current.draft.id || current.draft.title || ("body" in current.draft && current.draft.body)));
  elements.title.focus();
}

function fillEditor(): void {
  if (!current) return;
  const draft = current.draft;
  currentTags = draft.kind === "course" ? [] : [...draft.tags];
  elements.welcomePanel.hidden = true;
  elements.editor.hidden = false;
  elements.kindLabel.textContent = kindLabel(draft.kind);
  elements.headingTitle.textContent = draft.title || `新建${kindLabel(draft.kind)}`;
  elements.id.value = draft.id;
  elements.title.value = draft.title;
  elements.courseFields.hidden = draft.kind !== "course";
  elements.articleFields.hidden = draft.kind === "course";
  elements.markdownSection.hidden = draft.kind === "course";
  elements.courseSelectField.hidden = draft.kind !== "note";
  elements.chapterField.hidden = draft.kind !== "note";
  elements.featuredField.hidden = draft.kind !== "essay";

  if (draft.kind === "course") {
    elements.semester.value = draft.semester;
    elements.description.value = draft.description ?? "";
    elements.order.value = String(draft.order);
  } else {
    elements.summary.value = draft.summary;
    elements.pubDate.value = draft.pubDate;
    elements.updated.value = draft.updated ?? "";
    elements.draft.checked = draft.draft;
    elements.body.value = draft.body;
    if (draft.kind === "note") {
      elements.course.value = draft.course;
      elements.chapter.value = draft.chapter;
    } else {
      elements.featured.checked = draft.featured;
    }
  }

  renderTags();
  updateBodyCount();
  updateEntryLocation();
  updateSlugNotice();
  setReadOnly(current.readOnly);
  schedulePreview(true);
}

function getDraft(): EntryDraft {
  if (!current) throw new Error("没有正在编辑的内容。");
  const kind = current.draft.kind;
  if (kind === "course") {
    return {
      kind,
      id: elements.id.value.trim(),
      title: elements.title.value.trim(),
      semester: elements.semester.value.trim(),
      description: elements.description.value.trim() || undefined,
      order: Number(elements.order.value),
    };
  }

  const common = {
    id: elements.id.value.trim(),
    title: elements.title.value.trim(),
    summary: elements.summary.value.trim(),
    pubDate: elements.pubDate.value,
    updated: elements.updated.value || undefined,
    tags: [...currentTags],
    draft: elements.draft.checked,
    body: elements.body.value,
  };
  return kind === "note"
    ? { kind, ...common, course: elements.course.value, chapter: elements.chapter.value.trim() }
    : { kind, ...common, featured: elements.featured.checked };
}

async function saveEntry(): Promise<void> {
  if (!current || current.readOnly) return;
  commitTagInput();
  const draft = getDraft();
  const errors = validateDraft(draft);
  if (errors.length) {
    showToast(errors[0], true);
    return;
  }

  elements.save.disabled = true;
  elements.save.textContent = "保存中…";
  try {
    const response = await api<SaveResponse>("/__content-studio/api/entry", {
      method: "PUT",
      body: JSON.stringify({
        mode: current.exists ? "update" : "create",
        draft,
        ref: current.ref,
        expectedRevision: current.revision,
      }),
    });
    clearBackup(backupKey(current));
    current = {
      exists: true,
      readOnly: false,
      ref: response.ref,
      revision: response.revision,
      repoPath: response.repoPath,
      sitePath: response.sitePath,
      draft,
    };
    slugTouched = true;
    setDirty(false);
    updateEntryLocation();
    setReadOnly(false);
    showToast(response.refreshWarning ? `已保存，但内容热刷新失败：${response.refreshWarning}` : `已保存到 ${response.repoPath}`, Boolean(response.refreshWarning));
    void watchCheck(response.checkJob);
    await loadCatalog();
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && current.exists) {
      const reload = window.confirm(`${error.message}\n\n确定：重新加载磁盘版本\n取消：保留当前编辑，并将正文复制到剪贴板`);
      if (reload && current.ref) void openEntry(current.ref);
      else {
        const contents = "body" in current.draft ? getDraft() as Extract<EntryDraft, { body: string }> : undefined;
        if (contents) void navigator.clipboard.writeText(contents.body).catch(() => undefined);
        showToast("当前正文已保留，并尝试复制到剪贴板。", true);
      }
    } else {
      showToast(errorText(error), true);
    }
  } finally {
    elements.save.textContent = "保存";
    elements.save.disabled = !current || current.readOnly || !dirty;
  }
}

function markDirty(): void {
  if (!current || current.readOnly) return;
  current.draft = getDraft();
  setDirty(true);
  updateEntryLocation();
  updateSlugNotice();
  scheduleBackup();
  schedulePreview();
}

function setDirty(value: boolean): void {
  dirty = value;
  elements.dirtyStatus.textContent = value ? "有未保存修改" : "已保存";
  elements.dirtyStatus.classList.toggle("is-dirty", value);
  elements.dirtyStatus.classList.toggle("is-clean", !value);
  elements.save.disabled = !current || current.readOnly || !value;
}

function setReadOnly(value: boolean): void {
  elements.readOnlyBadge.hidden = !value;
  elements.readOnlyNotice.hidden = !value;
  const inputs = elements.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  for (const input of inputs) input.disabled = value;
  elements.id.disabled = value || Boolean(current?.exists);
  elements.course.disabled = value || Boolean(current?.exists && current.draft.kind === "note");
  elements.body.readOnly = value;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-markdown]")) button.disabled = value;
  elements.imageButton.disabled = value || !current?.exists || current.draft.kind === "course";
  elements.save.disabled = value || !dirty;
}

function updateEntryLocation(): void {
  if (!current) return;
  const draft = getDraft();
  elements.headingTitle.textContent = draft.title || `新建${kindLabel(draft.kind)}`;
  if (current.repoPath) {
    elements.entryPath.textContent = current.repoPath;
  } else if (draft.id) {
    elements.entryPath.textContent = predictedRepoPath(draft);
  } else {
    elements.entryPath.textContent = "填写内容 ID 后显示保存路径";
  }
  const sitePath = current.sitePath || predictedSitePath(draft);
  elements.sitePath.hidden = !sitePath;
  elements.sitePath.textContent = sitePath || "";
  elements.sitePath.href = sitePath || "#";
  elements.sitePath.target = "_blank";
  elements.sitePath.rel = "noreferrer";
}

function updateSlugNotice(): void {
  const kind = current?.draft.kind;
  elements.slugNotice.hidden = kind === "course" || !elements.id.value || /^[a-z0-9-]+$/.test(elements.id.value);
}

function renderCourseOptions(): void {
  const selected = elements.course.value;
  elements.course.replaceChildren();
  for (const course of catalog.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = `${course.title} · ${course.id}`;
    elements.course.append(option);
  }
  if ([...elements.course.options].some((option) => option.value === selected)) {
    elements.course.value = selected;
  }
}

function renderTagSuggestions(): void {
  elements.tagSuggestions.replaceChildren();
  for (const tag of catalog.tags) {
    const option = document.createElement("option");
    option.value = tag;
    elements.tagSuggestions.append(option);
  }
}

function renderTags(): void {
  elements.tagChips.replaceChildren();
  for (const tag of currentTags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.append(document.createTextNode(tag));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `移除标签 ${tag}`);
    remove.textContent = "×";
    remove.disabled = Boolean(current?.readOnly);
    remove.addEventListener("click", () => {
      currentTags = currentTags.filter((item) => item !== tag);
      renderTags();
      markDirty();
    });
    chip.append(remove);
    elements.tagChips.append(chip);
  }
}

function commitTagInput(): void {
  const values = elements.tags.value.split(/[,，\n]+/).map((tag) => tag.trim()).filter(Boolean);
  if (!values.length) return;
  currentTags = [...new Set([...currentTags, ...values])];
  elements.tags.value = "";
  renderTags();
  markDirty();
}

function schedulePreview(immediate = false): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void renderPreview(), immediate ? 0 : 380);
}

async function renderPreview(): Promise<void> {
  if (!current) {
    elements.previewEmpty.hidden = false;
    elements.previewFrame.hidden = true;
    return;
  }
  const draft = getDraft();
  const sequence = ++previewSequence;
  elements.previewStatus.textContent = "渲染中…";
  elements.previewErrors.hidden = true;

  if (draft.kind === "course") {
    const html = `<section class="course-preview"><p class="preview-eyebrow">课程</p><h1>${escapeHtml(draft.title || "未命名课程")}</h1><p>${escapeHtml(draft.semester)}</p><div>${escapeHtml(draft.description || "尚未填写课程简介。")}</div></section>`;
    showPreviewDocument(html, draft);
    elements.previewStatus.textContent = "课程预览";
    return;
  }

  const ref = validPreviewReference(draft);
  try {
    const result = await api<{ html: string; diagnostics: string[] }>("/__content-studio/api/preview", {
      method: "POST",
      body: JSON.stringify({ body: draft.body, ref }),
    });
    if (sequence !== previewSequence) return;
    if (result.diagnostics.length) {
      elements.previewErrors.textContent = result.diagnostics.join("\n");
      elements.previewErrors.hidden = false;
      elements.previewStatus.textContent = "预览有错误";
    } else {
      elements.previewStatus.textContent = "已同步";
    }
    const header = `<header class="preview-article-header"><p class="preview-eyebrow">${draft.kind === "note" ? escapeHtml(`${draft.course} · ${draft.chapter}`) : "随笔"}</p><h1>${escapeHtml(draft.title || "未命名文章")}</h1><p>${escapeHtml(draft.summary)}</p><small>${escapeHtml(draft.pubDate)}${draft.draft ? " · 草稿" : ""}</small></header>`;
    showPreviewDocument(`${header}<article class="prose">${result.html}</article>`, draft);
  } catch (error) {
    if (sequence !== previewSequence) return;
    elements.previewStatus.textContent = "预览失败";
    elements.previewErrors.textContent = errorText(error);
    elements.previewErrors.hidden = false;
  }
}

function showPreviewDocument(contents: string, draft: EntryDraft): void {
  elements.previewEmpty.hidden = true;
  elements.previewFrame.hidden = false;
  const theme = document.documentElement.dataset.theme ?? "light";
  previewCss ??= collectPageCss();
  elements.previewFrame.srcdoc = `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><style>${previewCss}\nhtml,body{margin:0;min-height:100%;background:var(--paper);color:var(--ink)}body{padding:clamp(28px,6vw,64px);font-family:var(--sans)}.preview-article-header{max-width:720px;margin:0 auto 46px;padding-bottom:28px;border-bottom:1px solid var(--line)}.preview-article-header h1,.course-preview h1{margin:10px 0 14px;font:500 clamp(30px,5vw,48px)/1.3 var(--serif);letter-spacing:-.035em}.preview-article-header>p:not(.preview-eyebrow){color:var(--ink-soft);font:16px/1.8 var(--serif)}.preview-article-header small{color:var(--ink-faint);font-size:10px}.preview-eyebrow{color:var(--vermilion);font-size:10px;letter-spacing:.15em}.prose{max-width:720px;margin:0 auto}.course-preview{max-width:680px;margin:12vh auto}.course-preview>p{color:var(--ink-faint)}.course-preview>div{margin-top:28px;padding-top:22px;border-top:1px solid var(--line);font:17px/1.9 var(--serif)}</style></head><body class="document-theme">${contents}</body></html>`;
  void draft;
}

function collectPageCss(): string {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      rules.push([...sheet.cssRules].map((rule) => rule.cssText).join("\n"));
    } catch {
      // All Studio styles are local; an inaccessible optional sheet can be skipped.
    }
  }
  return rules.join("\n").replaceAll("</style", "<\\/style");
}

function insertMarkdown(action: string): void {
  if (!current || current.readOnly || current.draft.kind === "course") return;
  if (action === "image") {
    if (!current.exists) return showToast("请先保存文章，再上传图片。", true);
    elements.assetFile.value = "";
    elements.assetAlt.value = "";
    elements.assetDialog.showModal();
    return;
  }
  const textarea = elements.body;
  const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  const snippets: Record<string, [string, string, string]> = {
    heading: ["## ", "", "小标题"],
    bold: ["**", "**", "重点文字"],
    italic: ["_", "_", "强调文字"],
    link: ["[", "](https://example.com)", "链接文字"],
    quote: ["> ", "", "引用内容"],
    list: ["- ", "", "列表项"],
    code: ["```ts title=\"example.ts\"\n", "\n```", "const answer = 42;"],
    math: ["$$\n", "\n$$", "E = mc^2"],
    callout: ["> [!NOTE]\n> ", "", "提示内容"],
  };
  const [before, after, fallback] = snippets[action] ?? ["", "", ""];
  replaceSelection(before, selected || fallback, after);
}

function replaceSelection(before: string, contents: string, after: string): void {
  const textarea = elements.body;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.setRangeText(`${before}${contents}${after}`, start, end, "end");
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function uploadAsset(file: File, alt: string): Promise<void> {
  if (!current?.exists || !current.ref) throw new Error("请先保存文章。");
  const params = referenceParams(current.ref);
  params.set("filename", file.name);
  const mime = file.type || mimeForFilename(file.name);
  const result = await api<{ markdownPath: string; repoPath: string }>(`/__content-studio/api/asset?${params}`, {
    method: "POST",
    headers: { "Content-Type": mime },
    body: file,
  });
  replaceSelection("![", alt || file.name.replace(/\.[^.]+$/, ""), `](${result.markdownPath})`);
  showToast(`图片已保存到 ${result.repoPath}`);
}

async function runCheck(): Promise<void> {
  elements.runCheck.disabled = true;
  try {
    const job = await api<CheckJob>("/__content-studio/api/check", { method: "POST" });
    void watchCheck(job);
  } catch (error) {
    showToast(errorText(error), true);
  } finally {
    elements.runCheck.disabled = false;
  }
}

async function watchCheck(initial: CheckJob): Promise<void> {
  const sequence = ++checkSequence;
  let job = initial;
  while (sequence === checkSequence) {
    renderCheck(job);
    if (job.status === "passed" || job.status === "failed") break;
    await delay(1000);
    try {
      job = await api<CheckJob>(`/__content-studio/api/check?id=${encodeURIComponent(job.id)}`);
    } catch (error) {
      showToast(errorText(error), true);
      break;
    }
  }
}

function renderCheck(job: CheckJob): void {
  const labels: Record<CheckJob["status"], string> = {
    queued: "检查排队中",
    running: "正在检查",
    passed: "检查通过",
    failed: "检查失败",
  };
  elements.checkStatus.textContent = labels[job.status];
  elements.checkStatus.dataset.status = job.status;
  elements.checkOutput.textContent = job.output;
  if (job.status === "failed") elements.checkPanel.open = true;
}

async function loadLatestCheck(): Promise<void> {
  try {
    const job = await api<CheckJob>("/__content-studio/api/check");
    void watchCheck(job);
  } catch {
    // No check has run in this process yet.
  }
}

function scheduleBackup(): void {
  window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    if (!current || !dirty) return;
    localStorage.setItem(backupKey(current), JSON.stringify({ savedAt: new Date().toISOString(), draft: getDraft() }));
  }, 1000);
}

function readBackup(key: string): { savedAt: string; draft: EntryDraft } | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as { savedAt?: unknown; draft?: unknown } | null;
    if (value && typeof value.savedAt === "string" && value.draft && typeof value.draft === "object") {
      return value as { savedAt: string; draft: EntryDraft };
    }
  } catch {
    localStorage.removeItem(key);
  }
  return undefined;
}

function clearBackup(key: string): void {
  localStorage.removeItem(key);
}

function backupKey(state: Pick<CurrentState, "exists" | "ref" | "draft">): string {
  if (!state.exists || !state.ref) return `yanbian-studio:draft:new:${state.draft.kind}`;
  return `yanbian-studio:draft:${state.ref.kind}:${state.ref.course ?? ""}:${state.ref.id}`;
}

function bindEvents(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-create]")) {
    button.addEventListener("click", () => createEntry(button.dataset.create as EntryKind));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
    button.addEventListener("click", () => {
      filter = button.dataset.filter as typeof filter;
      document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button));
      renderCatalog();
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-markdown]")) {
    button.addEventListener("click", () => insertMarkdown(button.dataset.markdown ?? ""));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mobile-pane]")) {
    button.addEventListener("click", () => {
      elements.workspace.dataset.mobileView = button.dataset.mobilePane;
      document.querySelectorAll("[data-mobile-pane]").forEach((item) => item.classList.toggle("is-active", item === button));
      if (button.dataset.mobilePane === "preview") schedulePreview(true);
    });
  }

  elements.catalogSearch.addEventListener("input", renderCatalog);
  elements.save.addEventListener("click", () => void saveEntry());
  elements.runCheck.addEventListener("click", () => void runCheck());
  elements.checkStatus.addEventListener("click", () => { elements.checkPanel.open = true; });
  elements.refreshPreview.addEventListener("click", () => schedulePreview(true));
  elements.themeToggle.addEventListener("click", toggleTheme);

  elements.id.addEventListener("input", () => { slugTouched = true; });
  elements.title.addEventListener("input", () => {
    if (current && !current.exists && !slugTouched) {
      const suggestion = slugifyArticleId(elements.title.value);
      elements.id.value = current.draft.kind === "course" && !isValidCourseId(suggestion) ? "" : suggestion;
    }
  });
  elements.form.addEventListener("input", markDirty);
  elements.form.addEventListener("change", markDirty);
  elements.body.addEventListener("input", () => {
    updateBodyCount();
    markDirty();
  });
  elements.body.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      replaceSelection("", "  ", "");
    }
  });
  elements.body.addEventListener("dragover", (event) => {
    if (current?.exists && !current.readOnly) event.preventDefault();
  });
  elements.body.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    if (!file || !current?.exists || current.readOnly) return;
    event.preventDefault();
    const alt = window.prompt("请输入图片的替代文字：", file.name.replace(/\.[^.]+$/, "")) ?? "";
    void uploadAsset(file, alt).catch((error) => showToast(errorText(error), true));
  });

  elements.tags.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      commitTagInput();
    }
  });
  elements.tags.addEventListener("blur", commitTagInput);

  elements.assetDialog.querySelector("form")?.addEventListener("submit", (event) => {
    if ((event as SubmitEvent).submitter !== elements.uploadAsset) return;
    event.preventDefault();
    const file = elements.assetFile.files?.[0];
    if (!file) return showToast("请选择图片文件。", true);
    elements.uploadAsset.disabled = true;
    elements.uploadAsset.textContent = "上传中…";
    void uploadAsset(file, elements.assetAlt.value.trim())
      .then(() => elements.assetDialog.close())
      .catch((error) => showToast(errorText(error), true))
      .finally(() => {
        elements.uploadAsset.disabled = false;
        elements.uploadAsset.textContent = "上传并插入";
      });
  });

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
  });
}

function initializeTheme(): void {
  const saved = localStorage.getItem("wrain-theme");
  const theme = saved === "dark" || saved === "light"
    ? saved
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
}

function toggleTheme(): void {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("wrain-theme", next);
  schedulePreview(true);
}

function renderWelcomeStats(): void {
  const drafts = catalog.articles.filter((article) => article.draft).length;
  elements.welcomeStats.innerHTML = [
    [catalog.courses.length, "门课程"],
    [catalog.articles.length, "篇文章"],
    [drafts, "篇草稿"],
  ].map(([value, label]) => `<div class="welcome-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function updateBodyCount(): void {
  const body = elements.body.value.trim();
  const count = body ? [...body.replace(/\s/g, "")].length : 0;
  elements.bodyCount.textContent = `${count} 字`;
}

function confirmSwitch(): boolean {
  return !dirty || window.confirm("当前内容尚未保存。切换后仍可从本地草稿恢复，确定继续吗？");
}

function matchesCourse(item: CatalogCourse, search: string): boolean {
  return !search || `${item.title} ${item.id} ${item.semester}`.toLocaleLowerCase().includes(search);
}

function matchesArticle(item: CatalogArticle, search: string): boolean {
  if (filter === "draft" && !item.draft) return false;
  if (filter === "published" && item.draft) return false;
  return !search || `${item.title} ${item.id} ${item.course ?? ""} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(search);
}

function isActiveItem(item: CatalogCourse | CatalogArticle): boolean {
  if (!current?.exists || !current.ref) return false;
  return current.ref.kind === item.kind && current.ref.id === item.id && current.ref.course === ("course" in item ? item.course : undefined);
}

function referenceForCatalogItem(item: CatalogCourse | CatalogArticle): EntryReference {
  return item.kind === "note"
    ? { kind: "note", id: item.id, course: item.course }
    : { kind: item.kind, id: item.id };
}

function validPreviewReference(draft: Exclude<EntryDraft, { kind: "course" }>): EntryReference | undefined {
  if (!isValidArticleId(draft.id)) return undefined;
  if (draft.kind === "note") {
    if (!isValidCourseId(draft.course)) return undefined;
    return { kind: "note", id: draft.id, course: draft.course };
  }
  return { kind: "essay", id: draft.id };
}

function predictedRepoPath(draft: EntryDraft): string {
  if (draft.kind === "course") return `src/content/courses/${draft.id}.yaml`;
  if (draft.kind === "note") return `src/content/notes/${draft.course}/${draft.id}.md`;
  return `src/content/essays/${draft.id}.md`;
}

function predictedSitePath(draft: EntryDraft): string {
  if (!draft.id) return "";
  if (draft.kind === "course") return `/learn/${encodeURIComponent(draft.id)}/`;
  if (draft.kind === "note") return `/learn/${encodeURIComponent(draft.course)}/${draft.id}/`;
  return `/writing/${draft.id}/`;
}

function kindLabel(kind: EntryKind): string {
  return kind === "course" ? "课程" : kind === "note" ? "课程笔记" : "随笔";
}

function referenceParams(ref: EntryReference): URLSearchParams {
  const params = new URLSearchParams({ kind: ref.kind, id: ref.id });
  if (ref.course) params.set("course", ref.course);
  return params;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Content-Studio-Token", window.__CONTENT_STUDIO_TOKEN__);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({ error: `请求失败：${response.status}` })) as { error?: string; details?: unknown };
  if (!response.ok) throw new ApiError(payload.error ?? `请求失败：${response.status}`, response.status, payload.details);
  return payload as T;
}

function showToast(message: string, error = false): void {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", error);
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3600);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function localDate(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function formatBackupTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "较早" : date.toLocaleString("zh-CN");
}

function mimeForFilename(name: string): string {
  const extension = name.toLocaleLowerCase().split(".").pop();
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    svg: "image/svg+xml",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少界面元素 #${id}`);
  return element as T;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`缺少界面元素 ${selector}`);
  return element as T;
}
