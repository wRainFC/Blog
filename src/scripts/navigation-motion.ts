import { classifyRouteMotion, type RouteMotion } from "./motion";

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
let activeMotionId = "";
let hasTransitionPromise = false;

const setThemeControlsDisabled = (scope: Document, disabled: boolean) => {
  scope.querySelectorAll<HTMLButtonElement>("button[data-theme-control]").forEach((control) => {
    control.disabled = disabled;
    control.toggleAttribute("aria-disabled", disabled);
  });
};

const dispatchRouteEvent = (name: string) => window.dispatchEvent(new Event(name));

const markTitle = (element: HTMLElement | null, motionId: string) => {
  if (!element || !motionId) return;
  element.style.setProperty("view-transition-name", motionId);
  element.dataset.motionNamed = "true";
};

const clearNamedTitles = () => {
  document.querySelectorAll<HTMLElement>("[data-motion-named]").forEach((element) => {
    element.style.removeProperty("view-transition-name");
    delete element.dataset.motionNamed;
  });
};

const currentArticleMotionId = () =>
  document.querySelector<HTMLElement>(".article-header [data-motion-title]")?.dataset.motionTitle ?? "";

const finishRouteMotion = () => {
  const root = document.documentElement;
  delete root.dataset.routeBusy;
  delete root.dataset.routeMotion;
  delete root.dataset.archiveLeaving;
  setThemeControlsDisabled(document, false);
  clearNamedTitles();
  document.querySelectorAll(".is-transition-source")
    .forEach((element) => element.classList.remove("is-transition-source"));
  activeMotionId = "";
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
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element
    ? event.target.closest<HTMLAnchorElement>("a[data-motion-link='article']")
    : null;
  if (!link) return;
  const card = link.closest<HTMLElement>("[data-article-card]");
  const title = card?.querySelector<HTMLElement>("[data-motion-title]") ?? null;
  activeMotionId = title?.dataset.motionTitle ?? "";
  card?.classList.add("is-transition-source");
  document.documentElement.dataset.archiveLeaving = "true";
}

function onBeforePreparation(rawEvent: Event) {
  const event = rawEvent as AstroPreparationEvent;
  routeMotion = classifyRouteMotion(event.from.pathname, event.to.pathname);
  activeMotionId ||= currentArticleMotionId();
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
  nextRoot.dataset.routeMotion = routeMotion;
  nextRoot.dataset.routeBusy = "true";
  const backNavigation = event.direction === "back" || event.direction === "backward"
    || event.navigationType === "traverse";
  if (backNavigation && event.newDocument.body.dataset.pageKind === "archive") {
    nextRoot.dataset.skipArchiveReveal = "true";
  }

  const source = activeMotionId
    ? document.querySelector<HTMLElement>(`[data-motion-title="${CSS.escape(activeMotionId)}"]`)
    : null;
  const target = activeMotionId
    ? event.newDocument.querySelector<HTMLElement>(`[data-motion-title="${CSS.escape(activeMotionId)}"]`)
    : null;
  if (source && target) {
    markTitle(source, activeMotionId);
    markTitle(target, activeMotionId);
  }
  setThemeControlsDisabled(event.newDocument, true);

  if (event.viewTransition?.finished) {
    hasTransitionPromise = true;
    void event.viewTransition.finished.finally(finishRouteMotion);
  }
}

function onPageLoad() {
  if (!document.documentElement.dataset.routeBusy || hasTransitionPromise) return;
  window.requestAnimationFrame(finishRouteMotion);
}

export function installNavigationMotion(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onArticleLinkClick);
  document.addEventListener("astro:before-preparation", onBeforePreparation);
  document.addEventListener("astro:before-swap", onBeforeSwap);
  document.addEventListener("astro:page-load", onPageLoad);
}
