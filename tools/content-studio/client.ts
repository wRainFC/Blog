import type { CheckJob } from "./check-runner";
import type { DeployJob } from "./deploy-runner";
import type { CourseChapter, EntryDraft, EntryKind, EntryReference, StructurePreview, WorkspaceSnapshot } from "./model";
import { slugifyArticleId, validateDraft } from "./model";
import {
  ApiError,
  applyStructure as applyStructureRequest,
  deleteEntry as deleteEntryRequest,
  errorText,
  getCheck,
  getDeploy,
  loadEntry,
  loadWorkspace,
  previewStructure,
  renderMarkdown,
  saveEntry as saveEntryRequest,
  startCheck,
  startDeploy,
  uploadImage,
} from "./api-client";
import { focusLine, insertMarkdown, outlineMarkup, preferredComposerMode, previewDocument, setComposerMode, type ComposerMode } from "./editor-view";
import { createStudioDialogs } from "./dialogs";
import { renderNavigation } from "./navigation";
import { createSideSheet, escapeHtml } from "./side-sheet";
import { renderStructure } from "./structure-view";
import {
  createStructureState,
  entryBackupKey,
  moveChapter,
  moveNotes,
  readEntryBackup,
  readStructureBackup,
  refFor,
  restoreStructureBackup,
  structureBackupKey,
  structureChangeCount,
  structurePreviewPayload,
  updateStructureDirty,
  writeEntryBackup,
  writeStructureBackup,
  type StructureState,
  type WorkingEntry,
} from "./workspace-state";

const emptyWorkspace: WorkspaceSnapshot = {
  revision: "",
  courses: [],
  essays: [],
  tags: [],
  counts: { total: 0, draft: 0, published: 0, issues: 0 },
};

const el = {
  shell: document.querySelector<HTMLElement>(".studio-shell")!,
  sidebarToggle: id<HTMLButtonElement>("sidebar-toggle"),
  search: id<HTMLInputElement>("catalog-search"),
  filter: id<HTMLSelectElement>("catalog-status"),
  catalog: id("catalog-list"),
  headerParent: id("header-parent"),
  headerTitle: id("header-title"),
  saveStatus: id("save-status"),
  activityStatus: id<HTMLButtonElement>("activity-status"),
  primary: id<HTMLButtonElement>("primary-action"),
  globalMenu: id<HTMLDetailsElement>("global-menu"),
  welcome: id("welcome-panel"),
  welcomeContent: id("welcome-content"),
  board: id("course-board"),
  boardTitle: id("board-title"),
  boardDescription: id("board-description"),
  chapterOutline: id("chapter-outline"),
  addChapter: id<HTMLButtonElement>("add-chapter"),
  structureBackup: id("structure-backup"),
  editor: id("entry-editor"),
  entryBackup: id("entry-backup"),
  form: id<HTMLFormElement>("entry-form"),
  kind: id("entry-kind-label"),
  path: id("entry-path"),
  readonlyNotice: id("readonly-notice"),
  title: id<HTMLInputElement>("field-title"),
  courseCreate: id("course-create-fields"),
  courseId: id<HTMLInputElement>("field-course-id"),
  semester: id<HTMLInputElement>("field-semester"),
  courseOrder: id<HTMLInputElement>("field-course-order"),
  description: id<HTMLTextAreaElement>("field-description"),
  articleFields: id("article-editor-fields"),
  summary: id<HTMLTextAreaElement>("field-summary"),
  composer: id("composer"),
  body: id<HTMLTextAreaElement>("field-body"),
  bodyCount: id("body-count"),
  previewFrame: id<HTMLIFrameElement>("preview-frame"),
  previewEmpty: id("preview-empty"),
  previewErrors: id("preview-errors"),
  image: id<HTMLButtonElement>("image-button"),
  sheetRoot: id("side-sheet"),
  sheetTitle: id("side-sheet-title"),
  sheetBody: id("side-sheet-body"),
  sheetClose: id<HTMLButtonElement>("side-sheet-close"),
  backdrop: id("surface-backdrop"),
  switchDialog: id<HTMLDialogElement>("switch-dialog"),
  deleteDialog: id<HTMLDialogElement>("delete-entry-dialog"),
  deleteName: id("delete-entry-name"),
  deleteDirty: id("delete-entry-dirty"),
  deleteSeparator: id("delete-entry-separator"),
  assetDialog: id<HTMLDialogElement>("asset-dialog"),
  assetFile: id<HTMLInputElement>("asset-file"),
  assetAlt: id<HTMLInputElement>("asset-alt"),
  uploadAsset: id<HTMLButtonElement>("upload-asset"),
  structureDialog: id<HTMLDialogElement>("structure-dialog"),
  structureDialogTitle: id("structure-dialog-title"),
  structureDialogDescription: id("structure-dialog-description"),
  structureTextField: id("structure-text-field"),
  structureTextLabel: id("structure-text-label"),
  structureText: id<HTMLInputElement>("structure-text-input"),
  structureTargetField: id("structure-target-field"),
  structureTarget: id<HTMLSelectElement>("structure-target"),
  structureConfirm: id<HTMLButtonElement>("structure-confirm"),
  toast: id("toast"),
};

const sheet = createSideSheet(el.sheetRoot, el.sheetTitle, el.sheetBody, el.sheetClose, el.backdrop);
const dialogs = createStudioDialogs({
  structure: el.structureDialog,
  structureTitle: el.structureDialogTitle,
  structureDescription: el.structureDialogDescription,
  structureTextField: el.structureTextField,
  structureTextLabel: el.structureTextLabel,
  structureText: el.structureText,
  structureTargetField: el.structureTargetField,
  structureTarget: el.structureTarget,
  structureConfirm: el.structureConfirm,
  deleteEntry: el.deleteDialog,
  deleteEntryName: el.deleteName,
  deleteEntryDirty: el.deleteDirty,
});
let workspace = emptyWorkspace;
let current: WorkingEntry | undefined;
let structure: StructureState | undefined;
let activeSurface: "welcome" | "course" | "entry" = "welcome";
let entryDirty = false;
let busy = false;
let busyLabel = "正在保存…";
let previewTimer: number | undefined;
let backupTimer: number | undefined;
let toastTimer: number | undefined;
let activity: CheckJob | DeployJob | undefined;
let entryRecovery: ReturnType<typeof readEntryBackup>;
let structureRecovery: ReturnType<typeof readStructureBackup>;
let initialRouteHandled = false;
const expandedCourses = new Set<string>(readStringArray("content-studio:expanded-courses"));

