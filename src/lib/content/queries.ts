import {
  getCollection,
  getEntry,
  type CollectionEntry,
} from "astro:content";

export type Course = CollectionEntry<"courses">;
export type Note = CollectionEntry<"notes">;
export type Essay = CollectionEntry<"essays">;
export type Article = Note | Essay;

export async function getPublishedNotes(): Promise<Note[]> {
  return byNewest(await getCollection("notes", ({ data }) => !data.draft));
}

export async function getPublishedEssays(): Promise<Essay[]> {
  return byNewest(await getCollection("essays", ({ data }) => !data.draft));
}

export async function getPublishedArticles(): Promise<Article[]> {
  const [notes, essays] = await Promise.all([
    getPublishedNotes(),
    getPublishedEssays(),
  ]);
  return byNewest([...notes, ...essays]);
}

export async function getLatestArticles(limit = 3): Promise<Article[]> {
  return (await getPublishedArticles()).slice(0, limit);
}

export async function getArticlesByTopic(topic: string): Promise<Article[]> {
  return byNewest(
    (await getPublishedArticles()).filter((entry) =>
      entry.data.tags.includes(topic),
    ),
  );
}

export async function getCourseById(id: string): Promise<Course | undefined> {
  return getEntry("courses", id);
}

export async function getCourseNotes(courseId: string): Promise<Note[]> {
  return byNewest(
    (await getPublishedNotes()).filter(
      (note) => note.data.course.id === courseId,
    ),
  );
}

export async function getCourseSummaries() {
  const [courses, notes] = await Promise.all([
    getCollection("courses"),
    getPublishedNotes(),
  ]);

  return courses
    .map((course) => ({
      ...course,
      count: notes.filter((note) => note.data.course.id === course.id).length,
    }))
    .sort((a, b) => a.data.order - b.data.order);
}

export function byNewest<T extends Article>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );
}
