const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 4;

export function setupScrollReveal(): () => void {
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const skipArchive = document.body.dataset.pageKind === "archive"
    && root.dataset.skipArchiveReveal === "true";
  delete root.dataset.skipArchiveReveal;

  const groups = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  const targets = groups.flatMap((group) => {
    const items = [...group.querySelectorAll<HTMLElement>(".reveal-item")];
    return items.length ? items : [group];
  });

  if (!targets.length || reduced || skipArchive || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return () => {};
  }

  root.classList.add("reveal-motion");
  const observer = new IntersectionObserver((entries) => {
    const entering = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

    entering.forEach((entry, index) => {
      const target = entry.target as HTMLElement;
      const delay = Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS;
      target.style.setProperty("--reveal-delay", `${delay}ms`);
      target.classList.add("is-visible");
      observer.unobserve(target);
    });
  }, { threshold: 0, rootMargin: "0px 0px -8%" });

  targets.forEach((target) => observer.observe(target));

  return () => {
    observer.disconnect();
    root.classList.remove("reveal-motion");
  };
}