initializeTheme();
bindEvents();
void refreshWorkspace(true);

function bindEvents(): void {
  el.search.addEventListener("input", renderCatalog);
  el.filter.addEventListener("change", renderCatalog);
  el.sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!el.shell.classList.contains("is-sidebar-collapsed")));
  el.addChapter.addEventListener("click", () => void addChapterDialog());
  el.form.addEventListener("input", () => {
    syncMainFields();
    setEntryDirty(true);
    schedulePreview();
  });
  el.title.addEventListener("input", () => {
    if (current && !current.exists && current.draft.kind !== "course") current.draft.id = slugifyArticleId(el.title.value);
  });
  el.primary.addEventListener("click", () => {
    if (structure?.dirty && activeSurface === "course") void openChangeReview();
    else void saveCurrent();
  });
  document.querySelectorAll<HTMLElement>("[data-create]").forEach((button) => {
    button.addEventListener("click", () => void createEntry(button.dataset.create as EntryKind));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-composer-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setComposerMode(el.composer, button.dataset.composerMode as ComposerMode);
      schedulePreview();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-markdown]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.markdown!;
      if (action === "image") el.assetDialog.showModal();
      else if (current && !current.bodyReadOnly) insertMarkdown(el.body, action);
      button.closest<HTMLDetailsElement>("details")?.removeAttribute("open");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-global-action]").forEach((button) => {
    button.addEventListener("click", () => {
      el.globalMenu.open = false;
      handleGlobalAction(button.dataset.globalAction ?? "");
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-recovery]").forEach((button) => {
    button.addEventListener("click", () => handleRecovery(button.dataset.recovery!));
  });
  el.uploadAsset.addEventListener("click", (event) => {
    event.preventDefault();
    void insertImage();
  });
  el.activityStatus.addEventListener("click", openActivity);
  el.backdrop.addEventListener("click", () => {
    if (sheet.isOpen()) sheet.close();
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  });
  el.welcomeContent.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-welcome-ref],[data-welcome-course]");
    if (target?.dataset.welcomeCourse) void openCourse(target.dataset.welcomeCourse);
    if (target?.dataset.welcomeRef) void openEntry(JSON.parse(target.dataset.welcomeRef) as EntryReference);
  });
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      el.search.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      if (structure?.dirty && activeSurface === "course") void openChangeReview();
      else void saveCurrent();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (entryDirty || structure?.dirty) event.preventDefault();
  });
}

function handleGlobalAction(action: string): void {
  switch (action) {
    case "properties": openProperties(); break;
    case "outline": openOutline(); break;
    case "check": void runCheck(); break;
    case "publish": void publishCurrent(); break;
    case "delete": void confirmDeleteCurrent(); break;
  }
}

async function refreshWorkspace(handleRoute = false): Promise<boolean> {
  try {
    workspace = await loadWorkspace();
    updateFilterLabels();
    renderCatalog();
    renderWelcome();
    if (handleRoute && !initialRouteHandled) {
      initialRouteHandled = true;
      await restoreRoute();
    }
    return true;
  } catch (error) {
    el.catalog.innerHTML = '<p class="sidebar-message">' + escapeHtml(errorText(error)) + "</p>";
    showToast(errorText(error), true);
    return false;
  }
}

function renderCatalog(): void {
  renderNavigation(
    el.catalog,
    workspace,
    el.search.value,
    el.filter.value,
    expandedCourses,
    activeCourseId(),
    current?.ref,
    {
      openCourse: (courseId) => void openCourse(courseId),
      openEntry: (ref) => void openEntry(ref),
      create: (kind, courseId, chapterId) => void createEntry(kind, courseId, chapterId),
      addChapter: (courseId) => void openCourseThenAdd(courseId),
      toggleCourse: (courseId) => {
        if (expandedCourses.has(courseId)) expandedCourses.delete(courseId);
        else expandedCourses.add(courseId);
        localStorage.setItem("content-studio:expanded-courses", JSON.stringify([...expandedCourses]));
        renderCatalog();
      },
    },
  );
}

function renderWelcome(): void {
  const recent = [
    ...workspace.courses.flatMap((course) => course.chapters.flatMap((chapter) => chapter.notes)),
    ...workspace.essays,
  ].sort((a, b) => (b.updated ?? b.pubDate).localeCompare(a.updated ?? a.pubDate)).slice(0, 4);
  const issueCourse = workspace.courses.find((course) => course.counts.issues);
  const rows: string[] = [];
  if (workspace.counts.issues && issueCourse) {
    rows.push('<button class="welcome-link" data-welcome-course="' + escapeHtml(issueCourse.id) + '"><small>待整理</small><strong>' + workspace.counts.issues + ' 篇内容需要处理</strong><span>→</span></button>');
  }
  for (const [index, article] of recent.entries()) {
    rows.push('<button class="welcome-link" data-welcome-ref="' + escapeHtml(JSON.stringify(refFor(article))) + '"><small>' + (index === 0 ? "继续编辑" : "最近") + '</small><strong>' + escapeHtml(article.title) + '</strong><span aria-hidden="true">›</span></button>');
  }
  el.welcomeContent.innerHTML = rows.join("");
}

function showWelcome(): void {
  sheet.close();
  current = undefined;
  structure = undefined;
  entryDirty = false;
  entryRecovery = undefined;
  structureRecovery = undefined;
  setActiveSurface("welcome");
  updateHeader();
  renderCatalog();
  updateUrl({});
}

function setActiveSurface(surface: "welcome" | "course" | "entry"): void {
  activeSurface = surface;
  el.welcome.hidden = surface !== "welcome";
  el.board.hidden = surface !== "course";
  el.editor.hidden = surface !== "entry";
}

async function restoreRoute(): Promise<void> {
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "structure" && params.get("course")) {
    await openCourse(params.get("course")!);
  } else if (params.get("view") === "document" && params.get("kind") && params.get("id")) {
    await openEntry({
      kind: params.get("kind") as EntryKind,
      id: params.get("id")!,
      course: params.get("course") || undefined,
    });
  }
}

