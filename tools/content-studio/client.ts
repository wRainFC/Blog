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
import type { DeployJob } from "./deploy-runner";

declare global {
  interface Window { __CONTENT_STUDIO_TOKEN__: string; }
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
  checkJob?: CheckJob;
  refreshWarning?: string;
}

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) { super(message); }
}

const elements = {
  catalogList: byId<HTMLElement>("catalog-list"),
  catalogSearch: byId<HTMLInputElement>("catalog-search"),
  welcomePanel: byId<HTMLElement>("welcome-panel"),
  welcomeStats: byId<HTMLElement>("welcome-stats"),
  editor: byId<HTMLElement>("entry-editor"),
  form: byId<HTMLFormElement>("metadata-form"),
  kindLabel: byId<HTMLElement>("entry-kind-label"),
  entryPath: byId<HTMLElement>("entry-path"),
  sitePath: byId<HTMLAnchorElement>("entry-site-path"),
  readOnlyBadge: byId<HTMLElement>("readonly-badge"),
  readOnlyNotice: byId<HTMLElement>("readonly-notice"),
  slugNotice: byId<HTMLElement>("slug-notice"),
  courseFields: byId<HTMLElement>("course-fields"),
  articleFields: byId<HTMLElement>("article-fields"),
  noteContext: byId<HTMLElement>("note-context"),
  courseSelectField: byId<HTMLElement>("course-select-field"),
  chapterField: byId<HTMLElement>("chapter-field"),
  featuredField: byId<HTMLElement>("featured-field"),
  courseId: byId<HTMLInputElement>("field-id"),
  articleId: byId<HTMLInputElement>("field-article-id"),
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
  tagSuggestions: byId<HTMLDataListElement>("tag-suggestions"),
  draft: byId<HTMLInputElement>("field-draft"),
  featured: byId<HTMLInputElement>("field-featured"),
  body: byId<HTMLTextAreaElement>("field-body"),
  bodyCount: byId<HTMLElement>("body-count"),
  imageButton: byId<HTMLButtonElement>("image-button"),
  previewView: byId<HTMLElement>("preview-view"),
  previewFrame: byId<HTMLIFrameElement>("preview-frame"),
  previewEmpty: byId<HTMLElement>("preview-empty"),
  previewErrors: byId<HTMLElement>("preview-errors"),
  save: byId<HTMLButtonElement>("save-entry"),
  publish: byId<HTMLButtonElement>("publish-entry"),
  dirtyStatus: byId<HTMLElement>("dirty-status"),
  activityStatus: byId<HTMLButtonElement>("activity-status"),
  activityPanel: byId<HTMLDetailsElement>("activity-panel"),
  activityOutput: byId<HTMLElement>("activity-output"),
  assetDialog: byId<HTMLDialogElement>("asset-dialog"),
  assetFile: byId<HTMLInputElement>("asset-file"),
  assetAlt: byId<HTMLInputElement>("asset-alt"),
  uploadAsset: byId<HTMLButtonElement>("upload-asset"),
  toast: byId<HTMLElement>("toast"),
};

let catalog: Catalog = { courses: [], articles: [], tags: [] };
let current: CurrentState | undefined;
let dirty = false;
let busy = false;
let slugTouched = false;
let composerPane: "write" | "preview" = "write";
let backupTimer: number | undefined;
let previewTimer: number | undefined;
let previewSequence = 0;
let activitySequence = 0;
let toastTimer: number | undefined;
let previewCss: string | undefined;

initializeTheme();
bindEvents();
void loadCatalog();
void loadLatestActivity();

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
  const articles = catalog.articles.filter((item) => matchesArticle(item, search));
  appendCatalogGroup("草稿", articles.filter((item) => item.draft));
  appendCatalogGroup("已发布", articles.filter((item) => !item.draft));
  appendCourseGroup(catalog.courses.filter((item) => matchesCourse(item, search)));
  if (!elements.catalogList.children.length) {
    const message = document.createElement("p");
    message.className = "sidebar-message";
    message.textContent = "没有符合条件的内容。";
    elements.catalogList.append(message);
  }
}

