import { getCollection, getEntry, type CollectionEntry } from "astro:content";

export type Course = CollectionEntry<"courses">;
export type Note = CollectionEntry<"notes">;
export type Essay = CollectionEntry<"essays">;
export type Article = Note | Essay;
export type CourseOutlineGroup = { id: string; title: string; notes: Note[] };

export type CourseNavigationItem = { note: Note; chapterTitle: string };
export type CourseNavigation = {
  previous?: CourseNavigationItem;
  next?: CourseNavigationItem;
};
export type TopicSummary = { tag: string; count: number; latestDate: Date };

export async function getPublishedNotes(): Promise<Note[]> {
  const [notes, courses] = await Promise.all([getCollection("notes"), getCollection("courses")]);
  assertNoteStructure(notes, courses);
  return byNewest(notes.filter((note) => !note.data.draft));
}

export async function getPublishedEssays(): Promise<Essay[]> {
  return byNewest(await getCollection("essays", ({ data }) => !data.draft));
}

export async function getPublishedArticles(): Promise<Article[]> {
  const [notes, essays] = await Promise.all([getPublishedNotes(), getPublishedEssays()]);
  return byNewest([...notes, ...essays]);
}

export async function getLatestArticles(limit = 3): Promise<Article[]> {
  return (await getPublishedArticles()).slice(0, limit);
}

export async function getArticlesByTopic(topic: string): Promise<Article[]> {
  return byNewest((await getPublishedArticles()).filter((entry) => entry.data.tags.includes(topic)));
}

export async function getRelatedArticles(article: Article, limit = 5): Promise<Article[]> {
  if (limit <= 0) return [];
  const candidates = (await getPublishedArticles()).filter((entry) => entry.id !== article.id || entry.collection !== article.collection);
  const currentTags = new Set(article.data.tags);
  const related = candidates.map((entry) => {
    const sharedTags = entry.data.tags.reduce((count, tag) => count + (currentTags.has(tag) ? 1 : 0), 0);
    const sameCourse = isNote(article) && isNote(entry) && article.data.course.id === entry.data.course.id;
    const sameChapter = sameCourse && article.data.chapter === entry.data.chapter;
    const score = (sameChapter ? 8 : 0) + (sameCourse ? 4 : 0) + sharedTags * 2;
    return { entry, score };
  });

  return related
    .sort((a, b) => b.score - a.score || effectiveDate(b.entry).getTime() - effectiveDate(a.entry).getTime()
      || b.entry.data.pubDate.getTime() - a.entry.data.pubDate.getTime() || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export async function getTopicSummaries(): Promise<TopicSummary[]> {
  const summaries = new Map<string, TopicSummary>();
  for (const entry of await getPublishedArticles()) {
    for (const tag of entry.data.tags) {
      const existing = summaries.get(tag);
      const latestDate = effectiveDate(entry);
      if (!existing) summaries.set(tag, { tag, count: 1, latestDate });
      else {
        existing.count += 1;
        if (latestDate > existing.latestDate) existing.latestDate = latestDate;
      }
    }
  }
  return [...summaries.values()].sort((a, b) => b.count - a.count
    || b.latestDate.getTime() - a.latestDate.getTime() || a.tag.localeCompare(b.tag));
}

export async function getCourseById(id: string): Promise<Course | undefined> {
  return getEntry("courses", id);
}

export function resolveCourseChapter(course: Course, note: Note): { id: string; title: string } {
  if (note.data.course.id !== course.id) throw new Error(`笔记“${note.id}”不属于课程“${course.id}”。`);
  const chapter = course.data.chapters.find((candidate) => candidate.id === note.data.chapter);
  if (!chapter) throw new Error(`笔记“${note.id}”引用了课程“${course.id}”中不存在的章节“${note.data.chapter}”。`);
  return chapter;
}

export async function getCourseOutline(courseId: string): Promise<CourseOutlineGroup[]> {
  const course = await getCourseById(courseId);
  if (!course) return [];
  const notes = (await getPublishedNotes()).filter((note) => note.data.course.id === courseId);
  return course.data.chapters.flatMap((chapter) => {
    const chapterNotes = notes.filter((note) => note.data.chapter === chapter.id).sort(byChapterOrder);
    return chapterNotes.length ? [{ ...chapter, notes: chapterNotes }] : [];
  });
}

export async function getCourseNotes(courseId: string): Promise<Note[]> {
  return (await getCourseOutline(courseId)).flatMap((chapter) => chapter.notes);
}

export function getCourseNavigation(outline: CourseOutlineGroup[], noteId: string): CourseNavigation {
  const notes = outline.flatMap((chapter) => chapter.notes.map((note) => ({ note, chapterTitle: chapter.title })));
  const index = notes.findIndex((item) => item.note.id === noteId);
  if (index < 0) return {};
  return { previous: notes[index - 1], next: notes[index + 1] };
}

export async function getCourseSummaries() {
  const [courses, notes] = await Promise.all([getCollection("courses"), getPublishedNotes()]);
  return courses.map((course) => ({ ...course, count: notes.filter((note) => note.data.course.id === course.id).length }))
    .sort((a, b) => a.data.order - b.data.order);
}

export async function getChapterTitleMap(): Promise<Map<string, string>> {
  const courses = await getCollection("courses");
  return new Map(courses.flatMap((course) => course.data.chapters.map((chapter) => [`${course.id}:${chapter.id}`, chapter.title] as const)));
}

export function byNewest<T extends Article>(items: T[]): T[] {
  return [...items].sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id));
}

export function effectiveDate(entry: Article): Date {
  return entry.data.updated ?? entry.data.pubDate;
}

function byChapterOrder(a: Note, b: Note): number {
  return a.data.order - b.data.order || b.data.pubDate.getTime() - a.data.pubDate.getTime() || a.id.localeCompare(b.id);
}

function isNote(entry: Article): entry is Note {
  return entry.collection === "notes";
}

function assertNoteStructure(notes: Note[], courses: Course[]): void {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  for (const course of courses) {
    const ids = new Set<string>();
    for (const chapter of course.data.chapters) {
      if (ids.has(chapter.id)) throw new Error(`课程“${course.id}”存在重复章节 ID“${chapter.id}”。`);
      ids.add(chapter.id);
    }
  }
  const orders = new Map<string, string>();
  for (const note of notes) {
    const course = courseMap.get(note.data.course.id);
    if (!course) throw new Error(`笔记“${note.id}”引用了不存在的课程“${note.data.course.id}”。`);
    resolveCourseChapter(course, note);
    const key = `${course.id}:${note.data.chapter}:${note.data.order}`;
    const previous = orders.get(key);
    if (previous) throw new Error(`课程“${course.id}”的章节“${note.data.chapter}”中，笔记“${previous}”与“${note.id}”使用了重复顺序 ${note.data.order}。`);
    orders.set(key, note.id);
  }
}
