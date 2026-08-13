export type Theme = "light" | "dark";

const storageKey = "wrain-theme";
const THEME_EVENT = "wrain:theme-change";

export const themeColor = (theme: Theme): string =>
  theme === "dark" ? "#09111b" : "#faf9f5";

export const readTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export const hasSavedTheme = (): boolean => {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark";
  } catch {
    return false;
  }
};

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>("meta[data-theme-color]")?.setAttribute("content", themeColor(theme));
  if (persist) {
    try { localStorage.setItem(storageKey, theme); } catch {}
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme } }));
}

const updateControls = (theme: Theme) => {
  const dark = theme === "dark";
  const label = dark ? "切换至浅色主题" : "切换至深色主题";
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach((control) => {
    if (control.closest("[data-ink-hero]")) return;
    control.setAttribute("aria-pressed", String(dark));
    control.setAttribute("aria-label", label);
    control.setAttribute("title", label);
    control.querySelector<HTMLElement>("[data-theme-control-label]")?.replaceChildren(label);
  });
};

export function setupThemeControls() {
  const controls = [...document.querySelectorAll<HTMLButtonElement>("[data-theme-control]")]
    .filter((control) => !control.closest("[data-ink-hero]"));
  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const hasHero = Boolean(document.querySelector("[data-ink-hero]"));

  updateControls(readTheme());
  controls.forEach((control) => {
    control.addEventListener("click", () => applyTheme(readTheme() === "dark" ? "light" : "dark"));
  });

  const onSystemThemeChange = (event: MediaQueryListEvent) => {
    if (!hasSavedTheme()) applyTheme(event.matches ? "dark" : "light", false);
  };

  const onExternalThemeChange = (event: Event) => {
    const theme = (event as CustomEvent<{ theme?: Theme }>).detail?.theme;
    if (theme === "light" || theme === "dark") updateControls(theme);
  };

  window.addEventListener(THEME_EVENT, onExternalThemeChange);

  if (!hasHero) themeQuery.addEventListener("change", onSystemThemeChange);

  const cleanup = () => {
    themeQuery.removeEventListener("change", onSystemThemeChange);
    window.removeEventListener(THEME_EVENT, onExternalThemeChange);
    controls.forEach((control) => {
      control.replaceWith(control.cloneNode(true));
    });
    document.removeEventListener("astro:before-swap", cleanup);
  };

  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