function appendCatalogGroup(label: string, items: CatalogArticle[]): void {
  if (!items.length) return;
  const section = catalogSection(label, items.length);
  for (const item of items) {
    const meta = item.kind === "note"
      ? `${courseTitle(item.course)} · ${item.chapter || "未分类"}`
      : `随笔 · ${item.pubDate}`;
    section.append(catalogButton(item, meta));
  }
  elements.catalogList.append(section);
}

function appendCourseGroup(items: CatalogCourse[]): void {
  if (!items.length) return;
  const section = catalogSection("课程设置", items.length);
  for (const item of items) section.append(catalogButton(item, item.semester || "未填写学期"));
  elements.catalogList.append(section);
}

function catalogSection(label: string, count: number): HTMLElement {
  const section = document.createElement("section");
  section.className = "catalog-group";
  section.innerHTML = `<div class="catalog-group-title"><span>${escapeHtml(label)}</span><span>${count}</span></div>`;
  return section;
}

function catalogButton(item: CatalogCourse | CatalogArticle, meta: string): HTMLButtonElement {
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
  detail.append(document.createTextNode(item.error || meta));
  button.append(title, detail);
  button.addEventListener("click", () => void openEntry(referenceForCatalogItem(item)));
  return button;
}

async function openEntry(ref: EntryReference): Promise<void> {
  if (!confirmSwitch()) return;
  try {
    const entry = await api<EditorEntry>(`/__content-studio/api/entry?${referenceParams(ref)}`);
    let draft = entry.draft;
    const backup = readBackup(backupKey({ exists: true, ref, draft }));
    if (backup && JSON.stringify(backup.draft) !== JSON.stringify(draft)
      && window.confirm(`发现 ${formatBackupTime(backup.savedAt)} 的未保存内容，是否恢复？`)) {
      draft = backup.draft;
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
    showToast("请先添加一门课程。", true);
    kind = "course";
  }
  const today = localDate();
  const draft: EntryDraft = kind === "course"
    ? { kind, id: "", title: "", semester: "", description: undefined, order: 0 }
    : kind === "note"
      ? {
          kind, id: "", title: "", summary: "", pubDate: today, updated: undefined,
          tags: [], draft: true, body: "", course: catalog.courses[0]?.id ?? "", chapter: "未分类",
        }
      : {
          kind, id: "", title: "", summary: "", pubDate: today, updated: undefined,
          tags: [], draft: true, body: "", featured: false,
        };
  current = { exists: false, readOnly: false, draft };
  const backup = readBackup(backupKey(current));
  if (backup && window.confirm(`发现 ${formatBackupTime(backup.savedAt)} 的未保存${kindLabel(kind)}，是否恢复？`)) {
    current.draft = backup.draft;
  }
  slugTouched = Boolean(current.draft.id);
  composerPane = "write";
  fillEditor();
  setDirty(Boolean(current.draft.id || current.draft.title || ("body" in current.draft && current.draft.body)));
  elements.title.focus();
}

function fillEditor(): void {
  if (!current) return;
  const draft = current.draft;
  elements.welcomePanel.hidden = true;
  elements.editor.hidden = false;
  elements.kindLabel.textContent = kindLabel(draft.kind);
  elements.title.value = draft.title;
  elements.courseFields.hidden = draft.kind !== "course";
  elements.articleFields.hidden = draft.kind === "course";
  elements.noteContext.hidden = draft.kind !== "note";
  elements.courseSelectField.hidden = draft.kind !== "note";
  elements.chapterField.hidden = draft.kind !== "note";
  elements.featuredField.hidden = draft.kind !== "essay";

  if (draft.kind === "course") {
    elements.courseId.value = draft.id;
    elements.semester.value = draft.semester;
    elements.description.value = draft.description ?? "";
    elements.order.value = String(draft.order);
  } else {
    elements.articleId.value = draft.id;
    elements.summary.value = draft.summary;
    elements.pubDate.value = draft.pubDate;
    elements.updated.value = draft.updated ?? "";
    elements.tags.value = draft.tags.join(", ");
    elements.draft.checked = draft.draft;
    elements.body.value = draft.body;
    if (draft.kind === "note") {
      elements.course.value = draft.course;
      elements.chapter.value = draft.chapter;
    } else {
      elements.featured.checked = draft.featured;
    }
  }

  updateBodyCount();
  updateEntryLocation();
  updateSlugNotice();
  setComposerPane(composerPane);
  setReadOnly(current.readOnly);
  updateActionLabels();
  schedulePreview(true);
}

function getDraft(publishing = false): EntryDraft {
  if (!current) throw new Error("没有正在编辑的内容。");
  const kind = current.draft.kind;
  if (kind === "course") {
    return {
      kind,
      id: elements.courseId.value.trim(),
      title: elements.title.value.trim(),
      semester: elements.semester.value.trim(),
      description: elements.description.value.trim() || undefined,
      order: Number(elements.order.value),
    };
  }
  const body = elements.body.value;
  const common = {
    id: elements.articleId.value.trim(),
    title: elements.title.value.trim(),
    summary: elements.summary.value.trim() || autoSummary(body),
    pubDate: elements.pubDate.value || localDate(),
    updated: elements.updated.value || undefined,
    tags: parseTags(elements.tags.value),
    draft: publishing ? false : elements.draft.checked,
    body,
  };
  return kind === "note"
    ? { kind, ...common, course: elements.course.value, chapter: elements.chapter.value.trim() || "未分类" }
    : { kind, ...common, featured: elements.featured.checked };
}

async function saveEntry(publishing = false): Promise<SaveResponse | undefined> {
  if (!current || current.readOnly || busy) return;
  const draft = getDraft(publishing);
  const errors = validateDraft(draft);
  if (errors.length) {
    showToast(errors[0], true);
    revealSettingsForError(errors[0]);
    return;
  }

  setBusy(true, publishing ? "准备发布…" : "保存中…");
  try {
    const response = await api<SaveResponse>("/__content-studio/api/entry", {
      method: "PUT",
      body: JSON.stringify({
        mode: current.exists ? "update" : "create",
        draft,
        ref: current.ref,
        expectedRevision: current.revision,
        runCheck: !publishing,
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
    elements.summary.value = draft.kind === "course" ? "" : draft.summary;
    if (draft.kind === "note") elements.chapter.value = draft.chapter;
    if (draft.kind !== "course") elements.draft.checked = draft.draft;
    slugTouched = true;
    setDirty(false);
    updateEntryLocation();
    updateActionLabels();
    showToast(response.refreshWarning ? `已保存，但页面刷新失败：${response.refreshWarning}` : `已保存到 ${response.repoPath}`, Boolean(response.refreshWarning));
    if (response.checkJob) void watchCheck(response.checkJob);
    await loadCatalog();
    return response;
  } catch (error) {
    handleSaveError(error);
  } finally {
    setBusy(false);
  }
}

async function publishEntry(): Promise<void> {
  const saved = await saveEntry(true);
  if (!saved || !current?.ref || !current.revision) return;
  setBusy(true, "正在发布…");
  try {
    const job = await api<DeployJob>("/__content-studio/api/deploy", {
      method: "POST",
      body: JSON.stringify({ ref: current.ref, expectedRevision: current.revision }),
    });
    void watchDeploy(job);
  } catch (error) {
    showToast(errorText(error), true);
    setActivity("发布未启动", "failed", errorText(error));
    setBusy(false);
  }
}

function handleSaveError(error: unknown): void {
  if (error instanceof ApiError && error.status === 409 && current?.exists) {
    const reload = window.confirm(`${error.message}\n\n确定：重新加载磁盘版本\n取消：保留当前 Markdown，并复制到剪贴板`);
    if (reload && current.ref) void openEntry(current.ref);
    else {
      if (current.draft.kind !== "course") void navigator.clipboard.writeText(elements.body.value).catch(() => undefined);
      showToast("当前 Markdown 已保留，并尝试复制到剪贴板。", true);
    }
  } else {
    showToast(errorText(error), true);
  }
}

function markDirty(): void {
  if (!current || current.readOnly || busy) return;
  current.draft = getDraft();
  setDirty(true);
  updateEntryLocation();
  updateSlugNotice();
  updateActionLabels();
  scheduleBackup();
  schedulePreview();
}

function setDirty(value: boolean): void {
  dirty = value;
  elements.dirtyStatus.textContent = value ? "有未保存修改" : "已保存";
  elements.dirtyStatus.classList.toggle("is-dirty", value);
  elements.dirtyStatus.classList.toggle("is-clean", !value);
  updateButtons();
}

function setBusy(value: boolean, label?: string): void {
  busy = value;
  if (label) setActivity(label, "running");
  updateButtons();
  if (!value) updateActionLabels();
}

function updateButtons(): void {
  const editable = Boolean(current && !current.readOnly && !busy);
  elements.save.disabled = !editable || !dirty;
  elements.publish.disabled = !editable;
}

function updateActionLabels(): void {
  if (!current || busy) return;
  const isPublished = current.draft.kind !== "course" && !current.draft.draft;
  elements.save.textContent = isPublished ? "保存修改" : "保存草稿";
  elements.publish.textContent = current.draft.kind === "course" ? "保存并发布" : "发布到网站";
  updateButtons();
}

function setReadOnly(value: boolean): void {
  elements.readOnlyBadge.hidden = !value;
  elements.readOnlyNotice.hidden = !value;
  for (const input of elements.form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) input.disabled = value;
  elements.courseId.disabled = value || Boolean(current?.exists);
  elements.articleId.disabled = value || Boolean(current?.exists);
  elements.course.disabled = value || Boolean(current?.exists && current.draft.kind === "note");
  elements.body.readOnly = value;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-markdown]")) button.disabled = value;
  elements.imageButton.disabled = value || !current?.exists || current.draft.kind === "course";
  updateButtons();
}

function updateEntryLocation(): void {
  if (!current) return;
  const draft = getDraft();
  elements.entryPath.textContent = current.repoPath || (draft.id ? predictedRepoPath(draft) : "标题会自动生成文件名");
  const path = current.sitePath || predictedSitePath(draft);
  elements.sitePath.hidden = !path;
  elements.sitePath.textContent = path || "";
  elements.sitePath.href = path || "#";
  elements.sitePath.target = "_blank";
  elements.sitePath.rel = "noreferrer";
}

function updateSlugNotice(): void {
  const value = current?.draft.kind === "course" ? elements.courseId.value : elements.articleId.value;
  elements.slugNotice.hidden = current?.draft.kind === "course" || !value || /^[a-z0-9-]+$/.test(value);
}

function renderCourseOptions(): void {
  const selected = elements.course.value;
  elements.course.replaceChildren();
  for (const course of catalog.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.title;
    elements.course.append(option);
  }
  if ([...elements.course.options].some((option) => option.value === selected)) elements.course.value = selected;
}

function renderTagSuggestions(): void {
  elements.tagSuggestions.replaceChildren();
  for (const tag of catalog.tags) {
    const option = document.createElement("option");
    option.value = tag;
    elements.tagSuggestions.append(option);
  }
}

function setComposerPane(value: "write" | "preview"): void {
  composerPane = value;
  elements.body.hidden = value !== "write";
  elements.previewView.hidden = value !== "preview";
  document.querySelectorAll<HTMLElement>("[data-composer-pane]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.composerPane === value);
  });
  if (value === "preview") schedulePreview(true);
}

function schedulePreview(immediate = false): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    if (composerPane === "preview") void renderPreview();
  }, immediate ? 0 : 350);
}

