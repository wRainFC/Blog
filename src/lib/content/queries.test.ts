import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCollection: vi.fn(),
  getEntry: vi.fn(),
}));

vi.mock("astro:content", () => ({
  getCollection: mocks.getCollection,
  getEntry: mocks.getEntry,
}));

import {
  byNewest,
  getArticlesByTopic,
  getCourseNotes,
  getCourseSummaries,
  getLatestArticles,
  getPublishedArticles,
  getPublishedEssays,
  getPublishedNotes,
} from "./queries";

interface FakeEntry {
  id: string;
  collection: string;
  data: Record<string, any>;
}

const note = (id: string, overrides: Record<string, any> = {}): FakeEntry => ({
  id,
  collection: "notes",
  data: {
    title: id,
    summary: "摘要",
    pubDate: new Date("2026-01-01"),
    tags: [],
    draft: false,
    course: { id: "course-a" },
    ...overrides,
  },
});

const essay = (id: string, overrides: Record<string, any> = {}): FakeEntry => ({
  id,
  collection: "essays",
  data: {
    title: id,
    summary: "摘要",
    pubDate: new Date("2026-01-01"),
    tags: [],
    draft: false,
    ...overrides,
  },
});

const course = (id: string, overrides: Record<string, any> = {}): FakeEntry => ({
  id,
  collection: "courses",
  data: { title: id, semester: "春", order: 0, ...overrides },
});

function given(collections: Record<string, FakeEntry[]>) {
  mocks.getCollection.mockImplementation(async (name: string, filter?: (entry: any) => boolean) => {
    const items = collections[name] ?? [];
    return filter ? items.filter(filter) : [...items];
  });
  mocks.getEntry.mockImplementation(async (name: string, id: string) =>
    (collections[name] ?? []).find((entry) => entry.id === id),
  );
}

beforeEach(() => {
  mocks.getCollection.mockReset();
  mocks.getEntry.mockReset();
});

describe("byNewest", () => {
  it("sorts entries by pubDate descending without mutating input", () => {
    const items = [
      essay("a", { pubDate: new Date("2026-01-01") }),
      essay("b", { pubDate: new Date("2026-03-01") }),
      essay("c", { pubDate: new Date("2026-02-01") }),
    ];
    const sorted = byNewest(items as any);
    expect(sorted.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("getPublishedNotes", () => {
  it("filters drafts and returns newest first", async () => {
    given({
      notes: [
        note("n1", { pubDate: new Date("2026-01-01") }),
        note("n2", { pubDate: new Date("2026-05-01") }),
        note("n3", { pubDate: new Date("2026-03-01"), draft: true }),
      ],
    });
    const notes = await getPublishedNotes();
    expect(notes.map((entry) => entry.id)).toEqual(["n2", "n1"]);
  });
});

describe("getPublishedEssays", () => {
  it("excludes drafts", async () => {
    given({
      essays: [
        essay("e1", { draft: false }),
        essay("e2", { draft: true }),
      ],
    });
    const essays = await getPublishedEssays();
    expect(essays.map((entry) => entry.id)).toEqual(["e1"]);
  });
});

describe("getPublishedArticles", () => {
  it("merges notes and essays, sorted by date", async () => {
    given({
      notes: [note("n1", { pubDate: new Date("2026-02-01") })],
      essays: [essay("e1", { pubDate: new Date("2026-04-01") })],
    });
    const articles = await getPublishedArticles();
    expect(articles.map((entry) => entry.id)).toEqual(["e1", "n1"]);
  });
});

describe("getLatestArticles", () => {
  it("limits the result to the newest N entries", async () => {
    given({
      notes: [
        note("n1", { pubDate: new Date("2026-01-01") }),
        note("n2", { pubDate: new Date("2026-02-01") }),
        note("n3", { pubDate: new Date("2026-03-01") }),
      ],
    });
    const latest = await getLatestArticles(2);
    expect(latest.map((entry) => entry.id)).toEqual(["n3", "n2"]);
  });
});

describe("getArticlesByTopic", () => {
  it("returns only entries carrying the topic tag", async () => {
    given({
      notes: [note("n1", { tags: ["算法"] })],
      essays: [essay("e1", { tags: ["算法", "生活"] }), essay("e2", { tags: ["其他"] })],
    });
    const articles = await getArticlesByTopic("算法");
    expect(articles.map((entry) => entry.id).sort()).toEqual(["e1", "n1"]);
  });
});

describe("getCourseNotes", () => {
  it("filters notes by course id", async () => {
    given({
      notes: [
        note("n1", { course: { id: "course-a" } }),
        note("n2", { course: { id: "course-b" } }),
        note("n3", { course: { id: "course-a" }, draft: true }),
      ],
    });
    const notes = await getCourseNotes("course-a");
    expect(notes.map((entry) => entry.id)).toEqual(["n1"]);
  });
});

describe("getCourseSummaries", () => {
  it("counts published notes per course and sorts by order", async () => {
    given({
      courses: [
        course("course-a", { order: 2 }),
        course("course-b", { order: 1 }),
      ],
      notes: [
        note("n1", { course: { id: "course-a" } }),
        note("n2", { course: { id: "course-a" } }),
        note("n3", { course: { id: "course-b" } }),
        note("n4", { course: { id: "course-a" }, draft: true }),
      ],
    });
    const summaries = await getCourseSummaries();
    expect(summaries.map((summary) => [summary.id, summary.count])).toEqual([
      ["course-b", 1],
      ["course-a", 2],
    ]);
  });
});
