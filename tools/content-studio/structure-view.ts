import type { CourseChapter, EntryReference } from "./model";
import type { StructureState } from "./workspace-state";

export interface StructureCallbacks {
  addChapter(): void;
  openNote(ref: EntryReference): void;
  renameChapter(chapter: CourseChapter): void;
  moveChapter(chapterId: string, offset: number): void;
  mergeChapter(chapterId: string): void;
  deleteChapter(chapterId: string): void;
  moveNote(noteId: string, offset: number): void;
  chooseNoteChapter(noteIds: string[]): void;
  dropChapter(chapterId: string, targetId: string): void;
  dropNote(noteId: string, targetChapter: string, targetIndex: number): void;
  toggleSelection(noteId: string): void;
  enterSelection(): void;
  cancelSelection(): void;
}

export function renderStructure(container: HTMLElement, state: StructureState, callbacks: StructureCallbacks): void {
  const chapterIds = new Set(state.chapters.map((chapter) => chapter.id));
  const unfiled = state.notes.filter((note) => !chapterIds.has(note.chapter));
  const sections = [
    ...(unfiled.length ? [unfiledSection(unfiled, state)] : []),
    ...state.chapters.map((chapter, index) => chapterSection(chapter, index, state)),
  ];
  container.innerHTML = `${sections.join("") || '<div class="structure-empty"><p>还没有章节。</p><button type="button" data-structure-action="add-chapter">新增第一个章节</button></div>'}
    ${state.selectionMode ? `<div class="selection-bar"><span>已选择 ${state.selected.size} 篇</span><button type="button" data-structure-action="move-selected" ${state.selected.size ? "" : "disabled"}>移动到章节</button><button type="button" data-structure-action="cancel-selection">完成</button></div>` : ""}`;

  container.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-structure-action]");
    if (!target) return;
    const chapter = target.closest<HTMLElement>("[data-chapter]")?.dataset.chapter;
    const note = target.closest<HTMLElement>("[data-note]")?.dataset.note;
    closeMenu(target);
    switch (target.dataset.structureAction) {
      case "add-chapter": callbacks.addChapter(); break;
      case "open-note": if (note) callbacks.openNote(noteRef(state, note)); break;
      case "rename-chapter": if (chapter) callbacks.renameChapter(state.chapters.find((item) => item.id === chapter)!); break;
      case "chapter-up": if (chapter) callbacks.moveChapter(chapter, -1); break;
      case "chapter-down": if (chapter) callbacks.moveChapter(chapter, 1); break;
      case "merge-chapter": if (chapter) callbacks.mergeChapter(chapter); break;
      case "delete-chapter": if (chapter) callbacks.deleteChapter(chapter); break;
      case "note-up": if (note) callbacks.moveNote(note, -1); break;
      case "note-down": if (note) callbacks.moveNote(note, 1); break;
      case "move-note": if (note) callbacks.chooseNoteChapter([note]); break;
      case "select-mode": callbacks.enterSelection(); break;
      case "move-selected": callbacks.chooseNoteChapter([...state.selected]); break;
      case "cancel-selection": callbacks.cancelSelection(); break;
    }
  };
  container.onchange = (event) => {
    const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("[data-select-note]");
    if (checkbox?.dataset.selectNote) callbacks.toggleSelection(checkbox.dataset.selectNote);
  };
  bindDragging(container, callbacks);
}

function chapterSection(chapter: CourseChapter, index: number, state: StructureState): string {
  const notes = state.notes.filter((note) => note.chapter === chapter.id).sort(noteOrder);
  return `<section class="outline-chapter" data-chapter="${escapeHtml(chapter.id)}">
    <header class="outline-chapter-row" draggable="true">
      <span class="drag-handle" aria-hidden="true">⋮⋮</span>
      <div class="chapter-label"><span>${escapeHtml(chapter.title)}</span><small>${notes.length} 篇</small></div>
      <details class="row-menu"><summary aria-label="${escapeHtml(chapter.title)}更多操作">···</summary><div class="menu-popover">
        <button type="button" data-structure-action="rename-chapter">重命名</button>
        <button type="button" data-structure-action="chapter-up" ${index === 0 ? "disabled" : ""}>上移</button>
        <button type="button" data-structure-action="chapter-down" ${index === state.chapters.length - 1 ? "disabled" : ""}>下移</button>
        <button type="button" data-structure-action="merge-chapter">合并到…</button>
        <button type="button" data-structure-action="delete-chapter" class="danger-action">删除章节</button>
      </div></details>
    </header>
    <div class="outline-notes" data-drop-chapter="${escapeHtml(chapter.id)}">${notes.map((note, noteIndex) => noteRow(note, noteIndex, notes.length, state)).join("") || '<p class="empty-chapter">空章节</p>'}</div>
  </section>`;
}

