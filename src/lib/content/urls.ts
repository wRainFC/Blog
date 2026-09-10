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

export function articleMotionId(entry: Article): string {
  const source = `${entry.collection}:${entry.id}`;
  let hash = 0x811c9dc5;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `article-${(hash >>> 0).toString(36)}`;
}

export function topicHref(topic: string): string {
  return `/topics/${encodeURIComponent(topic)}`;
}