async function renderPreview(): Promise<void> {
  if (!current || current.draft.kind === "course") return;
  const draft = getDraft();
  if (draft.kind === "course") return;
  const sequence = ++previewSequence;
  const ref = validPreviewReference(draft);
  try {
    const result = await api<{ html: string; diagnostics: string[] }>("/__content-studio/api/preview", {
      method: "POST",
      body: JSON.stringify({ body: draft.body, ref }),
    });
    if (sequence !== previewSequence) return;
    elements.previewErrors.hidden = !result.diagnostics.length;
    elements.previewErrors.textContent = result.diagnostics.join("\n");
    showPreviewDocument(result.html);
  } catch (error) {
    if (sequence !== previewSequence) return;
    elements.previewErrors.textContent = errorText(error);
    elements.previewErrors.hidden = false;
  }
}

function showPreviewDocument(contents: string): void {
  elements.previewEmpty.hidden = true;
  elements.previewFrame.hidden = false;
  const theme = document.documentElement.dataset.theme ?? "light";
  previewCss ??= collectPageCss();
  elements.previewFrame.srcdoc = `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src * data: blob:; font-src * data:; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><style>${previewCss}\nhtml,body{margin:0;min-height:100%;background:var(--paper);color:var(--ink)}body{padding:clamp(28px,6vw,64px);font-family:var(--sans)}.prose{max-width:720px;margin:0 auto}</style></head><body class="document-theme"><article class="prose">${contents}</article></body></html>`;
}

