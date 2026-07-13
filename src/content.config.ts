import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const shared = {
  title: z.string(),
  summary: z.string(),
  pubDate: z.coerce.date(),
  updated: z.coerce.date().optional(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
};

const notes = defineCollection({
  loader: glob({ base: "./src/content/notes", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    ...shared,
    course: z.string(),
    courseSlug: z.string(),
    semester: z.string(),
    chapter: z.string(),
  }),
});

const essays = defineCollection({
  loader: glob({ base: "./src/content/essays", pattern: "**/*.{md,mdx}" }),
  schema: z.object(shared),
});

export const collections = { notes, essays };
