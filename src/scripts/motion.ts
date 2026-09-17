import { withoutBasePath } from "../lib/site-path";

export const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp((value - start) / (end - start));
  return progress * progress * (3 - 2 * progress);
};

export const randomBetween = (minimum: number, maximum: number) =>
  minimum + Math.random() * (maximum - minimum);

export type PageKind = "home" | "archive" | "article" | "utility";
export type RouteMotion = "article-enter" | "article-exit" | "section" | "default";

export function pageKindFromPath(pathname: string): PageKind {
  const segments = withoutBasePath(pathname).split("/").filter(Boolean);
  if (!segments.length) return "home";
  if (segments[0] === "writing") return segments.length === 1 ? "archive" : "article";
  if (segments[0] === "learn") return segments.length <= 2 ? "archive" : "article";
  if (segments[0] === "topics") return "archive";
  return "utility";
}

export function classifyRouteMotion(fromPath: string, toPath: string): RouteMotion {
  const from = pageKindFromPath(fromPath);
  const to = pageKindFromPath(toPath);
  if (from !== "article" && to === "article") return "article-enter";
  if (from === "article" && to !== "article") return "article-exit";
  if (from === "archive" && to === "archive") return "section";
  return "default";
}

export function getActiveHeadingIndex(offsets: number[], readingLine: number): number {
  let active = -1;
  for (let index = 0; index < offsets.length; index += 1) {
    if (offsets[index] > readingLine) break;
    active = index;
  }
  return active;
}

export interface TocHeadingRelation {
  parentSlug: string;
  slug: string;
}

export function getActiveTocState(
  headings: TocHeadingRelation[],
  activeSlug: string,
): { activeSlug: string; parentSlug: string } {
  const current = headings.find((heading) => heading.slug === activeSlug);
  if (!current) return { activeSlug: "", parentSlug: "" };
  return {
    activeSlug: current.slug,
    parentSlug: current.parentSlug === current.slug ? "" : current.parentSlug,
  };
}

export function getReadingProgress(position: number, start: number, end: number): number {
  if (end <= start) return position >= end ? 1 : 0;
  return clamp((position - start) / (end - start));
}