async function openCourse(courseId: string, skipGuard = false): Promise<void> {
  if (!skipGuard && !await allowSwitch()) return;
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) return;
  try {
    const entry = await loadEntry({ kind: "course", id: courseId });
    current = { ...entry, exists: true, original: structuredClone(entry.draft) };
    structure = createStructureState(course);
    entryDirty = false;
    entryRecovery = undefined;
    structureRecovery = readStructureBackup(localStorage, courseId);
    expandedCourses.add(courseId);
    showCourse();
    updateUrl({ view: "structure", course: courseId });
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  } catch (error) {
    showToast(errorText(error), true);
  }
}

async function openEntry(ref: EntryReference, skipGuard = false): Promise<void> {
  if (!skipGuard && !await allowSwitch()) return;
  try {
    const entry = await loadEntry(ref);
    current = { ...entry, exists: true, original: structuredClone(entry.draft) };
    structure = undefined;
    entryDirty = false;
    entryRecovery = readEntryBackup(localStorage, ref);
    structureRecovery = undefined;
    fillEditor();
    updateUrl({ view: "document", kind: ref.kind, id: ref.id, course: ref.course });
    if (window.innerWidth < 1024) setSidebarCollapsed(true);
  } catch (error) {
    showToast(errorText(error), true);
  }
}

async function createEntry(kind: EntryKind, courseId?: string, chapterId?: string): Promise<void> {
  if (!await allowSwitch()) return;
  const today = new Date().toISOString().slice(0, 10);
  let draft: EntryDraft;
  if (kind === "course") {
    draft = { kind, id: "", title: "", semester: "", order: workspace.courses.length, chapters: [] };
  } else if (kind === "note") {
    const course = workspace.courses.find((item) => item.id === courseId) ?? workspace.courses[0];
    const chapter = course?.chapters.find((item) => item.id === chapterId) ?? course?.chapters[0];
    if (!course || !chapter) {
      showToast("请先创建课程和至少一个章节。", true);
      return;
    }
    const order = chapter.notes.reduce((maximum, note) => Math.max(maximum, note.order ?? -1), -1) + 1;
    draft = {
      kind,
      id: "",
      title: "",
      summary: "",
      pubDate: today,
      tags: [],
      draft: true,
      body: "",
      course: course.id,
      chapter: chapter.id,
      order,
    };
  } else {
    draft = { kind, id: "", title: "", summary: "", pubDate: today, tags: [], draft: true, body: "", featured: false };
  }
  const ref: EntryReference = draft.kind === "note"
    ? { kind: "note", id: "", course: draft.course }
    : { kind: draft.kind, id: "" };
  current = {
    exists: false,
    ref,
    draft,
    original: structuredClone(draft),
    revision: "",
    repoPath: "",
    sitePath: "",
    extension: kind === "course" ? ".yaml" : ".md",
    bodyReadOnly: false,
  };
  structure = undefined;
  entryDirty = false;
  entryRecovery = undefined;
  fillEditor();
  el.title.focus();
}

function showCourse(): void {
  if (!current || current.draft.kind !== "course" || !structure) return;
  sheet.close();
  setActiveSurface("course");
  el.boardTitle.textContent = current.draft.title;
  el.boardDescription.textContent = current.draft.description || "整理这门课程的章节与笔记顺序。";
  renderStructureBoard();
  renderRecovery();
  updateHeader();
  renderCatalog();
}

function fillEditor(): void {
  if (!current) return;
  sheet.close();
  const draft = current.draft;
  setActiveSurface("entry");
  el.kind.textContent = draft.kind === "course" ? "新课程" : draft.kind === "note" ? "课程笔记" : "随笔";
  el.path.textContent = current.repoPath || "尚未保存";
  el.title.value = draft.title;
  el.courseCreate.hidden = draft.kind !== "course";
  el.articleFields.hidden = draft.kind === "course";
  el.readonlyNotice.hidden = !current.bodyReadOnly;
  if (draft.kind === "course") {
    el.courseId.value = draft.id;
    el.courseId.disabled = current.exists;
    el.semester.value = draft.semester;
    el.courseOrder.value = String(draft.order);
    el.description.value = draft.description ?? "";
  } else {
    el.summary.value = draft.summary;
    el.body.value = draft.body;
    el.body.readOnly = current.bodyReadOnly;
    el.image.disabled = current.bodyReadOnly || !current.exists;
    setComposerMode(el.composer, preferredComposerMode(current.bodyReadOnly));
    updateBodyCount();
    schedulePreview();
  }
  renderRecovery();
  updateHeader();
  renderCatalog();
}

function syncMainFields(): void {
  if (!current) return;
  const draft = current.draft;
  draft.title = el.title.value;
  if (draft.kind === "course") {
    draft.id = el.courseId.value.trim();
    draft.semester = el.semester.value.trim();
    draft.order = Number(el.courseOrder.value);
    draft.description = el.description.value.trim() || undefined;
  } else {
    draft.summary = el.summary.value.trim();
    draft.body = el.body.value;
    updateBodyCount();
  }
}

