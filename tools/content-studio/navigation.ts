import type { ArticleSummary, EntryKind, EntryReference, WorkspaceSnapshot } from "./model";
import { refFor, sameRef } from "./workspace-state";

export interface NavigationCallbacks {
  openCourse(courseId: string): void;
  openEntry(ref: EntryReference): void;
  create(kind: EntryKind, courseId?: string, chapterId?: string): void;
  addChapter(courseId: string): void;
  toggleCourse(courseId: string): void;
}

export function renderNavigation(
  container: HTMLElement,
  workspace: WorkspaceSnapshot,
  query: string,
  status: string,
  expandedCourses: Set<string>,
  activeCourse: string | undefined,
  activeRef: EntryReference | undefined,
  callbacks: NavigationCallbacks,
): void {
  const normalized = query.trim().toLocaleLowerCase();
  const parts: string[] = [];

  for (const course of workspace.courses) {
    const allNotes = [...course.chapters.flatMap((chapter) => chapter.notes), ...course.unfiled];
    const visibleNotes = allNotes.filter((note) => matches(note, normalized, status));
    const courseMatches = `${course.title} ${course.id} ${course.semester}`.toLocaleLowerCase().includes(normalized);
    const chapterMatches = course.chapters.some((chapter) => chapter.title.toLocaleLowerCase().includes(normalized));
    if (normalized && !courseMatches && !chapterMatches && !visibleNotes.length) continue;
    if (status !== "all" && !visibleNotes.length) continue;
    const open = normalized.length > 0 || expandedCourses.has(course.id) || activeCourse === course.id;
    parts.push(`<section class="tree-course${activeCourse === course.id ? " is-current" : ""}" data-course="${escapeHtml(course.id)}">
      <div class="tree-course-row">
        <button class="tree-disclosure" type="button" data-nav-action="toggle-course" aria-label="${open ? "折叠" : "展开"}${escapeHtml(course.title)}" aria-expanded="${open}">${open ? "⌄" : "›"}</button>
        <button class="tree-label" type="button" data-nav-action="open-course"><span>${escapeHtml(course.title)}</span></button>
        <span class="tree-count">${course.counts.total}</span>
        <details class="row-menu"><summary aria-label="${escapeHtml(course.title)}更多操作">···</summary><div class="menu-popover"><button type="button" data-nav-action="new-chapter">新增章节</button><button type="button" data-nav-action="new-note">新建笔记</button></div></details>
      </div>`);
    if (open) {
      parts.push('<div class="tree-course-children">');
      for (const chapter of course.chapters) {
        const notes = chapter.notes.filter((note) => matches(note, normalized, status));
        if (normalized && !chapter.title.toLocaleLowerCase().includes(normalized) && !notes.length) continue;
        if (status !== "all" && !notes.length) continue;
        parts.push(`<div class="tree-chapter" data-chapter="${escapeHtml(chapter.id)}">
          <div class="tree-chapter-row"><span class="tree-branch" aria-hidden="true"></span><span title="${escapeHtml(chapter.title)}">${escapeHtml(chapter.title)}</span><small>${notes.length}</small><button class="tree-inline-action" type="button" data-nav-action="new-note" aria-label="在${escapeHtml(chapter.title)}中新建笔记">＋</button></div>
          <div class="tree-notes">${notes.map((note) => articleRow(note, activeRef)).join("")}</div>
        </div>`);
      }
      const unfiled = course.unfiled.filter((note) => matches(note, normalized, status));
      if (unfiled.length) parts.push(`<div class="tree-chapter is-unfiled"><div class="tree-chapter-row"><span class="tree-branch"></span><span>待整理</span><small>${unfiled.length}</small></div><div class="tree-notes">${unfiled.map((note) => articleRow(note, activeRef)).join("")}</div></div>`);
      parts.push("</div>");
    }
    parts.push("</section>");
  }

  const essays = workspace.essays.filter((essay) => matches(essay, normalized, status));
  if (essays.length || (!normalized && status === "all")) {
    parts.push(`<section class="tree-essays"><div class="tree-section-title"><span>随笔</span><small>${essays.length}</small><button class="tree-inline-action" type="button" data-nav-action="new-essay">＋</button></div>${essays.map((essay) => articleRow(essay, activeRef)).join("")}</section>`);
  }

  container.innerHTML = parts.length ? parts.join("") : '<p class="sidebar-message">没有符合条件的内容。</p>';
  container.onclick = (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-nav-action]");
    if (!target) return;
    const courseElement = target.closest<HTMLElement>("[data-course]");
    const chapterElement = target.closest<HTMLElement>("[data-chapter]");
    const articleElement = target.closest<HTMLElement>("[data-ref]");
    const courseId = courseElement?.dataset.course;
    closeMenu(target);
    switch (target.dataset.navAction) {
      case "toggle-course": if (courseId) callbacks.toggleCourse(courseId); break;
      case "open-course": if (courseId) callbacks.openCourse(courseId); break;
      case "open-entry": if (articleElement?.dataset.ref) callbacks.openEntry(JSON.parse(articleElement.dataset.ref)); break;
      case "new-chapter": if (courseId) callbacks.addChapter(courseId); break;
      case "new-note": callbacks.create("note", courseId, chapterElement?.dataset.chapter); break;
      case "new-essay": callbacks.create("essay"); break;
    }
  };
}

function articleRow(article: ArticleSummary, activeRef?: EntryReference): string {
  const ref = refFor(article);
  const active = activeRef && sameRef(activeRef, ref);
  const statusClass = article.issues.length ? "has-issues" : article.draft ? "is-draft" : "is-published";
  const status = article.issues.length || article.draft
    ? `<i class="status-dot ${statusClass}" aria-label="${article.issues.length ? "待整理" : "草稿"}"></i>`
    : "";
  return `<button class="tree-article${active ? " is-active" : ""}" type="button" data-nav-action="open-entry" data-ref="${escapeHtml(JSON.stringify(ref))}" title="${escapeHtml(article.title || article.id)}"><span>${escapeHtml(article.title || article.id)}</span>${status}</button>`;
}

function matches(article: ArticleSummary, query: string, status: string): boolean {
  const text = `${article.title} ${article.id} ${article.summary} ${article.tags.join(" ")}`.toLocaleLowerCase();
  return (!query || text.includes(query))
    && (status === "all"
      || status === "draft" && article.draft
      || status === "published" && !article.draft
      || status === "issues" && article.issues.length > 0);
}

function closeMenu(target: HTMLElement): void {
  const menu = target.closest<HTMLDetailsElement>("details");
  if (menu) menu.open = false;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
