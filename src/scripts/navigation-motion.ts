import { classifyRouteMotion, pageKindFromPath, type RouteMotion } from "./motion";

interface AstroPreparationEvent extends Event {
  direction?: string;
  from: URL;
  loader?: () => Promise<void>;
  navigationType?: string;
  to: URL;
}

interface AstroSwapEvent extends Event {
  direction?: string;
  navigationType?: string;
  newDocument: Document;
  viewTransition?: { finished: Promise<unknown> };
}

let installed = false;
let routeMotion: RouteMotion = "default";
let hasTransitionPromise = false;
let selectedItem: HTMLElement | null = null;
let selectedGroup: HTMLElement | null = null;

const setThemeControlsDisabled = (scope: Document, disabled: boolean) => {
  scope.querySelectorAll<HTMLButtonElement>("button[data-theme-control]").forEach((control) => {
    control.disabled = disabled;
    control.toggleAttribute("aria-disabled", disabled);
  });
};

const dispatchRouteEvent = (name: string) => window.dispatchEvent(new Event(name));

const clearArticleSelection = () => {
  selectedItem?.classList.remove("is-transition-source");
  selectedGroup?.classList.remove("is-article-selection-group");
  document.querySelectorAll(".is-transition-source")
    .forEach((element) => element.classList.remove("is-transition-source"));
  document.querySelectorAll(".is-article-selection-group")
    .forEach((element) => element.classList.remove("is-article-selection-group"));
  selectedItem = null;
  selectedGroup = null;
};

const finishRouteMotion = () => {
  const root = document.documentElement;
  delete root.dataset.routeBusy;
  delete root.dataset.routeMotion;
  delete root.dataset.articleLeaving;
  setThemeControlsDisabled(document, false);
  clearArticleSelection();
  hasTransitionPromise = false;
  dispatchRouteEvent("wrain:route-transition-end");
};

const waitForThemeTransition = () => new Promise<void>((resolve) => {
  if (!document.documentElement.dataset.themeTransition) {
    resolve();
    return;
  }
  window.addEventListener("wrain:theme-transition-end", () => resolve(), { once: true });
});

function onArticleLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.composedPath().find((target): target is HTMLAnchorElement =>
    target instanceof HTMLAnchorElement
      && target.matches("a[data-motion-link='article'], .pf-result a[href], .pagefind-ui__result a[href]")) ?? null;
  if (!link || link.hasAttribute("download") || (link.target && link.target.toLowerCase() !== "_self")) return;

  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || pageKindFromPath(target.pathname) !== "article") return;

  const item = link.closest<HTMLElement>("[data-article-card], .pf-result, .pagefind-ui__result");
  if (!item) return;
  clearArticleSelection();
  selectedItem = item;
  selectedGroup = selectedItem?.closest<HTMLElement>(".article-list, .pf-results, .pagefind-ui__results") ?? null;
  selectedItem?.classList.add("is-transition-source");
  selectedGroup?.classList.add("is-article-selection-group");
  document.documentElement.dataset.articleLeaving = "true";
}

function onBeforePreparation(rawEvent: Event) {
  const event = rawEvent as AstroPreparationEvent;
  routeMotion = classifyRouteMotion(event.from.pathname, event.to.pathname);
  const root = document.documentElement;
  root.dataset.routeMotion = routeMotion;
  root.dataset.routeBusy = "true";
  setThemeControlsDisabled(document, true);
  dispatchRouteEvent("wrain:route-transition-start");

  if (event.loader) {
    const load = event.loader.bind(event);
    event.loader = async () => {
      try {
        await waitForThemeTransition();
        await load();
      } catch (error) {
        finishRouteMotion();
        throw error;
      }
    };
  }
}

function onBeforeSwap(rawEvent: Event) {
  const event = rawEvent as AstroSwapEvent;
  const nextRoot = event.newDocument.documentElement;
  const currentTheme = document.documentElement.dataset.theme;
  if (currentTheme === "light" || currentTheme === "dark") nextRoot.dataset.theme = currentTheme;
  nextRoot.dataset.routeMotion = routeMotion;
  nextRoot.dataset.routeBusy = "true";
  const backNavigation = event.direction === "back" || event.direction === "backward"
    || event.navigationType === "traverse";
  if (backNavigation && event.newDocument.body.dataset.pageKind === "archive") {
    nextRoot.dataset.skipArchiveReveal = "true";
  }

  setThemeControlsDisabled(event.newDocument, true);

  if (event.viewTransition?.finished) {
    hasTransitionPromise = true;
    void event.viewTransition.finished.then(finishRouteMotion, finishRouteMotion);
  }
}

function onPageLoad() {
  if (!document.documentElement.dataset.routeBusy || hasTransitionPromise) return;
  window.requestAnimationFrame(finishRouteMotion);
}

export function installNavigationMotion(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onArticleLinkClick, { capture: true });
  document.addEventListener("astro:before-preparation", onBeforePreparation);
  document.addEventListener("astro:before-swap", onBeforeSwap);
  document.addEventListener("astro:page-load", onPageLoad);
}