async function saveCurrent(): Promise<boolean> {
  if (!current || busy) return false;
  if (deploymentRunning()) {
    showToast("发布任务进行中，请等待结束后再保存。", true);
    return false;
  }
  syncMainFields();
  if (current.draft.kind !== "course" && !current.draft.summary) {
    current.draft.summary = autoSummary(current.draft.body);
    el.summary.value = current.draft.summary;
  }
  const errors = validateDraft(current.draft);
  if (errors.length) {
    showToast(errors[0], true);
    return false;
  }
  const oldBackupKey = entryBackupKey(current.ref);
  const desiredStructure = structure?.dirty
    ? {
        chapters: structuredClone(structure.chapters),
        notes: structure.notes.map((note) => ({ id: note.id, chapter: note.chapter, order: note.order })),
      }
    : undefined;
  setBusy(true);
  try {
    const result = await saveEntryRequest({
      mode: current.exists ? "update" : "create",
      draft: current.draft,
      ref: current.exists ? current.ref : undefined,
      expectedRevision: current.exists ? current.revision : undefined,
    });
    current.exists = true;
    current.ref = result.ref;
    current.revision = result.revision;
    current.repoPath = result.repoPath;
    current.sitePath = result.sitePath;
    current.original = structuredClone(current.draft);
    localStorage.removeItem(oldBackupKey);
    localStorage.removeItem(entryBackupKey(result.ref));
    entryDirty = false;
    if (result.checkJob) void followCheck(result.checkJob);
    const workspaceRefreshed = await refreshWorkspace();
    if (workspaceRefreshed && current.draft.kind === "course") {
      const course = workspace.courses.find((item) => item.id === current!.draft.id);
      if (course) {
        current.revision = course.revision;
        current.draft.chapters = course.chapters.map(({ id, title }) => ({ id, title }));
        structure = createStructureState(course);
        if (desiredStructure) {
          structure.chapters = desiredStructure.chapters;
          for (const saved of desiredStructure.notes) {
            const note = structure.notes.find((item) => item.id === saved.id);
            if (note) { note.chapter = saved.chapter; note.order = saved.order; }
          }
          updateStructureDirty(structure);
          if (structure.dirty) writeStructureBackup(localStorage, structure);
        }
        showCourse();
        updateUrl({ view: "structure", course: course.id });
      }
    } else if (workspaceRefreshed) {
      fillEditor();
      updateUrl({ view: "document", kind: current.ref.kind, id: current.ref.id, course: current.ref.course });
    } else {
      updateHeader();
      updateUrl({ view: "document", kind: current.ref.kind, id: current.ref.id, course: current.ref.course });
    }
    showToast(result.refreshWarning || !workspaceRefreshed ? "内容已保存，但内容索引刷新失败。" : "内容已保存。");
    return true;
  } catch (error) {
    showToast(errorText(error), true);
    if (error instanceof ApiError && error.status === 409) openErrorSheet(errorText(error));
    return false;
  } finally {
    setBusy(false);
  }
}

function renderStructureBoard(): void {
  if (!structure) return;
  renderStructure(el.chapterOutline, structure, {
    addChapter: () => void addChapterDialog(),
    openNote: (ref) => void openEntry(ref),
    renameChapter: (chapter) => void renameChapterDialog(chapter),
    moveChapter: (chapterId, offset) => {
      const index = structure!.chapters.findIndex((chapter) => chapter.id === chapterId);
      moveChapter(structure!, chapterId, index + offset);
      stageStructure();
    },
    mergeChapter: (chapterId) => void mergeChapterDialog(chapterId),
    deleteChapter: (chapterId) => void deleteChapterDialog(chapterId),
    moveNote: (noteId, offset) => moveNoteByOffset(noteId, offset),
    chooseNoteChapter: (noteIds) => void moveNotesDialog(noteIds),
    dropChapter: (chapterId, targetId) => {
      const targetIndex = structure!.chapters.findIndex((chapter) => chapter.id === targetId);
      moveChapter(structure!, chapterId, targetIndex);
      stageStructure();
    },
    dropNote: (noteId, targetChapter, targetIndex) => {
      moveNotes(structure!, [noteId], targetChapter, targetIndex);
      stageStructure();
    },
    toggleSelection: (noteId) => {
      if (structure!.selected.has(noteId)) structure!.selected.delete(noteId);
      else structure!.selected.add(noteId);
      renderStructureBoard();
    },
    enterSelection: () => {
      structure!.selectionMode = true;
      renderStructureBoard();
    },
    cancelSelection: () => {
      structure!.selectionMode = false;
      structure!.selected.clear();
      renderStructureBoard();
    },
  });
  updateHeader();
}

function stageStructure(): void {
  if (!structure) return;
  updateStructureDirty(structure);
  if (structure.dirty) writeStructureBackup(localStorage, structure);
  renderStructureBoard();
  renderRecovery();
}

async function openCourseThenAdd(courseId: string): Promise<void> {
  if (!structure || structure.course.id !== courseId) await openCourse(courseId);
  if (structure?.course.id === courseId) await addChapterDialog();
}

async function addChapterDialog(): Promise<void> {
  if (!structure) return;
  const answer = await dialogs.structure({
    title: "新增章节",
    description: "章节 ID 将自动生成，保存后保持稳定。",
    textLabel: "章节标题",
    textValue: "新章节",
    confirmLabel: "新增",
  });
  if (!answer?.text) return;
  structure.chapters.push({ id: nextChapterId(), title: answer.text });
  stageStructure();
}

async function renameChapterDialog(chapter: CourseChapter): Promise<void> {
  const answer = await dialogs.structure({
    title: "重命名章节",
    description: "章节 ID " + chapter.id + " 不会改变。",
    textLabel: "章节标题",
    textValue: chapter.title,
    confirmLabel: "重命名",
  });
  if (!answer?.text || !structure) return;
  chapter.title = answer.text;
  stageStructure();
}

async function mergeChapterDialog(chapterId: string): Promise<void> {
  if (!structure || structure.chapters.length < 2) return;
  const targets = structure.chapters.filter((chapter) => chapter.id !== chapterId);
  const answer = await dialogs.structure({
    title: "合并章节",
    description: "该章节中的笔记会移动到目标章节末尾。",
    targets,
    confirmLabel: "合并",
  });
  if (!answer?.target) return;
  const noteIds = structure.notes.filter((note) => note.chapter === chapterId).map((note) => note.id);
  moveNotes(structure, noteIds, answer.target);
  structure.chapters = structure.chapters.filter((chapter) => chapter.id !== chapterId);
  stageStructure();
}

async function deleteChapterDialog(chapterId: string): Promise<void> {
  if (!structure) return;
  const notes = structure.notes.filter((note) => note.chapter === chapterId);
  const targets = structure.chapters.filter((chapter) => chapter.id !== chapterId);
  const answer = await dialogs.structure({
    title: "删除章节",
    description: notes.length
      ? "其中 " + notes.length + " 篇笔记将先移动到目标章节。"
      : "这是一个空章节，只会移除课程目录中的章节记录。",
    targets: notes.length ? targets : undefined,
    confirmLabel: "删除",
  });
  if (!answer || notes.length && !answer.target) return;
  if (notes.length) moveNotes(structure, notes.map((note) => note.id), answer.target!);
  structure.chapters = structure.chapters.filter((chapter) => chapter.id !== chapterId);
  stageStructure();
}

