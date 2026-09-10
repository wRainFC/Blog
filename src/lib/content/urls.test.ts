import { describe, expect, it } from "vitest";
import { articleHref, articleMotionId, courseHref, topicHref } from "./urls";
import type { Article } from "./queries";

const essay = (id: string): Article =>
  ({ id, collection: "essays", data: {} }) as Article;

const note = (id: string, courseId: string): Article =>
  ({ id, collection: "notes", data: { course: { id: courseId } } }) as Article;

describe("courseHref", () => {
  it("maps a course id to its learn route", () => {
    expect(courseHref("data-structures")).toBe("/learn/data-structures");
  });

  it("encodes unsafe characters", () => {
    expect(courseHref("a b")).toBe("/learn/a%20b");
  });
});

describe("articleHref", () => {
  it("routes essays under /writing", () => {
    expect(articleHref(essay("learning-slowly"))).toBe("/writing/learning-slowly");
  });

  it("routes notes with a course-prefixed id", () => {
    expect(articleHref(note("data-structures/binary-search-tree", "data-structures")))
      .toBe("/learn/data-structures/binary-search-tree");
  });

  it("prepends the course segment when the note id lacks it", () => {
    expect(articleHref(note("binary-search-tree", "data-structures")))
      .toBe("/learn/data-structures/binary-search-tree");
  });
});

describe("topicHref", () => {
  it("encodes the topic into the topics route", () => {
    expect(topicHref("树")).toBe("/topics/%E6%A0%91");
  });
});

describe("articleMotionId", () => {
  it("returns a stable CSS-safe name", () => {
    expect(articleMotionId(essay("learning-slowly"))).toMatch(/^article-[a-z0-9]+$/);
    expect(articleMotionId(essay("learning-slowly")))
      .toBe(articleMotionId(essay("learning-slowly")));
  });

  it("distinguishes collections and non-Latin ids", () => {
    expect(articleMotionId(essay("数据结构")))
      .not.toBe(articleMotionId(note("数据结构", "data-structures")));
  });
});
