export interface SourceHeading { depth: number; title: string; line: number; slug: string }
export interface OutlineResult { headings: SourceHeading[]; diagnostics: string[] }

export function analyzeOutline(body: string): OutlineResult {
  let fenced = false;
  const headings = body.split("\n").flatMap((line, index): SourceHeading[] => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return []; }
    if (fenced) return [];
    const match = line.match(/^\s{0,3}(#{1,6})(?:\s+(.*)|\s*)$/);
    if (!match) return [];
    const title = (match[2] ?? "").replace(/\s+#+\s*$/, "").trim();
    return [{ depth: match[1].length, title, line: index + 1, slug: headingSlug(title) }];
  });
  const diagnostics: string[] = [];
  const slugs = new Set<string>();
  let previous = 0;
  for (const heading of headings) {
    if (heading.depth === 1) diagnostics.push(`第 ${heading.line} 行：正文中使用了 H1`);
    if (!heading.title) diagnostics.push(`第 ${heading.line} 行：标题为空`);
    if (previous && heading.depth > previous + 1) diagnostics.push(`第 ${heading.line} 行：标题层级从 H${previous} 跳到 H${heading.depth}`);
    previous = heading.depth;
    if (heading.slug && slugs.has(heading.slug)) diagnostics.push(`第 ${heading.line} 行：重复标题 slug“${heading.slug}”`);
    if (heading.slug) slugs.add(heading.slug);
  }
  return { headings, diagnostics };
}

function headingSlug(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