async function moveNotesDialog(noteIds: string[]): Promise<void> {
  if (!structure || !noteIds.length) return;
  const answer = await dialogs.structure({
    title: noteIds.length > 1 ? "移动所选笔记" : "移动笔记",
    description: "笔记会追加到目标章节末尾。",
    targets: structure.chapters,
    confirmLabel: "移动",
  });
  if (!answer?.target) return;
  moveNotes(structure, noteIds, answer.target);
  structure.selected.clear();
  structure.selectionMode = false;
  stageStructure();
}

function moveNoteByOffset(noteId: string, offset: number): void {
  if (!structure) return;
  const note = structure.notes.find((item) => item.id === noteId);
  if (!note) return;
  const siblings = structure.notes.filter((item) => item.chapter === note.chapter).sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((item) => item.id === noteId);
  const target = index + offset;
  if (target < 0 || target >= siblings.length) return;
  moveNotes(structure, [noteId], note.chapter, target);
  stageStructure();
}

async function openChangeReview(): Promise<void> {
  if (!structure?.dirty) return;
  sheet.open("审阅结构调整", '<p class="sheet-hint">正在检查变更…</p>');
  try {
    const preview = await previewStructure(structurePreviewPayload(structure));
    renderChangeReview(preview);
  } catch (error) {
    sheet.open("无法审阅调整", '<p class="sheet-hint">' + escapeHtml(errorText(error)) + '</p><div class="sheet-actions"><button id="refresh-structure" class="button" type="button">重新加载</button></div>', (root) => {
      root.querySelector<HTMLButtonElement>("#refresh-structure")?.addEventListener("click", () => void reloadCourseStructure());
    });
  }
}

function renderChangeReview(preview: StructurePreview): void {
  const files = preview.files.map((file) => {
    const fields = file.changes.map((change) => '<div class="field-change"><strong>' + fieldLabel(change.field) + '</strong><br>' + escapeHtml(formatValue(change.before)) + ' → ' + escapeHtml(formatValue(change.after)) + '</div>').join("");
    return '<section class="change-file"><code>' + escapeHtml(file.path) + '</code>' + fields + '</section>';
  }).join("");
  sheet.open(
    "审阅结构调整",
    (files || '<p class="sheet-empty">没有需要写入的结构变化。</p>') +
      '<div class="sheet-actions"><button id="discard-structure" class="button button-quiet" type="button">放弃全部</button><button id="apply-structure" class="button button-primary" type="button"' + (preview.files.length ? "" : " disabled") + '>应用调整</button></div>',
    (root) => {
      root.querySelector<HTMLButtonElement>("#discard-structure")?.addEventListener("click", discardStructure);
      root.querySelector<HTMLButtonElement>("#apply-structure")?.addEventListener("click", () => void applyPreview(preview.changeSetId));
    },
  );
}

async function applyPreview(changeSetId: string): Promise<boolean> {
  if (!structure || busy) return false;
  if (deploymentRunning()) {
    showToast("发布任务进行中，请等待结束后再应用结构调整。", true);
    return false;
  }
  setBusy(true);
  try {
    const courseId = structure.course.id;
    const result = await applyStructureRequest(changeSetId);
    localStorage.removeItem(structureBackupKey(courseId));
    if (result.checkJob) void followCheck(result.checkJob);
    const workspaceRefreshed = await refreshWorkspace();
    if (workspaceRefreshed) await openCourse(courseId, true);
    else {
      current = undefined;
      structure = undefined;
      setActiveSurface("welcome");
      updateHeader();
      updateUrl({});
    }
    sheet.close();
    showToast(result.refreshWarning || !workspaceRefreshed ? "结构已应用，但内容索引刷新失败。" : "结构调整已应用。");
    return true;
  } catch (error) {
    showToast(errorText(error), true);
    sheet.open("结构调整未应用", '<p class="sheet-hint">' + escapeHtml(errorText(error)) + '</p><div class="sheet-actions"><button id="refresh-structure" class="button" type="button">重新加载</button></div>', (root) => {
      root.querySelector<HTMLButtonElement>("#refresh-structure")?.addEventListener("click", () => void reloadCourseStructure());
    });
    return false;
  } finally {
    setBusy(false);
  }
}

async function applyStructureDirect(): Promise<boolean> {
  if (!structure?.dirty) return true;
  try {
    const preview = await previewStructure(structurePreviewPayload(structure));
    if (!preview.files.length) return true;
    return applyPreview(preview.changeSetId);
  } catch (error) {
    showToast(errorText(error), true);
    return false;
  }
}

function discardStructure(): void {
  if (!structure) return;
  const courseId = structure.course.id;
  structure = createStructureState(structure.course);
  localStorage.removeItem(structureBackupKey(courseId));
  structureRecovery = undefined;
  sheet.close();
  showCourse();
}

function openProperties(): void {
  if (!current) {
    sheet.open("属性", '<p class="sheet-empty">请先选择内容。</p>');
    return;
  }
  const draft = current.draft;
  if (draft.kind === "course") {
    sheet.open("课程属性", '<label class="field"><span>课程名称</span><input id="property-title" value="' + escapeHtml(draft.title) + '"></label><label class="field"><span>学期</span><input id="property-semester" value="' + escapeHtml(draft.semester) + '"></label><label class="field"><span>排序</span><input id="property-order" type="number" step="1" value="' + draft.order + '"></label><label class="field"><span>课程简介</span><textarea id="property-description" rows="5">' + escapeHtml(draft.description ?? "") + '</textarea></label><p class="sheet-hint">课程 ID：' + escapeHtml(draft.id || "保存后生成") + "</p>", bindCourseProperties);
    return;
  }
  const courseFields = draft.kind === "note" ? notePropertyFields(draft.course, draft.chapter, draft.order, current.exists) : "";
  const featured = draft.kind === "essay" ? '<label class="property-switch"><input id="property-featured" type="checkbox"' + (draft.featured ? " checked" : "") + '>首页精选</label>' : "";
  sheet.open("文章属性",
    '<label class="field"><span>文章 ID</span><input id="property-id" value="' + escapeHtml(draft.id) + '"' + (current.exists ? " disabled" : "") + '></label>' +
    courseFields +
    '<label class="field"><span>发布日期</span><input id="property-pub-date" type="date" value="' + escapeHtml(draft.pubDate) + '"></label>' +
    '<label class="field"><span>更新时间</span><input id="property-updated" type="date" value="' + escapeHtml(draft.updated ?? "") + '"></label>' +
    '<label class="field"><span>标签 <small>使用逗号分隔</small></span><input id="property-tags" value="' + escapeHtml(draft.tags.join(", ")) + '"></label>' +
    '<label class="property-switch"><input id="property-draft" type="checkbox"' + (draft.draft ? " checked" : "") + '>保持为草稿</label>' + featured,
    bindArticleProperties,
  );
}

