import rss from "@astrojs/rss";
import { getPublishedArticles } from "../lib/content/queries";
import { articleHref } from "../lib/content/urls";
import { siteConfig } from "../config/site";
import { withBasePath } from "../lib/site-path";

export async function GET(context) {
  const items = (await getPublishedArticles())
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.pubDate,
      link: articleHref(entry),
      categories: entry.data.tags,
    }));

  return rss({
    title: `${siteConfig.name} · wRainFC`,
    description: "一名大学生的课程笔记与随笔思考。",
    site: new URL(withBasePath("/"), context.site),
    items,
    customData: "<language>zh-CN</language>",
  });
}