function collectPageCss(): string {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    try { rules.push([...sheet.cssRules].map((rule) => rule.cssText).join("\n")); } catch { /* local optional CSS */ }
  }
  return rules.join("\n").replaceAll("</style", "<\\/style");
}

function insertMarkdown(action: string): void {
  if (!current || current.readOnly || current.draft.kind === "course") return;
  if (action === "image") {
    if (!current.exists) return showToast("请先保存一次草稿，再添加图片。", true);
    elements.assetFile.value = "";
    elements.assetAlt.value = "";
    elements.assetDialog.showModal();
    return;
  }
  const selected = elements.body.value.slice(elements.body.selectionStart, elements.body.selectionEnd);
  const snippets: Record<string, [string, string, string]> = {
    heading: ["## ", "", "小标题"],
    bold: ["**", "**", "重点文字"],
    link: ["[", "](https://example.com)", "链接文字"],
    quote: ["> ", "", "引用内容"],
    code: ["```ts\n", "\n```", "const answer = 42;"],
    math: ["$$\n", "\n$$", "E = mc^2"],
  };
  const [before, after, fallback] = snippets[action] ?? ["", "", ""];
  replaceSelection(before, selected || fallback, after);
}

function replaceSelection(before: string, contents: string, after: string): void {
  const start = elements.body.selectionStart;
  const end = elements.body.selectionEnd;
  elements.body.setRangeText(`${before}${contents}${after}`, start, end, "end");
  elements.body.focus();
  elements.body.dispatchEvent(new Event("input", { bubbles: true }));
}

