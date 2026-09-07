export type Theme = "light" | "dark";

export interface ThemeOrigin {
  x: number;
  y: number;
}

export interface ApplyThemeOptions {
  animate?: boolean;
  origin?: ThemeOrigin;
  persist?: boolean;
}

export type ThemeTransitionMode = "none" | "fallback" | "snapshot";

interface ThemeEventDetail {
  mode: ThemeTransitionMode;
  theme: Theme;
}

const storageKey = "wrain-theme";
const THEME_EVENT = "wrain:theme-change";
const THEME_TRANSITION_START_EVENT = "wrain:theme-transition-start";
const THEME_TRANSITION_END_EVENT = "wrain:theme-transition-end";

let transitionTask: Promise<void> | undefined;
let teardownControls: (() => void) | undefined;

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

const dispatchThemeEvent = (name: string, detail: ThemeEventDetail) => {
  window.dispatchEvent(new CustomEvent<ThemeEventDetail>(name, { detail }));
};

const labelForControl = (control: HTMLElement, theme: Theme): string => {
  const dark = theme === "dark";
  return dark
    ? control.dataset.themeLabelToLight ?? "切换至浅色主题"
    : control.dataset.themeLabelToDark ?? "切换至深色主题";
};

export const updateThemeControls = (theme: Theme): void => {
  const dark = theme === "dark";
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach((control) => {
    const label = labelForControl(control, theme);
    control.setAttribute("aria-pressed", String(dark));
    control.setAttribute("aria-label", label);
    control.setAttribute("title", label);
    control.querySelector<HTMLElement>("[data-theme-control-label]")?.replaceChildren(label);
  });
};

const commitTheme = (
  theme: Theme,
  persist: boolean,
  mode: ThemeTransitionMode,
): void => {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>("meta[data-theme-color]")
    ?.setAttribute("content", themeColor(theme));
  if (persist) {
    try { localStorage.setItem(storageKey, theme); } catch {}
  }
  updateThemeControls(theme);
  dispatchThemeEvent(THEME_EVENT, { mode, theme });
};

const controlOrigin = (event: MouseEvent, control: HTMLElement): ThemeOrigin => {
  if (event.detail > 0) return { x: event.clientX, y: event.clientY };
  const rect = control.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

const setTransitionGeometry = (origin?: ThemeOrigin): void => {
  const root = document.documentElement;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const x = Math.min(width, Math.max(0, origin?.x ?? width / 2));
  const y = Math.min(height, Math.max(0, origin?.y ?? height / 2));
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  root.style.setProperty("--theme-transition-x", `${x}px`);
  root.style.setProperty("--theme-transition-y", `${y}px`);
  root.style.setProperty("--theme-transition-radius", `${Math.ceil(radius)}px`);
};

const clearTransitionState = (): void => {
  const root = document.documentElement;
  delete root.dataset.themeTransition;
  root.style.removeProperty("--theme-transition-x");
  root.style.removeProperty("--theme-transition-y");
  root.style.removeProperty("--theme-transition-radius");
};

export function applyTheme(theme: Theme, options: ApplyThemeOptions = {}): Promise<void> {
  if (transitionTask || readTheme() === theme) return transitionTask ?? Promise.resolve();

  const { animate = true, origin, persist = true } = options;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canSnapshot = animate && !reduced && !document.hidden
    && typeof document.startViewTransition === "function";

  if (!canSnapshot) {
    const mode = animate && !reduced && !document.hidden ? "fallback" : "none";
    commitTheme(theme, persist, mode);
    return Promise.resolve();
  }

  setTransitionGeometry(origin);
  document.documentElement.dataset.themeTransition = theme;
  dispatchThemeEvent(THEME_TRANSITION_START_EVENT, { mode: "snapshot", theme });

  transitionTask = (async () => {
    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(() => {
        commitTheme(theme, persist, "snapshot");
      });
    } catch {
      clearTransitionState();
      commitTheme(theme, persist, "fallback");
      dispatchThemeEvent(THEME_TRANSITION_END_EVENT, { mode: "fallback", theme });
      return;
    }

    try {
      await transition.finished;
    } catch {
      // The state update still commits when the visual transition is skipped.
    } finally {
      clearTransitionState();
      dispatchThemeEvent(THEME_TRANSITION_END_EVENT, { mode: "snapshot", theme });
    }
  })();

  void transitionTask.finally(() => {
    transitionTask = undefined;
  });
  return transitionTask;
}

export function setupThemeControls(): void {
  teardownControls?.();

  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const onControlClick = (event: MouseEvent) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-theme-control]")
      : null;
    if (!target || transitionTask) return;
    void applyTheme(readTheme() === "dark" ? "light" : "dark", {
      origin: controlOrigin(event, target),
    });
  };

  const onSystemThemeChange = (event: MediaQueryListEvent) => {
    if (!hasSavedTheme()) {
      void applyTheme(event.matches ? "dark" : "light", { animate: false, persist: false });
    }
  };

  updateThemeControls(readTheme());
  document.addEventListener("click", onControlClick);
  themeQuery.addEventListener("change", onSystemThemeChange);

  const cleanup = () => {
    document.removeEventListener("click", onControlClick);
    document.removeEventListener("astro:before-swap", cleanup);
    themeQuery.removeEventListener("change", onSystemThemeChange);
    if (teardownControls === cleanup) teardownControls = undefined;
  };

  teardownControls = cleanup;
  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
