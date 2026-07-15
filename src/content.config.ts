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

const courses = defineCollection({
  loader: glob({ base: "./src/content/courses", pattern: "**/*.{yaml,yml}" }),
  schema: z.object({
    title: z.string(),
    semester: z.string(),
    description: z.string().optional(),
    order: z.number().default(0),
  }),
});

const notes = defineCollection({
  loader: glob({ base: "./src/content/notes", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    ...shared,
    course: reference("courses"),
    chapter: z.string(),
  }),
});

const essays = defineCollection({
  loader: glob({ base: "./src/content/essays", pattern: "**/*.{md,mdx}" }),
  schema: z.object({ ...shared, featured: z.boolean().default(false) }),
});

export const collections = { courses, notes, essays };