async function uploadAsset(file: File, alt: string): Promise<void> {
  if (!current?.exists || !current.ref) throw new Error("请先保存文章。");
  const params = referenceParams(current.ref);
  params.set("filename", file.name);
  const result = await api<{ markdownPath: string; repoPath: string }>(`/__content-studio/api/asset?${params}`, {
    method: "POST",
    headers: { "Content-Type": file.type || mimeForFilename(file.name) },
    body: file,
  });
  replaceSelection("![", alt || file.name.replace(/\.[^.]+$/, ""), `](${result.markdownPath})`);
  showToast(`图片已保存到 ${result.repoPath}`);
}

async function watchCheck(initial: CheckJob): Promise<void> {
  const sequence = ++activitySequence;
  let job = initial;
  while (sequence === activitySequence) {
    const labels: Record<CheckJob["status"], string> = { queued: "检查排队中", running: "正在检查", passed: "检查通过", failed: "检查失败" };
    setActivity(labels[job.status], job.status === "passed" ? "passed" : job.status === "failed" ? "failed" : "running", job.output);
    if (job.status === "passed" || job.status === "failed") break;
    await delay(900);
    try { job = await api<CheckJob>(`/__content-studio/api/check?id=${encodeURIComponent(job.id)}`); }
    catch (error) { setActivity("检查状态未知", "failed", errorText(error)); break; }
  }
}

