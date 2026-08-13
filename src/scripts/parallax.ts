import { clamp, smoothstep } from "./motion";

export interface ParallaxState {
  reduced: boolean;
  mobile: boolean;
}

export function getScrollProgress(hero: HTMLElement): number {
  const rect = hero.getBoundingClientRect();
  const travel = Math.max(1, hero.offsetHeight - window.innerHeight);
  return clamp(-rect.top / travel);
}

export function applyScrollProgress(
  hero: HTMLElement,
  header: HTMLElement | null,
  state: ParallaxState,
): void {
  const progress = getScrollProgress(hero);
  const staticScene = state.reduced || state.mobile;
  const visualProgress = staticScene ? 0 : progress;
  const cameraProgress = smoothstep(.18, .96, visualProgress);
  const copyProgress = smoothstep(.3, .7, visualProgress);
  const exitProgress = smoothstep(.7, 1, visualProgress);
  const headerProgress = smoothstep(.64, .94, progress);

  hero.style.setProperty("--scene-scale", String(1 + cameraProgress * .11));
  hero.style.setProperty("--scene-x", `${cameraProgress * -3.6}vw`);
  hero.style.setProperty("--scene-y", `${cameraProgress * -2.2}vh`);
  hero.style.setProperty("--copy-y", `${copyProgress * -84}px`);
  hero.style.setProperty("--copy-opacity", String(1 - copyProgress));
  hero.style.setProperty("--weather-opacity", String(1 - smoothstep(.72, .98, visualProgress)));
  hero.style.setProperty("--mist-rise", `${exitProgress * -96}px`);
  hero.style.setProperty("--exit-opacity", String(exitProgress));
  hero.style.setProperty("--mark-opacity", String(1 - smoothstep(.5, .78, visualProgress)));
  hero.style.setProperty("--parallax-far", `${cameraProgress * -52}px`);
  hero.style.setProperty("--parallax-mid", `${cameraProgress * -116}px`);
  hero.style.setProperty("--parallax-near", `${cameraProgress * -196}px`);
  hero.style.setProperty("--parallax-water", `${cameraProgress * 18}px`);

  if (header) {
    header.style.setProperty("--home-header-progress", String(headerProgress));
    header.style.setProperty("--home-header-alpha", String(headerProgress * .9));
    header.style.setProperty("--home-header-line", String(headerProgress * .13));
    header.style.setProperty("--home-header-blur", `${headerProgress * 16}px`);
    header.style.visibility = headerProgress > .015 ? "visible" : "hidden";
    header.style.pointerEvents = headerProgress > .08 ? "auto" : "none";
  }
}