function unfiledSection(notes: StructureState["notes"], state: StructureState): string {
  return `<section class="outline-chapter is-unfiled" data-chapter="__unfiled"><header class="outline-chapter-row"><span class="warning-mark">!</span><div class="unfiled-title"><strong>待整理</strong><small>${notes.length} 篇笔记没有有效章节</small></div></header><div class="outline-notes">${notes.map((note, index) => noteRow(note, index, notes.length, state)).join("")}</div></section>`;
}

function noteRow(note: StructureState["notes"][number], index: number, length: number, state: StructureState): string {
  const checked = state.selected.has(note.id);
  const status = note.issues.length || note.draft
    ? `<i class="status-dot ${note.issues.length ? "has-issues" : "is-draft"}" title="${note.issues.length ? "待整理" : "草稿"}"></i>`
    : "";
  return `<div class="outline-note" data-note="${escapeHtml(note.id)}" draggable="${note.chapter ? "true" : "false"}">
    ${state.selectionMode ? `<input type="checkbox" data-select-note="${escapeHtml(note.id)}" aria-label="选择${escapeHtml(note.title)}" ${checked ? "checked" : ""}>` : '<span class="drag-handle" aria-hidden="true">⋮</span>'}
    <button class="outline-note-title" type="button" data-structure-action="open-note">${escapeHtml(note.title || note.id)}</button>
    ${status}
    <details class="row-menu"><summary aria-label="${escapeHtml(note.title)}更多操作">···</summary><div class="menu-popover">
      <button type="button" data-structure-action="note-up" ${index === 0 ? "disabled" : ""}>上移</button>
      <button type="button" data-structure-action="note-down" ${index === length - 1 ? "disabled" : ""}>下移</button>
      <button type="button" data-structure-action="move-note">移动到章节…</button>
      ${state.selectionMode ? "" : '<button type="button" data-structure-action="select-mode">选择多篇</button>'}
    </div></details>
  </div>`;
}

function bindDragging(container: HTMLElement, callbacks: StructureCallbacks): void {
  container.ondragstart = (event) => {
    const chapter = (event.target as HTMLElement).closest<HTMLElement>(".outline-chapter-row[draggable='true']")?.closest<HTMLElement>("[data-chapter]");
    const note = (event.target as HTMLElement).closest<HTMLElement>(".outline-note[draggable='true']");
    if (note?.dataset.note) event.dataTransfer?.setData("application/x-studio-note", note.dataset.note);
    else if (chapter?.dataset.chapter) event.dataTransfer?.setData("application/x-studio-chapter", chapter.dataset.chapter);
    event.dataTransfer && (event.dataTransfer.effectAllowed = "move");
  };
  container.ondragover = (event) => {
    if ((event.target as HTMLElement).closest("[data-chapter], [data-note]")) event.preventDefault();
  };
  container.ondrop = (event) => {
    event.preventDefault();
    const targetChapter = (event.target as HTMLElement).closest<HTMLElement>("[data-chapter]")?.dataset.chapter;
    if (!targetChapter || targetChapter === "__unfiled") return;
    const chapterId = event.dataTransfer?.getData("application/x-studio-chapter");
    if (chapterId) { callbacks.dropChapter(chapterId, targetChapter); return; }
    const noteId = event.dataTransfer?.getData("application/x-studio-note");
    if (!noteId) return;
    const targetNote = (event.target as HTMLElement).closest<HTMLElement>("[data-note]")?.dataset.note;
    const notes = [...container.querySelectorAll<HTMLElement>(`[data-chapter="${CSS.escape(targetChapter)}"] [data-note]`)];
    const targetIndex = targetNote ? Math.max(0, notes.findIndex((item) => item.dataset.note === targetNote)) : notes.length;
    callbacks.dropNote(noteId, targetChapter, targetIndex);
  };
}

function noteRef(state: StructureState, id: string): EntryReference {
  return { kind: "note", id, course: state.course.id };
}

function noteOrder(a: { order: number; pubDate: string; id: string }, b: { order: number; pubDate: string; id: string }): number {
  return a.order - b.order || b.pubDate.localeCompare(a.pubDate) || a.id.localeCompare(b.id);
}

function closeMenu(target: HTMLElement): void {
  const menu = target.closest<HTMLDetailsElement>("details.row-menu");
  if (menu) menu.open = false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