function bindCourseProperties(root: HTMLElement): void {
  root.addEventListener("input", () => {
    if (!current || current.draft.kind !== "course") return;
    current.draft.title = value(root, "property-title");
    current.draft.semester = value(root, "property-semester");
    current.draft.order = Number(value(root, "property-order"));
    current.draft.description = value(root, "property-description").trim() || undefined;
    el.title.value = current.draft.title;
    if (structure) {
      el.boardTitle.textContent = current.draft.title;
      el.boardDescription.textContent = current.draft.description || "整理这门课程的章节与笔记顺序。";
    }
    setEntryDirty(true);
  });
}

function bindArticleProperties(root: HTMLElement): void {
  const courseSelect = root.querySelector<HTMLSelectElement>("#property-course");
  courseSelect?.addEventListener("change", () => {
    const chapterSelect = root.querySelector<HTMLSelectElement>("#property-chapter");
    const course = workspace.courses.find((item) => item.id === courseSelect.value);
    if (chapterSelect) chapterSelect.innerHTML = (course?.chapters ?? []).map((chapter) => '<option value="' + escapeHtml(chapter.id) + '">' + escapeHtml(chapter.title) + "</option>").join("");
    updateArticleProperties(root);
  });
  root.addEventListener("input", () => updateArticleProperties(root));
  root.addEventListener("change", () => updateArticleProperties(root));
}

function updateArticleProperties(root: HTMLElement): void {
  if (!current || current.draft.kind === "course") return;
  const draft = current.draft;
  if (!current.exists) draft.id = value(root, "property-id").trim();
  draft.pubDate = value(root, "property-pub-date");
  draft.updated = value(root, "property-updated") || undefined;
  draft.tags = value(root, "property-tags").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  draft.draft = checked(root, "property-draft");
  if (draft.kind === "essay") draft.featured = checked(root, "property-featured");
  else {
    if (!current.exists) {
      draft.course = value(root, "property-course");
      current.ref.course = draft.course;
    }
    draft.chapter = value(root, "property-chapter");
    draft.order = Number(value(root, "property-order"));
  }
  setEntryDirty(true);
}

function notePropertyFields(courseId: string, chapterId: string, order: number, lockedCourse: boolean): string {
  const courseOptions = workspace.courses.map((course) => '<option value="' + escapeHtml(course.id) + '"' + (course.id === courseId ? " selected" : "") + ">" + escapeHtml(course.title) + "</option>").join("");
  const course = workspace.courses.find((item) => item.id === courseId);
  const chapterOptions = (course?.chapters ?? []).map((chapter) => '<option value="' + escapeHtml(chapter.id) + '"' + (chapter.id === chapterId ? " selected" : "") + ">" + escapeHtml(chapter.title) + "</option>").join("");
  return '<label class="field"><span>课程</span><select id="property-course"' + (lockedCourse ? " disabled" : "") + '>' + courseOptions + '</select></label><label class="field"><span>章节</span><select id="property-chapter">' + chapterOptions + '</select></label><label class="field"><span>章节内顺序</span><input id="property-order" type="number" min="0" step="1" value="' + order + '"></label>';
}

function openOutline(): void {
  if (!current || current.draft.kind === "course") {
    sheet.open("文内大纲", '<p class="sheet-empty">课程没有文内大纲。</p>');
    return;
  }
  syncMainFields();
  sheet.open("文内大纲", outlineMarkup(current.draft.body), (root) => {
    root.querySelectorAll<HTMLButtonElement>("[data-outline-line]").forEach((button) => {
      button.addEventListener("click", () => {
        sheet.close();
        focusLine(el.body, Number(button.dataset.outlineLine), el.composer);
      });
    });
  });
}

async function runCheck(): Promise<void> {
  if (deploymentRunning()) {
    showToast("发布任务已经包含检查，请等待发布结束。", true);
    return;
  }
  try {
    activity = await startCheck();
    updateActivity();
    void followCheck(activity);
  } catch (error) {
    showToast(errorText(error), true);
  }
}

async function publishCurrent(): Promise<void> {
  if (deploymentRunning()) {
    showToast("已有发布任务正在运行。", true);
    return;
  }
  if (!current?.exists || current.draft.kind === "course") {
    showToast("请先选择并保存一篇文章。", true);
    return;
  }
  if (entryDirty) {
    showToast("请先保存文章。", true);
    return;
  }
  if (current.draft.draft) {
    showToast("草稿不能发布，请先在属性中改为公开。", true);
    return;
  }
  try {
    activity = await startDeploy(current.ref, current.revision);
    updateActivity();
    void followDeploy(activity);
  } catch (error) {
    showToast(errorText(error), true);
  }
}

async function confirmDeleteCurrent(): Promise<void> {
  if (!current?.exists || current.draft.kind === "course" || busy) return;
  if (deploymentRunning()) {
    showToast("发布任务进行中，请等待结束后再删除。", true);
    return;
  }
  const entry = current;
  if (!await dialogs.confirmDeleteEntry(entry.draft.title || entry.ref.id, entryDirty)) return;

  setBusy(true, "正在删除…");
  try {
    const result = await deleteEntryRequest(entry.ref, entry.revision);
    localStorage.removeItem(entryBackupKey(entry.ref));
    showWelcome();
    const workspaceRefreshed = await refreshWorkspace();
    if (result.checkJob) void followCheck(result.checkJob);
    showToast(result.refreshWarning || !workspaceRefreshed ? "文章已移至回收站，但内容索引刷新失败。" : "文章已移至工作台回收站。");
  } catch (error) {
    showToast(errorText(error), true);
    if (error instanceof ApiError && error.status === 409) openErrorSheet(errorText(error));
  } finally {
    setBusy(false);
  }
}

