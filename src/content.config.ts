import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const shared = {
  title: z.string(),
  summary: z.string(),
  pubDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
};

const chapterId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "章节 ID 必须是小写 kebab-case");
const courseChapter = z.object({ id: chapterId, title: z.string().min(1).max(80) });

const courses = defineCollection({
  loader: glob({ base: "./src/content/courses", pattern: "**/*.{yaml,yml}" }),
  schema: z.object({
    title: z.string(),
    semester: z.string(),
    description: z.string().optional(),
    order: z.number().default(0),
    chapters: z.array(courseChapter).default([]).superRefine((chapters, context) => {
      const ids = new Set<string>();
      chapters.forEach((chapter, index) => {
        if (ids.has(chapter.id)) context.addIssue({ code: "custom", message: `章节 ID“${chapter.id}”重复`, path: [index, "id"] });
        ids.add(chapter.id);
      });
    }),
  }),
});

const notes = defineCollection({
  loader: glob({ base: "./src/content/notes", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    ...shared,
    course: reference("courses"),
    chapter: chapterId,
    order: z.number().int().nonnegative(),
  }),
});

const essays = defineCollection({
  loader: glob({ base: "./src/content/essays", pattern: "**/*.{md,mdx}" }),
  schema: z.object({ ...shared, featured: z.boolean().default(false) }),
});

export const collections = { courses, notes, essays };
