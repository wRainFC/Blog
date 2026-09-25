import { analyzeOutline } from "./outline";
import { escapeHtml } from "./side-sheet";

export type ComposerMode = "write" | "preview" | "split";

export function setComposerMode(root: HTMLElement, mode: ComposerMode): void {
  root.dataset.mode = mode;
  root.querySelectorAll<HTMLElement>("[data-composer-mode]").forEach((button) => {
    const active = button.dataset.composerMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  localStorage.setItem("content-studio:composer-mode", mode);
}

export function preferredComposerMode(readOnly: boolean): ComposerMode {
  if (readOnly) return "preview";
  const saved = localStorage.getItem("content-studio:composer-mode");
  if (saved === "preview" || saved === "split") return saved;
  return "write";
}

export function insertMarkdown(textarea: HTMLTextAreaElement, action: string): void {
  const map: Record<string, [string, string]> = {
    heading: ["## ", ""],
    bold: ["**", "**"],
    link: ["[", "](https://)"],
    quote: ["> ", ""],
    code: ["```\n", "\n```"],
    math: ["$$\n", "\n$$"],
  };
  const pair = map[action];
  if (!pair) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  textarea.setRangeText(`${pair[0]}${selected}${pair[1]}`, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.focus();
}

export function outlineMarkup(body: string): string {
  const result = analyzeOutline(body);
  const headings = result.headings.filter((heading) => heading.depth === 2 || heading.depth === 3);
  const navigation = headings.length
    ? `<nav class="sheet-outline">${headings.map((heading) => `<button type="button" data-outline-line="${heading.line}" class="depth-${heading.depth}">${escapeHtml(heading.title || "（空标题）")}</button>`).join("")}</nav>`
    : '<p class="sheet-empty">正文中还没有 H2/H3 标题。</p>';
  const diagnostics = result.diagnostics.length
    ? `<div class="sheet-diagnostics"><h3>需要留意</h3><ul>${result.diagnostics.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul></div>`
    : '<p class="sheet-ok">标题层级正常。</p>';
  return navigation + diagnostics;
}

export function focusLine(textarea: HTMLTextAreaElement, line: number, editorRoot: HTMLElement): void {
  setComposerMode(editorRoot, "write");
  const lines = textarea.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((total, item) => total + item.length + 1, 0);
  textarea.focus();
  textarea.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
}

export function previewDocument(html: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><base target="_blank"><style>
    :root{color-scheme:light}body{max-width:760px;margin:0 auto;padding:34px 38px;color:#28231d;background:#fffdf8;font:16px/1.85 Georgia,'Noto Serif SC',serif}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;background:#f3efe7;border-radius:6px}code{font-family:ui-monospace,monospace}blockquote{margin-left:0;padding-left:18px;border-left:2px solid #b64a3b;color:#665f55}h1,h2,h3{line-height:1.35}a{color:#a33e31}
  </style></head><body>${html}</body></html>`;
}