async function followCheck(job: CheckJob): Promise<void> {
  activity = job;
  while (activity.status === "queued" || activity.status === "running") {
    await delay(700);
    activity = await getCheck(activity.id);
    updateActivity();
  }
  updateActivity();
  if (activity.status === "failed") openActivity();
}

async function followDeploy(job: DeployJob): Promise<void> {
  activity = job;
  while (!["passed", "failed"].includes(activity.status)) {
    await delay(900);
    activity = await getDeploy(activity.id);
    updateActivity();
  }
  updateActivity();
  if (activity.status === "failed") openActivity();
}

function updateActivity(): void {
  if (!activity) {
    el.activityStatus.hidden = true;
    updateHeader();
    return;
  }
  el.activityStatus.hidden = false;
  const running = !["passed", "failed"].includes(activity.status);
  el.activityStatus.dataset.status = running ? "running" : activity.status;
  el.activityStatus.textContent = running ? "正在处理…" : activity.status === "passed" ? "检查完成" : "处理失败";
  updateHeader();
}

function openActivity(): void {
  sheet.open("检查与发布", activity ? '<pre class="activity-log">' + escapeHtml(activity.output) + "</pre>" : '<p class="sheet-empty">尚无任务记录。</p>');
}

function openErrorSheet(message: string): void {
  sheet.open("需要处理", '<p class="sheet-hint">' + escapeHtml(message) + "</p>");
}

function renderRecovery(): void {
  el.entryBackup.hidden = !entryRecovery || !current || current.draft.kind === "course";
  if (!el.entryBackup.hidden && entryRecovery) {
    el.entryBackup.querySelector("span")!.textContent = "发现 " + new Date(entryRecovery.at).toLocaleString() + " 的本地草稿。";
  }
  el.structureBackup.hidden = !structureRecovery || !structure;
  if (!el.structureBackup.hidden && structureRecovery) {
    el.structureBackup.querySelector("span")!.textContent = "发现 " + new Date(structureRecovery.at).toLocaleString() + " 的未应用结构调整。";
  }
}

function handleRecovery(action: string): void {
  if (action === "entry-restore" && current && entryRecovery) {
    current.draft = structuredClone(entryRecovery.draft);
    entryRecovery = undefined;
    fillEditor();
    setEntryDirty(true);
  } else if (action === "entry-discard" && current) {
    localStorage.removeItem(entryBackupKey(current.ref));
    entryRecovery = undefined;
    renderRecovery();
  } else if (action === "structure-restore" && structure && structureRecovery) {
    if (restoreStructureBackup(structure, structureRecovery)) {
      structureRecovery = undefined;
      showCourse();
    } else {
      showToast("备份引用了已经不存在的笔记，无法自动恢复。", true);
    }
  } else if (action === "structure-discard" && structure) {
    localStorage.removeItem(structureBackupKey(structure.course.id));
    structureRecovery = undefined;
    renderRecovery();
  }
}

async function allowSwitch(): Promise<boolean> {
  if (!entryDirty && !structure?.dirty) return true;
  const choice = await dialogs.choose(el.switchDialog);
  if (choice === "cancel") return false;
  if (choice === "discard") {
    if (current) localStorage.removeItem(entryBackupKey(current.ref));
    if (structure) localStorage.removeItem(structureBackupKey(structure.course.id));
    return true;
  }
  if (entryDirty && !await saveCurrent()) return false;
  if (structure?.dirty && !await applyStructureDirect()) return false;
  return true;
}

async function reloadCourseStructure(): Promise<void> {
  if (!structure) return;
  const courseId = structure.course.id;
  const desired = {
    chapters: structuredClone(structure.chapters),
    notes: structure.notes.map((note) => ({ id: note.id, chapter: note.chapter, order: note.order })),
  };
  const workspaceRefreshed = await refreshWorkspace();
  if (!workspaceRefreshed) return;
  const course = workspace.courses.find((item) => item.id === courseId);
  if (!course) {
    showToast("课程已经不存在。", true);
    return;
  }
  const rebased = createStructureState(course);
  const chapterIds = new Set(desired.chapters.map((chapter) => chapter.id));
  const missingNotes = desired.notes.filter((saved) => !rebased.notes.some((note) => note.id === saved.id));
  if (missingNotes.length) {
    showToast("有笔记已被移走，不能自动重新应用调整。", true);
    return;
  }
  rebased.chapters = desired.chapters;
  for (const saved of desired.notes) {
    const note = rebased.notes.find((item) => item.id === saved.id);
    if (note && chapterIds.has(saved.chapter)) { note.chapter = saved.chapter; note.order = saved.order; }
  }
  updateStructureDirty(rebased);
  structure = rebased;
  const loaded = await loadEntry({ kind: "course", id: courseId });
  current = { ...loaded, exists: true, original: structuredClone(loaded.draft) };
  sheet.close();
  showCourse();
  showToast("已载入最新目录，请重新审阅调整。");
}

function schedulePreview(): void {
  if (!current || current.draft.kind === "course") return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void updatePreview(), 320);
}

async function updatePreview(): Promise<void> {
  if (!current || current.draft.kind === "course") return;
  syncMainFields();
  if (!current.draft.body.trim()) {
    el.previewEmpty.hidden = false;
    el.previewFrame.hidden = true;
    el.previewErrors.hidden = true;
    return;
  }
  try {
    const result = await renderMarkdown(current.draft.body, current.exists ? current.ref : undefined);
    if (result.diagnostics.length) {
      el.previewErrors.textContent = result.diagnostics.join("\n");
      el.previewErrors.hidden = false;
      el.previewFrame.hidden = true;
      el.previewEmpty.hidden = true;
      return;
    }
    el.previewFrame.srcdoc = previewDocument(result.html);
    el.previewFrame.hidden = false;
    el.previewEmpty.hidden = true;
    el.previewErrors.hidden = true;
  } catch (error) {
    el.previewErrors.textContent = errorText(error);
    el.previewErrors.hidden = false;
    el.previewFrame.hidden = true;
  }
}

