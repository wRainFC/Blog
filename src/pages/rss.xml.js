import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export async function GET(context) {
  const notes = await getCollection("notes", ({ data }) => !data.draft);
  const essays = await getCollection("essays", ({ data }) => !data.draft);
  const items = [...notes, ...essays]
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.pubDate,
      link: `/${entry.collection}/${entry.id}`,
      categories: entry.data.tags,
    }));

  return rss({
    title: "砚边",
    description: "一名大学生的课程笔记与随笔思考。",
    site: context.site,
    items,
    customData: "<language>zh-CN</language>",
  });
}
