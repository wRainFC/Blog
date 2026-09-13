import { clamp, randomBetween } from "./motion";

interface FocusParticle {
  alpha: number;
  angle: number;
  angularVelocity: number;
  depth: number;
  phase: number;
  radialScale: number;
  radius: number;
  verticalScale: number;
}

interface FocusPoint {
  baseRadiusX: number;
  baseRadiusY: number;
  x: number;
  y: number;
}

const layerDepths = [.42, .72, 1];

class FocusField {
  private readonly particles: FocusParticle[] = [];
  private width = 1;
  private height = 1;
  private pointerX = 0;
  private pointerY = 0;
  private targetPointerX = 0;
  private targetPointerY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly context: CanvasRenderingContext2D,
    private readonly stage: HTMLElement,
    private readonly mobile: () => boolean,
  ) {}

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 1.4);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.buildParticles();
  }

  setPointerTarget(x: number, y: number): void {
    this.targetPointerX = x;
    this.targetPointerY = y;
  }

  resetPointer(immediate = false): void {
    this.targetPointerX = 0;
    this.targetPointerY = 0;
    if (immediate) {
      this.pointerX = 0;
      this.pointerY = 0;
      this.syncVisualTransform();
    }
  }

  update(delta: number): void {
    const pointerEase = 1 - Math.exp(-delta * 5.4);
    this.pointerX += (this.targetPointerX - this.pointerX) * pointerEase;
    this.pointerY += (this.targetPointerY - this.pointerY) * pointerEase;
    this.syncVisualTransform();

    for (const particle of this.particles) {
      particle.angle += particle.angularVelocity * delta;
      particle.phase += delta * (.62 + particle.depth * .38);
    }
  }

  draw(time: number): void {
    const dark = document.documentElement.dataset.theme === "dark";
    const accent = dark ? "121, 185, 158" : "31, 90, 69";
    const seconds = time / 1000;
    const focus = this.getFocusPoint();
    this.context.clearRect(0, 0, this.width, this.height);

    this.drawAura(focus, accent, dark);
    this.drawTracks(focus, accent, dark, seconds);
    this.drawParticles(focus, accent, dark);
  }

  clear(): void {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  private getFocusPoint(): FocusPoint {
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    return {
      x: stageRect.left - canvasRect.left + stageRect.width / 2 + this.pointerX * .28,
      y: stageRect.top - canvasRect.top + stageRect.height / 2 + this.pointerY * .28,
      baseRadiusX: Math.min(this.width * .42, Math.max(stageRect.width * .74, 220)),
      baseRadiusY: Math.min(this.height * .3, Math.max(stageRect.height * .46, 148)),
    };
  }

  private drawAura(focus: FocusPoint, accent: string, dark: boolean): void {
    const radius = Math.max(focus.baseRadiusX, focus.baseRadiusY) * 1.22;
    const gradient = this.context.createRadialGradient(focus.x, focus.y, 0, focus.x, focus.y, radius);
    gradient.addColorStop(0, `rgba(${accent}, ${dark ? .105 : .075})`);
    gradient.addColorStop(.48, `rgba(${accent}, ${dark ? .045 : .028})`);
    gradient.addColorStop(1, `rgba(${accent}, 0)`);
    this.context.fillStyle = gradient;
    this.context.fillRect(focus.x - radius, focus.y - radius, radius * 2, radius * 2);
  }

  private drawTracks(focus: FocusPoint, accent: string, dark: boolean, seconds: number): void {
    const tracks = [
      { radiusX: 1, radiusY: .72, rotation: -.2, width: 1.65, alpha: dark ? .42 : .32, dash: [86, 24, 18, 32], speed: 15 },
      { radiusX: 1.16, radiusY: 1.02, rotation: .16, width: 1.2, alpha: dark ? .32 : .23, dash: [42, 30, 12, 44], speed: -10 },
      { radiusX: .87, radiusY: 1.26, rotation: -.6, width: .9, alpha: dark ? .24 : .17, dash: [20, 24, 66, 34], speed: 8 },
    ];

    for (const [index, track] of tracks.entries()) {
      const radiusX = focus.baseRadiusX * track.radiusX;
      const radiusY = focus.baseRadiusY * track.radiusY;
      const drift = Math.sin(seconds * .22 + index * 1.7) * .035;

      this.context.save();
      this.context.translate(focus.x + this.pointerX * index * .08, focus.y + this.pointerY * index * .08);
      this.context.rotate(track.rotation + drift);
      const gradient = this.context.createLinearGradient(-radiusX, 0, radiusX, 0);
      gradient.addColorStop(0, `rgba(${accent}, ${track.alpha * .18})`);
      gradient.addColorStop(.26, `rgba(${accent}, ${track.alpha})`);
      gradient.addColorStop(.72, `rgba(${accent}, ${track.alpha * .72})`);
      gradient.addColorStop(1, `rgba(${accent}, ${track.alpha * .12})`);
      this.context.beginPath();
      this.context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      this.context.setLineDash(track.dash);
      this.context.lineDashOffset = seconds * track.speed;
      this.context.lineWidth = track.width;
      this.context.strokeStyle = gradient;
      this.context.shadowColor = `rgba(${accent}, ${dark ? .25 : .16})`;
      this.context.shadowBlur = index === 0 ? 10 : 6;
      this.context.stroke();
      this.context.restore();

      const nodeAngle = seconds * (.075 - index * .018) + index * 2.15;
      const cosRotation = Math.cos(track.rotation);
      const sinRotation = Math.sin(track.rotation);
      const localX = Math.cos(nodeAngle) * radiusX;
      const localY = Math.sin(nodeAngle) * radiusY;
      const nodeX = focus.x + localX * cosRotation - localY * sinRotation;
      const nodeY = focus.y + localX * sinRotation + localY * cosRotation;
      this.drawGlowNode(nodeX, nodeY, 18 + index * 5, 2.5 - index * .35, accent, dark);
    }
  }

  private drawGlowNode(
    x: number,
    y: number,
    glowRadius: number,
    coreRadius: number,
    accent: string,
    dark: boolean,
  ): void {
    const glow = this.context.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, `rgba(${accent}, ${dark ? .44 : .34})`);
    glow.addColorStop(.18, `rgba(${accent}, ${dark ? .2 : .13})`);
    glow.addColorStop(1, `rgba(${accent}, 0)`);
    this.context.fillStyle = glow;
    this.context.beginPath();
    this.context.arc(x, y, glowRadius, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = `rgba(${accent}, ${dark ? .78 : .62})`;
    this.context.beginPath();
    this.context.arc(x, y, coreRadius, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawParticles(focus: FocusPoint, accent: string, dark: boolean): void {
    for (const particle of this.particles) {
      const radiusX = focus.baseRadiusX * particle.radialScale;
      const radiusY = focus.baseRadiusY * particle.verticalScale;
      const drift = Math.sin(particle.phase) * (5 + particle.depth * 7);
      const x = focus.x
        + Math.cos(particle.angle) * radiusX
        + drift
        + this.pointerX * particle.depth * .42;
      const y = focus.y
        + Math.sin(particle.angle) * radiusY
        + Math.cos(particle.phase * .8) * 6
        + this.pointerY * particle.depth * .42;
      const pulse = .78 + Math.sin(particle.phase) * .22;
      const alpha = particle.alpha * pulse * (dark ? 1.16 : 1);

      this.context.save();
      this.context.fillStyle = `rgba(${accent}, ${alpha})`;
      if (particle.radius > 2.8) {
        this.context.shadowColor = `rgba(${accent}, ${alpha * .75})`;
        this.context.shadowBlur = 9;
      }
      this.context.beginPath();
      this.context.arc(x, y, particle.radius, 0, Math.PI * 2);
      this.context.fill();
      this.context.restore();
    }
  }

  private buildParticles(): void {
    const layerCounts = this.mobile() ? [5, 5, 4] : [10, 11, 9];
    this.particles.length = 0;
    for (const [layer, count] of layerCounts.entries()) {
      const depth = layerDepths[layer] ?? 1;
      for (let index = 0; index < count; index += 1) {
        const direction = (index + layer) % 3 === 0 ? -1 : 1;
        this.particles.push({
          alpha: randomBetween(.16 + layer * .045, .29 + layer * .055),
          angle: randomBetween(0, Math.PI * 2),
          angularVelocity: randomBetween(.035 + layer * .012, .072 + layer * .022) * direction,
          depth,
          phase: randomBetween(0, Math.PI * 2),
          radialScale: randomBetween(.72 + layer * .12, 1.08 + layer * .18),
          radius: randomBetween(1.15 + layer * .45, 2.15 + layer * 1.05),
          verticalScale: randomBetween(.66 + layer * .11, 1.04 + layer * .2),
        });
      }
    }
  }

  private syncVisualTransform(): void {
    this.stage.style.setProperty("--hero-parallax-x", `${this.pointerX.toFixed(2)}px`);
    this.stage.style.setProperty("--hero-parallax-y", `${this.pointerY.toFixed(2)}px`);
  }
}

export function setupEditorialHero(): () => void {
  const hero = document.querySelector<HTMLElement>("[data-editorial-hero]");
  if (!hero || hero.hasAttribute("data-hero-ready")) return () => undefined;

  const canvas = hero.querySelector<HTMLCanvasElement>("[data-ambient-canvas]");
  const stage = hero.querySelector<HTMLElement>("[data-hero-stage]");
  const control = hero.querySelector<HTMLButtonElement>("[data-ambient-control]");
  const label = control?.querySelector<HTMLElement>("[data-ambient-control-label]");
  const context = canvas?.getContext("2d", { alpha: true });
  if (!canvas || !stage || !context) {
    if (control) control.hidden = true;
    hero.setAttribute("data-ambient-static", "");
    hero.setAttribute("data-entered", "true");
    return () => undefined;
  }

  hero.setAttribute("data-hero-ready", "true");
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const finePointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  const field = new FocusField(canvas, context, stage, () => mobileQuery.matches);
  let reduced = reduceQuery.matches;
  let manuallyPaused = false;
  let inView = true;
  let pageVisible = !document.hidden;
  let routeBusy = document.documentElement.dataset.routeBusy === "true";
  let frameId = 0;
  let running = false;
  let lastTime = 0;
  let lastPaint = 0;
  let intersectionObserver: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const shouldRun = () => !reduced && !manuallyPaused && inView && pageVisible && !routeBusy;
  const updateControl = () => {
    const text = manuallyPaused ? "继续环境动画" : "暂停环境动画";
    if (control) {
      control.hidden = reduced;
      control.setAttribute("aria-pressed", String(manuallyPaused));
      control.setAttribute("aria-label", text);
      control.title = text;
    }
    if (label) label.textContent = manuallyPaused ? "继续动画" : "暂停动画";
    hero.toggleAttribute("data-ambient-paused", manuallyPaused);
    hero.toggleAttribute("data-ambient-static", reduced);
    hero.toggleAttribute("data-ambient-running", shouldRun());
  };
  const stop = () => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    running = false;
    lastTime = 0;
    lastPaint = 0;
  };
  const frame = (time: number) => {
    if (!running || !shouldRun()) return;
    if (lastPaint && time - lastPaint < 1000 / 30) {
      frameId = requestAnimationFrame(frame);
      return;
    }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
    lastTime = time;
    lastPaint = time;
    field.update(delta);
    field.draw(time);
    frameId = requestAnimationFrame(frame);
  };
  const start = () => {
    if (running || !shouldRun()) return;
    running = true;
    frameId = requestAnimationFrame(frame);
  };
  const sync = () => {
    updateControl();
    if (shouldRun()) start();
    else {
      stop();
      field.draw(reduced ? 0 : performance.now());
    }
  };
  const resize = () => {
    field.resize();
    field.draw(reduced ? 0 : performance.now());
  };
  const onVisibility = () => {
    pageVisible = !document.hidden;
    sync();
  };
  const onReduced = (event: MediaQueryListEvent) => {
    reduced = event.matches;
    if (reduced) field.resetPointer(true);
    sync();
  };
  const onMobile = () => {
    if (mobileQuery.matches) field.resetPointer(true);
    resize();
    sync();
  };
  const onPointerCapability = () => {
    if (!finePointerQuery.matches) field.resetPointer();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (reduced || mobileQuery.matches || !finePointerQuery.matches) return;
    const rect = hero.getBoundingClientRect();
    const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 2 - 1;
    const normalizedY = clamp((event.clientY - rect.top) / rect.height, 0, 1) * 2 - 1;
    field.setPointerTarget(normalizedX * 16, normalizedY * 12);
  };
  const onPointerLeave = () => field.resetPointer();
  const onControl = () => {
    manuallyPaused = !manuallyPaused;
    sync();
  };
  const onTheme = () => field.draw(reduced ? 0 : performance.now());
  const onRouteStart = () => {
    routeBusy = true;
    sync();
  };
  const onRouteEnd = () => {
    routeBusy = false;
    sync();
  };

  document.addEventListener("visibilitychange", onVisibility);
  reduceQuery.addEventListener("change", onReduced);
  mobileQuery.addEventListener("change", onMobile);
  finePointerQuery.addEventListener("change", onPointerCapability);
  hero.addEventListener("pointermove", onPointerMove, { passive: true });
  hero.addEventListener("pointerleave", onPointerLeave);
  control?.addEventListener("click", onControl);
  window.addEventListener("wrain:theme-change", onTheme);
  window.addEventListener("wrain:route-transition-start", onRouteStart);
  window.addEventListener("wrain:route-transition-end", onRouteEnd);

  if ("IntersectionObserver" in window) {
    intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    }, { threshold: .01 });
    intersectionObserver.observe(hero);
  }
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hero);
  }

  resize();
  requestAnimationFrame(() => {
    hero.setAttribute("data-entered", "true");
    sync();
  });

  const cleanup = () => {
    stop();
    field.clear();
    field.resetPointer(true);
    hero.removeAttribute("data-hero-ready");
    hero.removeAttribute("data-ambient-running");
    hero.removeAttribute("data-ambient-paused");
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    reduceQuery.removeEventListener("change", onReduced);
    mobileQuery.removeEventListener("change", onMobile);
    finePointerQuery.removeEventListener("change", onPointerCapability);
    hero.removeEventListener("pointermove", onPointerMove);
    hero.removeEventListener("pointerleave", onPointerLeave);
    control?.removeEventListener("click", onControl);
    window.removeEventListener("wrain:theme-change", onTheme);
    window.removeEventListener("wrain:route-transition-start", onRouteStart);
    window.removeEventListener("wrain:route-transition-end", onRouteEnd);
  };
  return cleanup;
}
