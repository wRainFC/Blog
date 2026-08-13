export function setupScrollReveal() {
  const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
  if (!targets.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let observer: IntersectionObserver | undefined;

  if (!reduceMotion.matches && "IntersectionObserver" in window) {
    document.documentElement.classList.add("reveal-motion");
    observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0, rootMargin: "0px 0px -10%" });
    targets.forEach((target) => observer?.observe(target));
  } else {
    targets.forEach((target) => target.classList.add("is-visible"));
  }

  const cleanup = () => {
    observer?.disconnect();
    document.documentElement.classList.remove("reveal-motion");
    document.removeEventListener("astro:before-swap", cleanup);
    window.removeEventListener("pagehide", cleanup);
  };

  document.addEventListener("astro:before-swap", cleanup, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });
}
