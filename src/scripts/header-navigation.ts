let teardownHeaderNavigation: (() => void) | undefined;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function setupHeaderNavigation(): () => void {
  teardownHeaderNavigation?.();

  const header = document.querySelector<HTMLElement>(".site-header");
  const toggle = header?.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const panel = header?.querySelector<HTMLElement>("[data-mobile-menu]");
  if (!header || !toggle || !panel) return () => undefined;

  let open = false;
  let previousFocus: HTMLElement | null = null;
  let syncFrame = 0;

  const syncHeader = () => {
    header.toggleAttribute("data-scrolled", window.scrollY > 24);
  };
  const scheduleHeaderSync = () => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      syncHeader();
      syncFrame = requestAnimationFrame(syncHeader);
    });
  };

  const setOpen = (next: boolean) => {
    if (open === next) return;
    open = next;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    header.toggleAttribute("data-menu-open", open);
    document.body.classList.toggle("menu-open", open);

    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : toggle;
      panel.hidden = false;
      panel.querySelector<HTMLElement>(focusableSelector)?.focus();
    } else {
      panel.hidden = true;
      previousFocus?.focus();
      previousFocus = null;
    }
  };

  const onToggle = () => setOpen(!open);
  const onPanelClick = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
    focusable.unshift(toggle);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const onViewportChange = () => {
    if (window.matchMedia("(min-width: 761px)").matches) setOpen(false);
    scheduleHeaderSync();
  };

  toggle.addEventListener("click", onToggle);
  panel.addEventListener("click", onPanelClick);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", syncHeader, { passive: true });
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("pageshow", scheduleHeaderSync);
  syncHeader();
  scheduleHeaderSync();

  const cleanup = () => {
    if (syncFrame) cancelAnimationFrame(syncFrame);
    toggle.removeEventListener("click", onToggle);
    panel.removeEventListener("click", onPanelClick);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("scroll", syncHeader);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("pageshow", scheduleHeaderSync);
    document.body.classList.remove("menu-open");
    if (teardownHeaderNavigation === cleanup) teardownHeaderNavigation = undefined;
  };
  teardownHeaderNavigation = cleanup;
  return cleanup;
}