async function insertImage(): Promise<void> {
  if (!current?.exists || current.draft.kind === "course" || current.bodyReadOnly) return;
  const file = el.assetFile.files?.[0];
  if (!file) {
    showToast("请选择图片文件。", true);
    return;
  }
  try {
    const result = await uploadImage(current.ref, file);
    const markdown = "![" + (el.assetAlt.value.trim() || result.filename) + "](" + result.markdownPath + ")";
    const start = el.body.selectionStart;
    el.body.setRangeText(markdown, start, el.body.selectionEnd, "end");
    el.body.dispatchEvent(new Event("input", { bubbles: true }));
    el.assetDialog.close();
    el.assetFile.value = "";
    el.assetAlt.value = "";
    showToast("图片已插入。");
  } catch (error) {
    showToast(errorText(error), true);
  }
}

function setEntryDirty(value: boolean): void {
  entryDirty = value;
  if (value && current) {
    window.clearTimeout(backupTimer);
    backupTimer = window.setTimeout(() => { if (current) writeEntryBackup(localStorage, current); }, 300);
  }
  updateHeader();
}

function updateHeader(): void {
  const isBoard = activeSurface === "course" && Boolean(structure);
  const deployBusy = deploymentRunning();
  el.headerParent.textContent = isBoard ? "课程" : current?.draft.kind === "note"
    ? workspace.courses.find((course) => course.id === (current!.draft as Extract<EntryDraft, { kind: "note" }>).course)?.title ?? "课程笔记"
    : current?.draft.kind === "essay" ? "随笔" : "内容工作台";
  el.headerTitle.textContent = current?.draft.title || (isBoard ? structure?.course.title ?? "课程" : "概览");
  const changes = structure?.dirty ? structureChangeCount(structure) : 0;
  el.saveStatus.textContent = busy ? busyLabel : isBoard && changes ? changes + " 项调整" : entryDirty ? "未保存" : "已保存";
  el.saveStatus.classList.toggle("is-dirty", Boolean(changes || entryDirty));
  el.primary.hidden = busy || !(isBoard && changes || entryDirty);
  el.primary.disabled = deployBusy;
  if (!el.primary.hidden) el.primary.textContent = isBoard && changes ? "审阅调整" : "保存";
  const properties = document.querySelector<HTMLButtonElement>("[data-global-action='properties']");
  const outline = document.querySelector<HTMLButtonElement>("[data-global-action='outline']");
  const publish = document.querySelector<HTMLButtonElement>("[data-global-action='publish']");
  const check = document.querySelector<HTMLButtonElement>("[data-global-action='check']");
  const deleteAction = document.querySelector<HTMLButtonElement>("[data-global-action='delete']");
  if (properties) properties.disabled = !current;
  if (outline) outline.disabled = !current || current.draft.kind === "course";
  if (check) check.disabled = deployBusy;
  if (publish) publish.disabled = deployBusy || !current?.exists || current.draft.kind === "course";
  const canDelete = Boolean(current?.exists && current.draft.kind !== "course");
  if (deleteAction) {
    deleteAction.hidden = !canDelete;
    deleteAction.disabled = deployBusy;
  }
  el.deleteSeparator.hidden = !canDelete;
}

function setBusy(value: boolean, label = "正在保存…"): void {
  busy = value;
  busyLabel = label;
  updateHeader();
}

function deploymentRunning(): boolean {
  return Boolean(activity && "sitePath" in activity && activity.status !== "passed" && activity.status !== "failed");
}

function setSidebarCollapsed(collapsed: boolean): void {
  el.shell.classList.toggle("is-sidebar-collapsed", collapsed);
  el.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
  if (window.innerWidth < 1024 && !collapsed) el.backdrop.hidden = false;
  else if (!sheet.isOpen()) el.backdrop.hidden = true;
}

function updateFilterLabels(): void {
  const labels: Record<string, string> = {
    all: "全部 " + workspace.counts.total,
    draft: "草稿 " + workspace.counts.draft,
    published: "已发布 " + workspace.counts.published,
    issues: "待整理 " + workspace.counts.issues,
  };
  for (const option of el.filter.options) option.textContent = labels[option.value];
}

function updateBodyCount(): void {
  el.bodyCount.textContent = Array.from(el.body.value.replace(/\s/g, "")).length + " 字";
}

function updateUrl(values: Record<string, string | undefined>): void {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const query = params.toString();
  history.replaceState(null, "", query ? "/studio?" + query : "/studio");
}

function activeCourseId(): string | undefined {
  if (structure) return structure.course.id;
  return current?.draft.kind === "note" ? current.draft.course : undefined;
}

function nextChapterId(): string {
  const numbers = structure?.chapters.map((chapter) => Number(chapter.id.match(/chapter-(\d+)/)?.[1] ?? -1)) ?? [];
  return "chapter-" + String(Math.max(-1, ...numbers) + 1).padStart(2, "0");
}

function fieldLabel(field: "chapters" | "chapter" | "order"): string {
  return field === "chapters" ? "章节目录" : field === "chapter" ? "所属章节" : "章节内顺序";
}

function formatValue(valueToFormat: unknown): string {
  if (Array.isArray(valueToFormat)) return valueToFormat.map((item) => typeof item === "object" && item && "title" in item ? String((item as { title: unknown }).title) : String(item)).join("、") || "空";
  if (valueToFormat == null || valueToFormat === "") return "空";
  return String(valueToFormat);
}

function value(root: HTMLElement, elementId: string): string {
  return root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("#" + elementId)?.value ?? "";
}

function checked(root: HTMLElement, elementId: string): boolean {
  return root.querySelector<HTMLInputElement>("#" + elementId)?.checked ?? false;
}

function autoSummary(body: string): string {
  return body.replace(/\u0060\u0060\u0060[\s\S]*?\u0060\u0060\u0060/g, " ").replace(/[#>*_\u0060\[\]()$]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function showToast(message: string, isError = false): void {
  el.toast.textContent = message;
  el.toast.className = "toast is-visible" + (isError ? " is-error" : "");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 4200);
}

function readStringArray(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function initializeTheme(): void {
  document.documentElement.dataset.theme = localStorage.getItem("wrain-theme") === "dark" ? "dark" : "light";
}

function id<T extends HTMLElement = HTMLElement>(elementId: string): T {
  const element = document.getElementById(elementId);
  if (!element) throw new Error("Missing #" + elementId);
  return element as T;
}
