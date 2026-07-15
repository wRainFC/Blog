import type { Article } from "./queries";

export function courseHref(courseId: string): string {
  return `/learn/${encodeURIComponent(courseId)}`;
}

export function articleHref(entry: Article): string {
  if (entry.collection === "essays") {
    return `/writing/${entry.id}`;
  }

  const courseId = entry.data.course.id;
  const prefix = `${courseId}/`;
  const slug = entry.id.startsWith(prefix)
    ? entry.id.slice(prefix.length)
    : entry.id;

  return `${courseHref(courseId)}/${slug}`;
}

export function topicHref(topic: string): string {
  return `/topics/${encodeURIComponent(topic)}`;
}
