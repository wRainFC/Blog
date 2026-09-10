import { readTheme, type Theme, type ThemeTransitionMode } from "./theme";
import { WeatherEngine } from "./weather";
import { applyScrollProgress } from "./parallax";

export function setupInkHero() {
  const hero = document.querySelector<HTMLElement>("[data-ink-hero]");
  if (!hero || hero.hasAttribute("data-hero-ready")) return;

  const stage = hero.querySelector<HTMLElement>("[data-hero-stage]");
  const canvas = hero.querySelector<HTMLCanvasElement>("[data-weather-canvas]");
  const waterline = hero.querySelector<HTMLElement>("[data-hero-waterline]");
  const weatherControl = hero.querySelector<HTMLButtonElement>("[data-weather-control]");
  const weatherControlLabel = hero.querySelector<HTMLElement>("[data-weather-control-label]");
  const header = document.querySelector<HTMLElement>(".site-header.is-overlay");
  const context = canvas?.getContext("2d", { alpha: true });
  if (!stage || !canvas || !context) return;

  hero.setAttribute("data-hero-ready", "true");
  hero.setAttribute("data-weather-renderer", "canvas");

  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const weather = new WeatherEngine({ canvas, stage, waterline, context, isMobile: () => mobileQuery.matches });

  let reduced = reduceQuery.matches;
  let inView = true;
  let pageVisible = !document.hidden;
  let frameId = 0;
  let running = false;
  let lastTime = 0;
  let lastPaintTime = 0;
  let enteredAt = performance.now();
  let weatherStarted = false;
  let manuallyPaused = false;
  let routeTransitioning = document.documentElement.dataset.routeBusy === "true";
  let currentTheme = readTheme();
  let weatherMix = currentTheme === "dark" ? 1 : 0;
  let targetWeatherMix = weatherMix;
  let intersectionObserver: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const applyParallax = () =>
    applyScrollProgress(hero, header, { reduced, mobile: mobileQuery.matches });

  const shouldRun = () => !reduced && !manuallyPaused && !routeTransitioning && inView && pageVisible;

  const updateControls = () => {
    const dark = currentTheme === "dark";
    const weatherName = dark ? "流星" : "雨势";
    const weatherLabel = manuallyPaused ? `恢复${weatherName}` : `暂停${weatherName}`;
    if (weatherControl) {
      weatherControl.hidden = reduced;
      weatherControl.setAttribute("aria-pressed", String(manuallyPaused));
      weatherControl.setAttribute("aria-label", weatherLabel);
      weatherControl.title = weatherLabel;
    }
    if (weatherControlLabel) weatherControlLabel.textContent = weatherLabel;

    hero.dataset.weather = dark ? "meteor" : "rain";
    hero.toggleAttribute("data-weather-paused", manuallyPaused);
  };

  const syncTheme = (theme: Theme, mode: ThemeTransitionMode) => {
    currentTheme = theme;
    targetWeatherMix = theme === "dark" ? 1 : 0;
    if (mode !== "fallback" || manuallyPaused) {
      weatherMix = targetWeatherMix;
      weather.drawStatic(weatherMix);
    }
    updateControls();
    if (mode !== "snapshot" && shouldRun()) startFrame();
  };

  const frame = (time: number) => {
    if (!running || !shouldRun()) return;
    const frameInterval = mobileQuery.matches ? 1000 / 30 : 1000 / 45;
    if (lastPaintTime && time - lastPaintTime < frameInterval) {
      frameId = window.requestAnimationFrame(frame);
      return;
    }
    if (!lastTime) lastTime = time;
    const delta = Math.min((time - lastTime) / 1000, .032);
    lastTime = time;
    lastPaintTime = time;

    if (Math.abs(targetWeatherMix - weatherMix) > .001) {
      const step = delta / .85;
      weatherMix += Math.sign(targetWeatherMix - weatherMix)
        * Math.min(Math.abs(targetWeatherMix - weatherMix), step);
    } else {
      weatherMix = targetWeatherMix;
    }

    if (!weatherStarted && time - enteredAt > 620) {
      weatherStarted = true;
      weather.start();
    }
    weather.tick(delta, time, weatherMix, weatherStarted);
    frameId = window.requestAnimationFrame(frame);
  };

  const stopFrame = (clear = false) => {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    running = false;
    lastTime = 0;
    lastPaintTime = 0;
    if (clear) weather.clear();
  };

  function startFrame() {
    if (running || !shouldRun()) return;
    running = true;
    lastTime = 0;
    lastPaintTime = 0;
    frameId = window.requestAnimationFrame(frame);
  }

  const syncPlayback = () => {
    applyParallax();
    updateControls();
    if (shouldRun()) startFrame();
    else stopFrame(reduced);
  };

  const resizeCanvas = () => {
    weather.resize();
    weather.drawStatic(weatherMix);
    applyParallax();
  };

  const onVisibilityChange = () => {
    pageVisible = !document.hidden;
    syncPlayback();
  };

  const onScroll = () => {
    applyParallax();
    if (shouldRun()) startFrame();
  };

  const onReducedMotionChange = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    weatherMix = targetWeatherMix;
    resizeCanvas();
    syncPlayback();
  };

  const onMobileChange = () => {
    resizeCanvas();
    syncPlayback();
  };

  const onWeatherControlClick = () => {
    manuallyPaused = !manuallyPaused;
    updateControls();
    if (manuallyPaused) stopFrame(false);
    else if (shouldRun()) startFrame();
  };

  const onExternalThemeChange = (event: Event) => {
    const detail = (event as CustomEvent<{ mode?: ThemeTransitionMode; theme?: Theme }>).detail;
    if (!detail?.theme || detail.theme === currentTheme) return;
    syncTheme(detail.theme, detail.mode ?? "fallback");
  };

  const onThemeTransitionStart = () => {
    stopFrame(false);
  };

  const onThemeTransitionEnd = () => {
    if (shouldRun()) startFrame();
  };

  const onRouteTransitionStart = () => {
    routeTransitioning = true;
    stopFrame(false);
  };

  const onRouteTransitionEnd = () => {
    routeTransitioning = false;
    if (shouldRun()) startFrame();
  };

  const cleanup = () => {
    stopFrame(true);
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("astro:before-swap", cleanup);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wrain:theme-change", onExternalThemeChange);
    window.removeEventListener("wrain:theme-transition-start", onThemeTransitionStart);
    window.removeEventListener("wrain:theme-transition-end", onThemeTransitionEnd);
    window.removeEventListener("wrain:route-transition-start", onRouteTransitionStart);
    window.removeEventListener("wrain:route-transition-end", onRouteTransitionEnd);
    reduceQuery.removeEventListener("change", onReducedMotionChange);
    mobileQuery.removeEventListener("change", onMobileChange);
    weatherControl?.removeEventListener("click", onWeatherControlClick);
    header?.style.removeProperty("--home-header-alpha");
    header?.style.removeProperty("--home-header-line");
    header?.style.removeProperty("--home-header-blur");
    header?.style.removeProperty("--home-header-progress");
    header?.style.removeProperty("pointer-events");
    header?.style.removeProperty("visibility");
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("astro:before-swap", cleanup, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("wrain:theme-change", onExternalThemeChange);
  window.addEventListener("wrain:theme-transition-start", onThemeTransitionStart);
  window.addEventListener("wrain:theme-transition-end", onThemeTransitionEnd);
  window.addEventListener("wrain:route-transition-start", onRouteTransitionStart);
  window.addEventListener("wrain:route-transition-end", onRouteTransitionEnd);
  reduceQuery.addEventListener("change", onReducedMotionChange);
  mobileQuery.addEventListener("change", onMobileChange);
  weatherControl?.addEventListener("click", onWeatherControlClick);

  if ("IntersectionObserver" in window) {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncPlayback();
    }, { threshold: .01 });
    intersectionObserver.observe(hero);
  }

  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(stage);
  }

  resizeCanvas();
  applyParallax();
  updateControls();
  window.requestAnimationFrame(() => {
    enteredAt = performance.now();
    hero.setAttribute("data-entered", "true");
    syncPlayback();
  });
}