async function watchDeploy(initial: DeployJob): Promise<void> {
  const sequence = ++activitySequence;
  let job = initial;
  while (sequence === activitySequence) {
    const labels: Record<DeployJob["status"], string> = {
      queued: "等待发布", checking: "正在检查", building: "正在构建",
      committing: "正在提交", pushing: "正在推送", passed: "已推送，等待上线", failed: "发布失败",
    };
    setActivity(labels[job.status], job.status === "passed" ? "passed" : job.status === "failed" ? "failed" : "running", job.output);
    if (job.status === "passed" || job.status === "failed") {
      setBusy(false);
      if (job.status === "passed") showToast(`发布成功${job.commit ? ` · ${job.commit}` : ""}，托管平台正在部署。`);
      else { elements.activityPanel.open = true; showToast("发布失败，请查看记录。", true); }
      break;
    }
    await delay(1000);
    try { job = await api<DeployJob>(`/__content-studio/api/deploy?id=${encodeURIComponent(job.id)}`); }
    catch (error) { setActivity("发布状态未知", "failed", errorText(error)); setBusy(false); break; }
  }
}

function setActivity(label: string, status: "running" | "passed" | "failed", output?: string): void {
  elements.activityStatus.textContent = label;
  elements.activityStatus.dataset.status = status;
  if (output !== undefined) elements.activityOutput.textContent = output;
  if (status === "failed") elements.activityPanel.open = true;
}

async function loadLatestActivity(): Promise<void> {
  try {
    const deploy = await api<DeployJob>("/__content-studio/api/deploy");
    void watchDeploy(deploy);
    return;
  } catch { /* no deploy in this process */ }
  try {
    const check = await api<CheckJob>("/__content-studio/api/check");
    void watchCheck(check);
  } catch { /* no check in this process */ }
}

function scheduleBackup(): void {
  window.clearTimeout(backupTimer);
  backupTimer = window.setTimeout(() => {
    if (current && dirty) localStorage.setItem(backupKey(current), JSON.stringify({ savedAt: new Date().toISOString(), draft: getDraft() }));
  }, 900);
}

function readBackup(key: string): { savedAt: string; draft: EntryDraft } | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as { savedAt?: unknown; draft?: unknown } | null;
    if (value && typeof value.savedAt === "string" && value.draft && typeof value.draft === "object") return value as { savedAt: string; draft: EntryDraft };
  } catch { localStorage.removeItem(key); }
  return undefined;
}

function clearBackup(key: string): void { localStorage.removeItem(key); }
function backupKey(state: Pick<CurrentState, "exists" | "ref" | "draft">): string {
  if (!state.exists || !state.ref) return `yanbian-studio:draft:new:${state.draft.kind}`;
  return `yanbian-studio:draft:${state.ref.kind}:${state.ref.course ?? ""}:${state.ref.id}`;
}

function bindEvents(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-create]")) {
    button.addEventListener("click", () => createEntry(button.dataset.create as EntryKind));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-composer-pane]")) {
    button.addEventListener("click", () => setComposerPane(button.dataset.composerPane as "write" | "preview"));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-markdown]")) {
    button.addEventListener("click", () => insertMarkdown(button.dataset.markdown ?? ""));
  }
  elements.catalogSearch.addEventListener("input", renderCatalog);
  elements.save.addEventListener("click", () => void saveEntry(false));
  elements.publish.addEventListener("click", () => void publishEntry());
  elements.activityStatus.addEventListener("click", () => { elements.activityPanel.open = true; });
  elements.articleId.addEventListener("input", () => { slugTouched = true; });
  elements.courseId.addEventListener("input", () => { slugTouched = true; });
  elements.title.addEventListener("input", () => {
    if (!current || current.exists || slugTouched) return;
    const suggestion = slugifyArticleId(elements.title.value);
    if (current.draft.kind === "course") elements.courseId.value = isValidCourseId(suggestion) ? suggestion : "";
    else elements.articleId.value = suggestion;
  });
  elements.form.addEventListener("input", markDirty);
  elements.form.addEventListener("change", markDirty);
  elements.body.addEventListener("input", () => { updateBodyCount(); markDirty(); });
  elements.body.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { event.preventDefault(); replaceSelection("", "  ", ""); }
  });
  elements.body.addEventListener("dragover", (event) => { if (current?.exists && !current.readOnly) event.preventDefault(); });
  elements.body.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    if (!file || !current?.exists || current.readOnly) return;
    event.preventDefault();
    void uploadAsset(file, file.name.replace(/\.[^.]+$/, "")).catch((error) => showToast(errorText(error), true));
  });
  elements.assetDialog.querySelector("form")?.addEventListener("submit", (event) => {
    if ((event as SubmitEvent).submitter !== elements.uploadAsset) return;
    event.preventDefault();
    const file = elements.assetFile.files?.[0];
    if (!file) return showToast("请选择图片文件。", true);
    elements.uploadAsset.disabled = true;
    void uploadAsset(file, elements.assetAlt.value.trim())
      .then(() => elements.assetDialog.close())
      .catch((error) => showToast(errorText(error), true))
      .finally(() => { elements.uploadAsset.disabled = false; });
  });
  window.addEventListener("beforeunload", (event) => { if (dirty || busy) event.preventDefault(); });
}

