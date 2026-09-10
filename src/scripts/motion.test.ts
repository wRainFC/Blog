import { describe, expect, it } from "vitest";
import {
  classifyRouteMotion,
  getActiveHeadingIndex,
  getActiveTocState,
  getReadingProgress,
  pageKindFromPath,
} from "./motion";

describe("page motion", () => {
  it("classifies route kinds", () => {
    expect(pageKindFromPath("/")).toBe("home");
    expect(pageKindFromPath("/learn")).toBe("archive");
    expect(pageKindFromPath("/learn/data-structures")).toBe("archive");
    expect(pageKindFromPath("/learn/data-structures/tree")).toBe("article");
    expect(pageKindFromPath("/writing/a-note")).toBe("article");
    expect(pageKindFromPath("/about")).toBe("utility");
  });

  it("chooses semantic transitions", () => {
    expect(classifyRouteMotion("/writing", "/writing/a-note")).toBe("article-enter");
    expect(classifyRouteMotion("/writing/a-note", "/writing")).toBe("article-exit");
    expect(classifyRouteMotion("/writing", "/learn")).toBe("section");
    expect(classifyRouteMotion("/", "/about")).toBe("default");
  });
});

describe("reading position", () => {
  it("selects the latest heading above the reading line", () => {
    expect(getActiveHeadingIndex([200, 480, 900], 199)).toBe(-1);
    expect(getActiveHeadingIndex([200, 480, 900], 480)).toBe(1);
    expect(getActiveHeadingIndex([200, 480, 900], 1200)).toBe(2);
  });

  it("keeps the parent h2 weakly active for an active h3", () => {
    const headings = [
      { slug: "chapter", parentSlug: "chapter" },
      { slug: "detail", parentSlug: "chapter" },
    ];
    expect(getActiveTocState(headings, "chapter")).toEqual({
      activeSlug: "chapter",
      parentSlug: "",
    });
    expect(getActiveTocState(headings, "detail")).toEqual({
      activeSlug: "detail",
      parentSlug: "chapter",
    });
  });

  it("clamps reading progress and handles short ranges", () => {
    expect(getReadingProgress(50, 100, 500)).toBe(0);
    expect(getReadingProgress(300, 100, 500)).toBe(.5);
    expect(getReadingProgress(700, 100, 500)).toBe(1);
    expect(getReadingProgress(10, 10, 10)).toBe(1);
  });
});
