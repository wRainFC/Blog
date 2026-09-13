import { setupEditorialHero } from "./editorial-hero";
import { setupHeaderNavigation } from "./header-navigation";
import { installNavigationMotion } from "./navigation-motion";
import { setupReadingTracker } from "./reading-tracker";
import { setupScrollReveal } from "./reveal";

let teardownPageMotion: (() => void) | undefined;

export function setupSiteMotion(): void {
  installNavigationMotion();
  teardownPageMotion?.();

  const cleanups = [
    setupScrollReveal(),
    setupReadingTracker(),
    setupHeaderNavigation(),
    setupEditorialHero(),
  ];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanups.forEach((teardown) => teardown());
    document.removeEventListener("astro:before-swap", cleanup);
    if (teardownPageMotion === cleanup) teardownPageMotion = undefined;
  };

  teardownPageMotion = cleanup;
  document.addEventListener("astro:before-swap", cleanup, { once: true });
}