function initializeTheme(): void {
  const saved = localStorage.getItem("wrain-theme");
  document.documentElement.dataset.theme = saved === "dark" || saved === "light"
    ? saved
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderWelcomeStats(): void {
  const drafts = catalog.articles.filter((article) => article.draft).length;
  elements.welcomeStats.innerHTML = [[catalog.articles.length, "篇内容"], [drafts, "篇草稿"], [catalog.courses.length, "门课程"]]
    .map(([value, label]) => `<div class="welcome-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function updateBodyCount(): void {
  const body = elements.body.value.trim();
  elements.bodyCount.textContent = `${body ? [...body.replace(/\s/g, "")].length : 0} 字`;
}

function autoSummary(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]\s)\s*/gm, "")
    .replace(/[*_`~<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，\n]+/).map((tag) => tag.trim()).filter(Boolean))];
}

function revealSettingsForError(message: string): void {
  if (/摘要|ID|日期|标签/.test(message)) document.querySelector<HTMLDetailsElement>(".publish-settings")!.open = true;
}

function confirmSwitch(): boolean { return !dirty || window.confirm("当前内容尚未保存，确定切换吗？浏览器仍会保留自动备份。"); }
function matchesCourse(item: CatalogCourse, search: string): boolean { return !search || `${item.title} ${item.id} ${item.semester}`.toLocaleLowerCase().includes(search); }
function matchesArticle(item: CatalogArticle, search: string): boolean { return !search || `${item.title} ${item.id} ${item.course ?? ""} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(search); }
function courseTitle(id?: string): string { return catalog.courses.find((course) => course.id === id)?.title || id || "课程"; }

function isActiveItem(item: CatalogCourse | CatalogArticle): boolean {
  if (!current?.exists || !current.ref) return false;
  return current.ref.kind === item.kind && current.ref.id === item.id && current.ref.course === ("course" in item ? item.course : undefined);
}
function referenceForCatalogItem(item: CatalogCourse | CatalogArticle): EntryReference {
  return item.kind === "note" ? { kind: "note", id: item.id, course: item.course } : { kind: item.kind, id: item.id };
}
function validPreviewReference(draft: Exclude<EntryDraft, { kind: "course" }>): EntryReference | undefined {
  if (!isValidArticleId(draft.id)) return undefined;
  return draft.kind === "note" && isValidCourseId(draft.course)
    ? { kind: "note", id: draft.id, course: draft.course }
    : draft.kind === "essay" ? { kind: "essay", id: draft.id } : undefined;
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
function kindLabel(kind: EntryKind): string { return kind === "course" ? "课程设置" : kind === "note" ? "课程笔记" : "随笔"; }
function referenceParams(ref: EntryReference): URLSearchParams {
  const params = new URLSearchParams({ kind: ref.kind, id: ref.id });
  if (ref.course) params.set("course", ref.course);
  return params;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Content-Studio-Token", window.__CONTENT_STUDIO_TOKEN__);
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
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
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char] ?? char); }
function localDate(): string { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
function formatBackupTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "较早" : date.toLocaleString("zh-CN"); }
function mimeForFilename(name: string): string {
  const extension = name.toLocaleLowerCase().split(".").pop();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
function delay(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function byId<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`缺少界面元素 #${id}`); return element as T; }
