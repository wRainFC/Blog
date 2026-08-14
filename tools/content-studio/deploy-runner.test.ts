import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedPublishPath,
  parseStatusPaths,
  publishPaths,
} from "./deploy-runner";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deploy safety", () => {
  it("parses tracked and untracked porcelain paths", () => {
    expect(parseStatusPaths(
      " M src/content/essays/hello.md\0?? src/content/essays/assets/hello/cover.png\0",
    )).toEqual([
      "src/content/essays/hello.md",
      "src/content/essays/assets/hello/cover.png",
    ]);
  });

  it("only accepts the article and its asset directory", () => {
    const allowed = [
      "src/content/essays/hello.md",
      "src/content/essays/assets/hello",
    ];
    expect(isAllowedPublishPath("src/content/essays/hello.md", allowed)).toBe(true);
    expect(isAllowedPublishPath("src/content/essays/assets/hello/cover.png", allowed)).toBe(true);
    expect(isAllowedPublishPath("src/pages/index.astro", allowed)).toBe(false);
  });

  it("includes the referenced course when publishing a note", async () => {
    const root = await mkdtemp(join(tmpdir(), "yanbian-deploy-"));
    roots.push(root);
    const courseDir = join(root, "src", "content", "courses");
    await mkdir(courseDir, { recursive: true });
    await writeFile(join(courseDir, "math.yaml"), "title: 数学\n", "utf8");

    await expect(publishPaths(root, {
      ref: { kind: "note", id: "limits", course: "math" },
      repoPath: "src/content/notes/math/limits.md",
      sitePath: "/learn/math/limits/",
      title: "极限",
    })).resolves.toEqual([
      "src/content/notes/math/limits.md",
      "src/content/notes/math/assets/limits",
      "src/content/courses/math.yaml",
    ]);
  });
});
