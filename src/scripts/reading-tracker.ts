import { getActiveHeadingIndex, getActiveTocState, getReadingProgress } from "./motion";

interface TrackedHeading {
  element: HTMLElement;
  offset: number;
  slug: string;
}

const absoluteTop = (element: HTMLElement) =>
  element.getBoundingClientRect().top + window.scrollY;

export function setupReadingTracker(): () => void {
  const article = document.querySelector<HTMLElement>(".article-shell");
  const articleBody = article?.querySelector<HTMLElement>(".article-body");
  const progressBars = [...document.querySelectorAll<HTMLElement>("[data-reading-progress-bar]")];
  const progressTracks = [...document.querySelectorAll<HTMLElement>("[data-reading-progress]")];
  if (!article || !articleBody) {
    progressBars.forEach((bar) => bar.style.setProperty("--reading-progress", "0"));
    return () => {};
  }

  const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc-link]")];
  const headingElements = [...articleBody.querySelectorAll<HTMLElement>("h2[id], h3[id]")]
    .filter((heading) => tocLinks.some((link) => link.dataset.tocSlug === heading.id));
  const mobileCurrent = document.querySelector<HTMLElement>("[data-mobile-toc-current]");
  const mobileToc = document.querySelector<HTMLDetailsElement>("[data-mobile-toc]");
  const desktopToc = document.querySelector<HTMLElement>("[data-desktop-toc]");
  const indicator = desktopToc?.querySelector<HTMLElement>("[data-toc-indicator]");
  let headings: TrackedHeading[] = [];
  let frame = 0;
  let resizeObserver: ResizeObserver | undefined;
  let headingObserver: IntersectionObserver | undefined;
  let activeSlug = "";

  const measure = () => {
    headings = headingElements.map((element) => ({
      element,
      offset: absoluteTop(element),
      slug: element.id,
    }));
  };

  const updateIndicator = (activeLink?: HTMLAnchorElement) => {
    if (!desktopToc || !indicator || !activeLink) {
      desktopToc?.classList.remove("has-active-section");
      return;
    }
    desktopToc.classList.add("has-active-section");
    desktopToc.style.setProperty("--toc-indicator-y", `${activeLink.offsetTop}px`);
    desktopToc.style.setProperty("--toc-indicator-height", `${activeLink.offsetHeight}px`);

    const visibleTop = desktopToc.scrollTop;
    const visibleBottom = visibleTop + desktopToc.clientHeight;
    if (activeLink.offsetTop < visibleTop) desktopToc.scrollTop = activeLink.offsetTop;
    else if (activeLink.offsetTop + activeLink.offsetHeight > visibleBottom) {
      desktopToc.scrollTop = activeLink.offsetTop + activeLink.offsetHeight - desktopToc.clientHeight;
    }
  };

  const setActive = (slug: string) => {
    if (slug === activeSlug) return;
    activeSlug = slug;
    const state = getActiveTocState(tocLinks.map((link) => ({
      parentSlug: link.dataset.tocParent ?? "",
      slug: link.dataset.tocSlug ?? "",
    })), slug);
    const current = tocLinks.find((link) => link.dataset.tocSlug === state.activeSlug);

    tocLinks.forEach((link) => {
      const active = link.dataset.tocSlug === slug;
      const parent = Boolean(state.parentSlug && link.dataset.tocSlug === state.parentSlug && !active);
      link.classList.toggle("is-active", active);
      link.classList.toggle("is-active-parent", parent);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });

    if (mobileCurrent) mobileCurrent.textContent = current?.textContent?.trim() || "文章目录";
    const escapedSlug = slug ? CSS.escape(slug) : "";
    updateIndicator(
      escapedSlug
        ? document.querySelector<HTMLAnchorElement>(`[data-desktop-toc] [data-toc-slug="${escapedSlug}"]`) ?? undefined
        : undefined,
    );
  };

  const update = () => {
    frame = 0;
    const readingLine = window.scrollY + window.innerHeight * .3;
    const index = getActiveHeadingIndex(headings.map((heading) => heading.offset), readingLine);
    setActive(index >= 0 ? headings[index].slug : "");

    const headerOffset = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--header-height"),
    ) || 0;
    const tags = articleBody.querySelector<HTMLElement>(".article-tags");
    const start = absoluteTop(articleBody) - headerOffset;
    const endElement = tags ?? articleBody;
    const end = absoluteTop(endElement) + endElement.offsetHeight - window.innerHeight * .3;
    const progress = getReadingProgress(window.scrollY, start, end);
    progressBars.forEach((bar) => bar.style.setProperty("--reading-progress", String(progress)));
    progressTracks.forEach((track) => track.setAttribute("aria-valuenow", String(Math.round(progress * 100))));
  };

  const scheduleUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  const onResize = () => {
    measure();
    scheduleUpdate();
  };

  const focusTarget = (target: HTMLElement) => {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.classList.remove("is-reading-target");
    window.requestAnimationFrame(() => target.classList.add("is-reading-target"));
  };

  const onTocClick = (event: MouseEvent) => {
    const link = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-toc-link]")
      : null;
    if (!link) return;
    const slug = link.dataset.tocSlug;
    const target = slug ? document.getElementById(slug) : null;
    if (!slug || !target) return;

    setActive(slug);
    focusTarget(target);
    if (mobileToc) mobileToc.open = false;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && mobileToc?.open) {
      mobileToc.open = false;
      mobileToc.querySelector<HTMLElement>("summary")?.focus();
    }
  };

  measure();
  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("click", onTocClick);
  document.addEventListener("keydown", onKeyDown);

  if ("IntersectionObserver" in window && headingElements.length) {
    headingObserver = new IntersectionObserver(scheduleUpdate, {
      rootMargin: "-30% 0px -65% 0px",
      threshold: 0,
    });
    headingElements.forEach((heading) => headingObserver?.observe(heading));
  }

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(articleBody);
  }

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    headingObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("click", onTocClick);
    document.removeEventListener("keydown", onKeyDown);
  };
}
