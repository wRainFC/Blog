import type {
  ArticleSummary,
  CourseChapter,
  EditorEntry,
  EntryDraft,
  EntryReference,
  StructurePreviewRequest,
  WorkspaceCourse,
} from "./model";

export type WorkingEntry = EditorEntry & { exists: boolean; original: EntryDraft };
export type StructureNote = ArticleSummary & {
  chapter: string;
  order: number;
  originalChapter: string;
  originalOrder: number;
};
export interface StructureState {
  course: WorkspaceCourse;
  chapters: CourseChapter[];
  originalChapters: CourseChapter[];
  notes: StructureNote[];
  selected: Set<string>;
  selectionMode: boolean;
  dirty: boolean;
}

interface EntryBackup { version: 2; baseRevision: string; draft: EntryDraft; at: string }
interface StructureBackup {
  version: 2;
  baseRevision: string;
  chapters: CourseChapter[];
  notes: Array<{ id: string; chapter: string; order: number }>;
  at: string;
}

export function createStructureState(course: WorkspaceCourse): StructureState {
  const notes = [...course.chapters.flatMap((chapter) => chapter.notes), ...course.unfiled]
    .map((note) => ({
      ...note,
      chapter: note.chapter ?? "",
      order: note.order ?? 0,
      originalChapter: note.chapter ?? "",
      originalOrder: note.order ?? 0,
    }));
  const chapters = course.chapters.map(({ id, title }) => ({ id, title }));
  return {
    course,
    chapters: structuredClone(chapters),
    originalChapters: structuredClone(chapters),
    notes,
    selected: new Set(),
    selectionMode: false,
    dirty: false,
  };
}

export function normalizeOrders(state: StructureState): void {
  for (const chapter of state.chapters) {
    state.notes
      .filter((note) => note.chapter === chapter.id)
      .sort(noteOrder)
      .forEach((note, index) => { note.order = index; });
  }
}

export function updateStructureDirty(state: StructureState): void {
  normalizeOrders(state);
  state.dirty = JSON.stringify(state.chapters) !== JSON.stringify(state.originalChapters)
    || state.notes.some((note) => note.chapter !== note.originalChapter || note.order !== note.originalOrder);
}

export function moveChapter(state: StructureState, chapterId: string, toIndex: number): void {
  const from = state.chapters.findIndex((chapter) => chapter.id === chapterId);
  if (from < 0) return;
  const bounded = Math.max(0, Math.min(toIndex, state.chapters.length - 1));
  if (from === bounded) return;
  const [chapter] = state.chapters.splice(from, 1);
  state.chapters.splice(bounded, 0, chapter);
  updateStructureDirty(state);
}

export function moveNotes(
  state: StructureState,
  ids: string[],
  targetChapter: string,
  toIndex = Number.MAX_SAFE_INTEGER,
): void {
  if (!state.chapters.some((chapter) => chapter.id === targetChapter)) return;
  const moving = state.notes.filter((note) => ids.includes(note.id));
  if (!moving.length) return;
  const remaining = state.notes
    .filter((note) => note.chapter === targetChapter && !ids.includes(note.id))
    .sort(noteOrder);
  const bounded = Math.max(0, Math.min(toIndex, remaining.length));
  remaining.splice(bounded, 0, ...moving);
  moving.forEach((note) => { note.chapter = targetChapter; });
  remaining.forEach((note, index) => { note.order = index; });
  updateStructureDirty(state);
}

export function structureChangeCount(state: StructureState): number {
  const chapterChanged = JSON.stringify(state.chapters) === JSON.stringify(state.originalChapters) ? 0 : 1;
  return chapterChanged + state.notes.filter((note) => note.chapter !== note.originalChapter || note.order !== note.originalOrder).length;
}

export function structurePreviewPayload(state: StructureState): StructurePreviewRequest {
  normalizeOrders(state);
  return {
    courseId: state.course.id,
    expectedStructureRevision: state.course.structureRevision,
    chapters: state.chapters,
    notes: state.notes.map((note) => ({
      ref: { kind: "note", id: note.id, course: state.course.id },
      chapter: note.chapter,
      order: note.order,
    })),
  };
}

export function entryBackupKey(ref: EntryReference): string {
  return `content-studio:entry:${ref.kind}:${ref.course ?? ""}:${ref.id || "new"}`;
}

export function structureBackupKey(courseId: string): string {
  return `content-studio:structure:${courseId}`;
}

export function writeEntryBackup(storage: Storage, entry: WorkingEntry): void {
  const backup: EntryBackup = {
    version: 2,
    baseRevision: entry.revision,
    draft: entry.draft,
    at: new Date().toISOString(),
  };
  storage.setItem(entryBackupKey(entry.ref), JSON.stringify(backup));
}

export function readEntryBackup(storage: Storage, ref: EntryReference): EntryBackup | undefined {
  const raw = storage.getItem(entryBackupKey(ref));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<EntryBackup> & { draft?: EntryDraft; at?: string };
    if (!parsed.draft || !parsed.at) return undefined;
    return {
      version: 2,
      baseRevision: typeof parsed.baseRevision === "string" ? parsed.baseRevision : "",
      draft: parsed.draft,
      at: parsed.at,
    };
  } catch {
    return undefined;
  }
}

export function writeStructureBackup(storage: Storage, state: StructureState): void {
  const backup: StructureBackup = {
    version: 2,
    baseRevision: state.course.structureRevision,
    chapters: state.chapters,
    notes: state.notes.map((note) => ({ id: note.id, chapter: note.chapter, order: note.order })),
    at: new Date().toISOString(),
  };
  storage.setItem(structureBackupKey(state.course.id), JSON.stringify(backup));
}

export function readStructureBackup(storage: Storage, courseId: string): StructureBackup | undefined {
  const raw = storage.getItem(structureBackupKey(courseId));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<StructureBackup>;
    if (!Array.isArray(parsed.chapters) || !Array.isArray(parsed.notes) || !parsed.at) return undefined;
    return {
      version: 2,
      baseRevision: typeof parsed.baseRevision === "string" ? parsed.baseRevision : "",
      chapters: parsed.chapters,
      notes: parsed.notes,
      at: parsed.at,
    };
  } catch {
    return undefined;
  }
}

export function restoreStructureBackup(state: StructureState, backup: StructureBackup): boolean {
  const availableNotes = new Set(state.notes.map((note) => note.id));
  if (backup.notes.some((note) => !availableNotes.has(note.id))) return false;
  state.chapters = structuredClone(backup.chapters);
  for (const saved of backup.notes) {
    const note = state.notes.find((item) => item.id === saved.id);
    if (note) { note.chapter = saved.chapter; note.order = saved.order; }
  }
  updateStructureDirty(state);
  return true;
}

export function sameRef(a: EntryReference, b: EntryReference): boolean {
  return a.kind === b.kind && a.id === b.id && a.course === b.course;
}

export function refFor(article: ArticleSummary): EntryReference {
  return article.kind === "note"
    ? { kind: "note", id: article.id, course: article.course }
    : { kind: "essay", id: article.id };
}

function noteOrder(a: { order?: number; pubDate: string; id: string }, b: { order?: number; pubDate: string; id: string }): number {
  return (a.order ?? 0) - (b.order ?? 0) || b.pubDate.localeCompare(a.pubDate) || a.id.localeCompare(b.id);
}
