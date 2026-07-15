type RainLayer = "far" | "mid" | "near";
type Theme = "light" | "dark";

interface Drop {
  layer: RainLayer;
  x: number;
  y: number;
  impactX: number;
  impactY: number;
  baseDirectionX: number;
  baseDirectionY: number;
  directionX: number;
  directionY: number;
  length: number;
  width: number;
  speed: number;
  opacity: number;
  delay: number;
}

interface Ripple {
  active: boolean;
  layer: "mid" | "near";
  x: number;
  y: number;
  age: number;
  duration: number;
  radius: number;
  rings: number;
}

interface Meteor {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  length: number;
  width: number;
  speed: number;
  opacity: number;
  delay: number;
  fadeStart: number;
  fadeEnd: number;
  fadeProgress: number;
  shimmer: number;
  spriteIndex: number;
}

export function setupInkHero() {
  const hero = document.querySelector<HTMLElement>("[data-ink-hero]");
  if (!hero || hero.hasAttribute("data-hero-ready")) return;

  const stage = hero.querySelector<HTMLElement>("[data-hero-stage]");
  const canvas = hero.querySelector<HTMLCanvasElement>("[data-weather-canvas]");
  const waterline = hero.querySelector<HTMLElement>("[data-hero-waterline]");
  const weatherControl = hero.querySelector<HTMLButtonElement>("[data-weather-control]");
  const weatherControlLabel = hero.querySelector<HTMLElement>("[data-weather-control-label]");
  const themeControl = hero.querySelector<HTMLButtonElement>("[data-theme-control]");
  const themeControlLabel = hero.querySelector<HTMLElement>("[data-theme-control-label]");
  const header = document.querySelector<HTMLElement>(".site-header.is-overlay");
  const context = canvas?.getContext("2d", { alpha: true });
  if (!stage || !canvas || !context) return;

  hero.setAttribute("data-hero-ready", "true");
  hero.setAttribute("data-weather-renderer", "canvas");

  const storageKey = "wrain-theme";
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileQuery = window.matchMedia("(max-width: 760px)");
  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const drops: Drop[] = [];
  const meteors: Meteor[] = [];
  const meteorSprites: HTMLCanvasElement[] = [];
  const ripples: Ripple[] = Array.from({ length: 10 }, () => ({
    active: false,
    layer: "mid",
    x: 0,
    y: 0,
    age: 0,
    duration: 0,
    radius: 0,
    rings: 1,
  }));

  const readTheme = (): Theme =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";

  const hasSavedTheme = () => {
    try {
      const value = localStorage.getItem(storageKey);
      return value === "light" || value === "dark";
    } catch {
      return false;
    }
  };

  let width = 1;
  let height = 1;
  let waterlineY = 1;
  let reduced = reduceQuery.matches;
  let inView = true;
  let pageVisible = !document.hidden;
  let frameId = 0;
  let running = false;
  let lastTime = 0;
  let lastPaintTime = 0;
  let enteredAt = performance.now();
  let weatherStarted = false;
  let weatherStartedAt = 0;
  let manuallyPaused = false;
  let currentTheme = readTheme();
  let weatherMix = currentTheme === "dark" ? 1 : 0;
  let targetWeatherMix = weatherMix;
  let themeTransitionTimer = 0;
  let intersectionObserver: IntersectionObserver | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const clamp = (value: number, minimum = 0, maximum = 1) =>
    Math.min(maximum, Math.max(minimum, value));

  const smoothstep = (start: number, end: number, value: number) => {
    const progress = clamp((value - start) / (end - start));
    return progress * progress * (3 - 2 * progress);
  };

  const randomBetween = (minimum: number, maximum: number) =>
    minimum + Math.random() * (maximum - minimum);

  const buildMeteorSprites = () => {
    meteorSprites.length = 0;
    [0.72, 1, 1.32].forEach((intensity) => {
      const sprite = document.createElement("canvas");
      sprite.width = 320;
      sprite.height = 40;
      const spriteContext = sprite.getContext("2d");
      if (!spriteContext) return;

      spriteContext.lineCap = "round";
      const glow = spriteContext.createLinearGradient(0, 20, 312, 20);
      glow.addColorStop(0, "rgba(163, 202, 214, 0)");
      glow.addColorStop(.7, `rgba(188, 219, 228, ${.08 * intensity})`);
      glow.addColorStop(1, `rgba(243, 250, 250, ${.36 * intensity})`);
      spriteContext.lineWidth = 12;
      spriteContext.strokeStyle = glow;
      spriteContext.beginPath();
      spriteContext.moveTo(4, 20);
      spriteContext.lineTo(312, 20);
      spriteContext.stroke();

      const core = spriteContext.createLinearGradient(0, 20, 312, 20);
      core.addColorStop(0, "rgba(198, 226, 232, 0)");
      core.addColorStop(.58, `rgba(214, 234, 237, ${.18 * intensity})`);
      core.addColorStop(1, `rgba(255, 255, 250, ${.94 * intensity})`);
      spriteContext.lineWidth = 2.1;
      spriteContext.strokeStyle = core;
      spriteContext.beginPath();
      spriteContext.moveTo(4, 20);
      spriteContext.lineTo(312, 20);
      spriteContext.stroke();

      const headGlow = spriteContext.createRadialGradient(312, 20, 0, 312, 20, 13);
      headGlow.addColorStop(0, `rgba(255, 255, 252, ${.95 * intensity})`);
      headGlow.addColorStop(.2, `rgba(232, 247, 247, ${.56 * intensity})`);
      headGlow.addColorStop(1, "rgba(208, 233, 239, 0)");
      spriteContext.fillStyle = headGlow;
      spriteContext.beginPath();
      spriteContext.arc(312, 20, 13, 0, Math.PI * 2);
      spriteContext.fill();

      meteorSprites.push(sprite);
    });
  };

  const layerCount = (layer: RainLayer) => {
    if (mobileQuery.matches) return layer === "far" ? 15 : layer === "mid" ? 5 : 2;
    return layer === "far" ? 36 : layer === "mid" ? 14 : 5;
  };

  const chooseImpactX = (layer: RainLayer) => {
    if (layer === "far") return randomBetween(width * .04, width * .99);
    if (layer === "near") return randomBetween(width * .06, width * .62);
    return Math.random() < .72
      ? randomBetween(width * .04, width * .7)
      : randomBetween(width * .72, width * .96);
  };

  const resetDrop = (drop: Drop, initial = false) => {
    const angle = (6.5 + randomBetween(-1.1, 1.1)) * Math.PI / 180;
    drop.baseDirectionX = -Math.sin(angle);
    drop.baseDirectionY = Math.cos(angle);
    drop.directionX = drop.baseDirectionX;
    drop.directionY = drop.baseDirectionY;
    drop.impactX = chooseImpactX(drop.layer);
    drop.impactY = drop.layer === "far"
      ? height * randomBetween(.76, .94)
      : waterlineY + randomBetween(-2, 2);

    if (drop.layer === "far") {
      drop.length = randomBetween(18, 36);
      drop.width = randomBetween(.55, .9);
      drop.speed = randomBetween(540, 720);
      drop.opacity = randomBetween(.1, .18);
    } else if (drop.layer === "mid") {
      drop.length = randomBetween(36, 64);
      drop.width = randomBetween(.85, 1.25);
      drop.speed = randomBetween(720, 980);
      drop.opacity = randomBetween(.18, .3);
    } else {
      drop.length = randomBetween(64, 104);
      drop.width = randomBetween(1.2, 1.75);
      drop.speed = randomBetween(980, 1280);
      drop.opacity = randomBetween(.3, .48);
    }

    drop.y = -drop.length - randomBetween(8, Math.max(30, height * .18));
    drop.x = drop.impactX - drop.directionX * ((drop.impactY - drop.y) / drop.directionY);
    drop.delay = initial
      ? randomBetween(0, 1.25)
      : drop.layer === "far"
        ? randomBetween(.12, .9)
        : drop.layer === "mid"
          ? randomBetween(.18, 1.1)
          : randomBetween(.55, 1.6);
  };

  const prewarmDrop = (drop: Drop) => {
    const travel = drop.impactY + drop.length;
    drop.y = -drop.length + travel * randomBetween(.08, .88);
    drop.x = drop.impactX - drop.directionX * ((drop.impactY - drop.y) / drop.directionY);
    drop.delay = 0;
  };

  const buildDrops = () => {
    drops.length = 0;
    (["far", "mid", "near"] as RainLayer[]).forEach((layer) => {
      for (let index = 0; index < layerCount(layer); index += 1) {
        const drop: Drop = {
          layer,
          x: 0,
          y: 0,
          impactX: 0,
          impactY: 0,
          baseDirectionX: 0,
          baseDirectionY: 1,
          directionX: 0,
          directionY: 1,
          length: 0,
          width: 0,
          speed: 0,
          opacity: 0,
          delay: 0,
        };
        resetDrop(drop, true);
        const prewarmCount = mobileQuery.matches
          ? layer === "far" ? 6 : layer === "mid" ? 2 : 1
          : layer === "far" ? 15 : layer === "mid" ? 6 : 2;
        if (index < prewarmCount) prewarmDrop(drop);
        drops.push(drop);
      }
    });
    ripples.forEach((ripple) => { ripple.active = false; });
    hero.dataset.rainDrops = String(drops.length);
  };

  const resetMeteor = (meteor: Meteor, initial = false) => {
    const angle = randomBetween(34, 43) * Math.PI / 180;
    meteor.directionX = -Math.cos(angle);
    meteor.directionY = Math.sin(angle);
    meteor.x = randomBetween(width * .48, width * 1.18);
    meteor.y = randomBetween(-height * .14, height * .22);
    meteor.length = randomBetween(mobileQuery.matches ? 86 : 130, mobileQuery.matches ? 150 : 245);
    meteor.width = randomBetween(.8, 1.45);
    meteor.speed = randomBetween(mobileQuery.matches ? 360 : 470, mobileQuery.matches ? 510 : 690);
    meteor.opacity = randomBetween(.46, .86);
    meteor.delay = initial ? randomBetween(.25, 2.8) : randomBetween(1.8, 5.4);
    meteor.fadeStart = height * randomBetween(.5, .62);
    meteor.fadeEnd = meteor.fadeStart + height * randomBetween(.1, .16);
    meteor.fadeProgress = 0;
    meteor.shimmer = randomBetween(0, Math.PI * 2);
    meteor.spriteIndex = Math.floor(randomBetween(0, meteorSprites.length));
  };

  const buildMeteors = () => {
    meteors.length = 0;
    const count = mobileQuery.matches ? 4 : 7;
    for (let index = 0; index < count; index += 1) {
      const meteor: Meteor = {
        x: 0,
        y: 0,
        directionX: -1,
        directionY: 1,
        length: 0,
        width: 0,
        speed: 0,
        opacity: 0,
        delay: 0,
        fadeStart: 0,
        fadeEnd: 0,
        fadeProgress: 0,
        shimmer: 0,
        spriteIndex: 0,
      };
      resetMeteor(meteor, true);
      meteor.delay += index * .72;
      meteors.push(meteor);
    }
    hero.dataset.meteors = String(meteors.length);
  };

  const spawnRipple = (drop: Drop) => {
    if (drop.layer === "far") return;
    const ripple = ripples.find((candidate) => !candidate.active)
      || ripples.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest);

    ripple.active = true;
    ripple.layer = drop.layer;
    ripple.x = drop.impactX;
    ripple.y = drop.impactY;
    ripple.age = 0;
    ripple.duration = drop.layer === "near" ? randomBetween(950, 1300) : randomBetween(720, 1020);
    ripple.radius = drop.layer === "near" ? randomBetween(46, 62) : randomBetween(28, 42);
    ripple.rings = drop.layer === "near" ? 2 : 1;
  };

  const drawRainDrops = () => {
    const styles: Record<RainLayer, { core: string; coreWidth: number; soft: string; softWidth: number }> = {
      far: { core: "rgba(27, 29, 27, .14)", coreWidth: .72, soft: "rgba(34, 36, 33, .035)", softWidth: 1.8 },
      mid: { core: "rgba(27, 29, 27, .26)", coreWidth: 1.05, soft: "rgba(34, 36, 33, .065)", softWidth: 2.6 },
      near: { core: "rgba(27, 29, 27, .43)", coreWidth: 1.5, soft: "rgba(34, 36, 33, .1)", softWidth: 3.6 },
    };

    context.lineCap = "round";
    (["far", "mid", "near"] as RainLayer[]).forEach((layer) => {
      const visible = drops.filter((drop) =>
        drop.layer === layer && drop.delay <= 0 && drop.y >= -drop.length && drop.y <= drop.impactY);
      if (!visible.length) return;

      const drawBatch = (strokeStyle: string, lineWidth: number, lengthScale: number) => {
        context.strokeStyle = strokeStyle;
        context.lineWidth = lineWidth;
        context.beginPath();
        visible.forEach((drop) => {
          context.moveTo(
            drop.x - drop.directionX * drop.length * lengthScale,
            drop.y - drop.directionY * drop.length * lengthScale,
          );
          context.lineTo(drop.x, drop.y);
        });
        context.stroke();
      };

      drawBatch(styles[layer].soft, styles[layer].softWidth, 1);
      drawBatch(styles[layer].core, styles[layer].coreWidth, .82);
    });
  };

  const drawRipple = (ripple: Ripple) => {
    if (!ripple.active) return;
    const progress = clamp(ripple.age / ripple.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const radius = 2 + (ripple.radius - 2) * eased;
    const opacity = (ripple.layer === "near" ? .28 : .18) * (1 - progress);
    const verticalScale = ripple.layer === "near" ? .19 : .15;

    context.lineWidth = ripple.layer === "near" ? .95 : .75;
    context.strokeStyle = `rgba(34, 36, 33, ${opacity})`;
    context.beginPath();
    context.ellipse(ripple.x, ripple.y, radius, radius * verticalScale, 0, 0, Math.PI * 2);
    context.stroke();

    if (ripple.rings === 2 && progress > .18) {
      const secondProgress = (progress - .18) / .82;
      const secondRadius = 2 + ripple.radius * .68 * (1 - Math.pow(1 - secondProgress, 3));
      context.strokeStyle = `rgba(34, 36, 33, ${opacity * .52})`;
      context.beginPath();
      context.ellipse(ripple.x, ripple.y, secondRadius, secondRadius * verticalScale, 0, 0, Math.PI * 2);
      context.stroke();
    }
  };

  const drawMeteor = (meteor: Meteor, time: number) => {
    if (meteor.delay > 0) return;
    const shimmer = .9 + Math.sin(time * .008 + meteor.shimmer) * .1;
    const vanish = 1 - smoothstep(.04, .96, meteor.fadeProgress);
    const sprite = meteorSprites[meteor.spriteIndex] || meteorSprites[0];
    if (!sprite) return;

    context.save();
    context.globalAlpha *= meteor.opacity * shimmer * vanish;
    context.translate(meteor.x, meteor.y);
    context.rotate(Math.atan2(meteor.directionY, meteor.directionX));
    const lengthScale = .62 + vanish * .38;
    const spriteLength = meteor.length * lengthScale;
    const spriteHeight = (28 + meteor.width * 7) * (.76 + vanish * .24);
    context.drawImage(sprite, -spriteLength, -spriteHeight / 2, spriteLength, spriteHeight);
    context.restore();
  };

  const updateRain = (delta: number, time: number) => {
    const wind = Math.sin(time * .00017) * 14 + Math.sin(time * .000047) * 9;
    drops.forEach((drop) => {
      if (drop.delay > 0) {
        drop.delay = Math.max(0, drop.delay - delta);
        return;
      }
      const windWeight = drop.layer === "near" ? 1 : drop.layer === "mid" ? .65 : .35;
      const velocityX = drop.baseDirectionX * drop.speed + wind * windWeight;
      const velocityY = drop.baseDirectionY * drop.speed;
      const velocityLength = Math.hypot(velocityX, velocityY);
      drop.directionX = velocityX / velocityLength;
      drop.directionY = velocityY / velocityLength;

      const stepX = velocityX * delta;
      const stepY = velocityY * delta;
      if (drop.y + stepY >= drop.impactY) {
        const impactRatio = clamp((drop.impactY - drop.y) / Math.max(stepY, .001));
        drop.x += stepX * impactRatio;
        drop.y = drop.impactY;
        drop.impactX = drop.x;
        spawnRipple(drop);
        resetDrop(drop);
      } else {
        drop.x += stepX;
        drop.y += stepY;
      }
    });

    ripples.forEach((ripple) => {
      if (!ripple.active) return;
      ripple.age += delta * 1000;
      if (ripple.age >= ripple.duration) ripple.active = false;
    });
  };

  const updateMeteors = (delta: number) => {
    meteors.forEach((meteor) => {
      if (meteor.delay > 0) {
        meteor.delay = Math.max(0, meteor.delay - delta);
        return;
      }
      meteor.x += meteor.directionX * meteor.speed * delta;
      meteor.y += meteor.directionY * meteor.speed * delta;
      if (meteor.y >= meteor.fadeStart) {
        meteor.fadeProgress = clamp(
          (meteor.y - meteor.fadeStart) / Math.max(meteor.fadeEnd - meteor.fadeStart, 1),
        );
      }
      if (meteor.x < -meteor.length || meteor.fadeProgress >= 1) resetMeteor(meteor);
    });
  };

  const drawWeather = (entryOpacity = 1, time = performance.now()) => {
    context.clearRect(0, 0, width, height);
    if (!weatherStarted || entryOpacity <= 0) return;

    const rainOpacity = entryOpacity * (1 - smoothstep(.05, .5, weatherMix));
    const meteorOpacity = entryOpacity * smoothstep(.58, 1, weatherMix);

    if (rainOpacity > .001) {
      context.save();
      context.globalAlpha = rainOpacity;
      drawRainDrops();
      ripples.forEach(drawRipple);
      context.restore();
    }

    if (meteorOpacity > .001) {
      context.save();
      context.globalAlpha = meteorOpacity;
      meteors.forEach((meteor) => drawMeteor(meteor, time));
      context.restore();
    }
  };

  const getScrollProgress = () => {
    const rect = hero.getBoundingClientRect();
    const travel = Math.max(1, hero.offsetHeight - window.innerHeight);
    return clamp(-rect.top / travel);
  };

  const applyScrollProgress = () => {
    const progress = getScrollProgress();
    const staticScene = reduced || mobileQuery.matches;
    const visualProgress = staticScene ? 0 : progress;
    const cameraProgress = smoothstep(.18, .96, visualProgress);
    const copyProgress = smoothstep(.3, .7, visualProgress);
    const exitProgress = smoothstep(.7, 1, visualProgress);
    const headerProgress = smoothstep(.64, .94, progress);

    hero.style.setProperty("--scene-scale", String(1 + cameraProgress * .075));
    hero.style.setProperty("--scene-x", `${cameraProgress * -2.4}vw`);
    hero.style.setProperty("--scene-y", `${cameraProgress * -1.2}vh`);
    hero.style.setProperty("--copy-y", `${copyProgress * -58}px`);
    hero.style.setProperty("--copy-opacity", String(1 - copyProgress));
    hero.style.setProperty("--weather-opacity", String(1 - smoothstep(.72, .98, visualProgress)));
    hero.style.setProperty("--mist-rise", `${exitProgress * -78}px`);
    hero.style.setProperty("--exit-opacity", String(exitProgress));
    hero.style.setProperty("--mark-opacity", String(1 - smoothstep(.5, .78, visualProgress)));

    if (header) {
      header.style.setProperty("--home-header-progress", String(headerProgress));
      header.style.setProperty("--home-header-alpha", String(headerProgress * .9));
      header.style.setProperty("--home-header-line", String(headerProgress * .13));
      header.style.setProperty("--home-header-blur", `${headerProgress * 16}px`);
      header.style.visibility = headerProgress > .015 ? "visible" : "hidden";
      header.style.pointerEvents = headerProgress > .08 ? "auto" : "none";
    }
  };

  const shouldRun = () => !reduced && !manuallyPaused && inView && pageVisible;

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

    const themeLabel = dark ? "切换至山雨" : "切换至夜色";
    if (themeControl) {
      themeControl.setAttribute("aria-pressed", String(dark));
      themeControl.setAttribute("aria-label", themeLabel);
      themeControl.title = themeLabel;
    }
    if (themeControlLabel) themeControlLabel.textContent = themeLabel;
    hero.dataset.weather = dark ? "meteor" : "rain";
    hero.toggleAttribute("data-weather-paused", manuallyPaused);
  };

  const updateThemeOrigin = () => {
    if (!themeControl) return;
    const controlRect = themeControl.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    hero.style.setProperty("--theme-origin-x", `${controlRect.left + controlRect.width / 2 - stageRect.left}px`);
    hero.style.setProperty("--theme-origin-y", `${controlRect.top + controlRect.height / 2 - stageRect.top}px`);
  };

  const setTheme = (theme: Theme, persist: boolean) => {
    updateThemeOrigin();
    currentTheme = theme;
    targetWeatherMix = theme === "dark" ? 1 : 0;
    document.documentElement.dataset.theme = theme;
    hero.dataset.themeTransition = theme;
    const themeColor = document.querySelector<HTMLMetaElement>("meta[data-theme-color]");
    themeColor?.setAttribute("content", theme === "dark" ? "#09111b" : "#faf9f5");
    if (persist) {
      try { localStorage.setItem(storageKey, theme); } catch {}
    }
    if (manuallyPaused) {
      weatherMix = targetWeatherMix;
      drawWeather(1);
    }
    updateControls();
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      delete hero.dataset.themeTransition;
    }, 1100);
    window.dispatchEvent(new CustomEvent("wrain:theme-change", { detail: { theme } }));
    if (shouldRun()) startFrame();
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
      const step = delta / .82;
      weatherMix += Math.sign(targetWeatherMix - weatherMix)
        * Math.min(Math.abs(targetWeatherMix - weatherMix), step);
    } else {
      weatherMix = targetWeatherMix;
    }

    if (!weatherStarted && time - enteredAt > 620) {
      weatherStarted = true;
      weatherStartedAt = time;
    }
    if (weatherStarted && !manuallyPaused) {
      const rainActivity = 1 - smoothstep(.05, .5, weatherMix);
      const meteorActivity = smoothstep(.58, 1, weatherMix);
      if (rainActivity > .001) updateRain(delta, time);
      if (meteorActivity > .001) updateMeteors(delta);
    }
    const entryOpacity = weatherStarted ? clamp((time - weatherStartedAt) / 260) : 0;
    drawWeather(entryOpacity, time);
    frameId = window.requestAnimationFrame(frame);
  };

  const stopFrame = (clear = false) => {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = 0;
    running = false;
    lastTime = 0;
    lastPaintTime = 0;
    if (clear) context.clearRect(0, 0, width, height);
  };

  function startFrame() {
    if (running || !shouldRun()) return;
    running = true;
    lastTime = 0;
    lastPaintTime = 0;
    frameId = window.requestAnimationFrame(frame);
  }

  const syncPlayback = () => {
    applyScrollProgress();
    updateControls();
    if (shouldRun()) startFrame();
    else stopFrame(reduced);
  };

  const resizeCanvas = () => {
    const stageRect = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(stageRect.width));
    height = Math.max(1, Math.round(stageRect.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, mobileQuery.matches ? 1.12 : 1.35);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    waterlineY = waterline
      ? waterline.getBoundingClientRect().top - stageRect.top
      : height * .89;
    buildDrops();
    buildMeteors();
    updateThemeOrigin();
    drawWeather();
    applyScrollProgress();
  };

  const onVisibilityChange = () => {
    pageVisible = !document.hidden;
    syncPlayback();
  };

  const onScroll = () => {
    applyScrollProgress();
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

  const onSystemThemeChange = (event: MediaQueryListEvent) => {
    if (!hasSavedTheme()) setTheme(event.matches ? "dark" : "light", false);
  };

  const onThemeControlClick = () => {
    setTheme(currentTheme === "dark" ? "light" : "dark", true);
  };

  const onWeatherControlClick = () => {
    manuallyPaused = !manuallyPaused;
    updateControls();
    if (manuallyPaused) stopFrame(false);
    else if (shouldRun()) startFrame();
  };

  const onExternalThemeChange = (event: Event) => {
    const detail = (event as CustomEvent<{ theme?: Theme }>).detail;
    if (!detail?.theme || detail.theme === currentTheme) return;
    updateThemeOrigin();
    currentTheme = detail.theme;
    targetWeatherMix = currentTheme === "dark" ? 1 : 0;
    hero.dataset.themeTransition = currentTheme;
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = window.setTimeout(() => {
      delete hero.dataset.themeTransition;
    }, 1100);
    updateControls();
    if (shouldRun()) startFrame();
  };

  const cleanup = () => {
    stopFrame(true);
    window.clearTimeout(themeTransitionTimer);
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("astro:before-swap", cleanup);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("wrain:theme-change", onExternalThemeChange);
    reduceQuery.removeEventListener("change", onReducedMotionChange);
    mobileQuery.removeEventListener("change", onMobileChange);
    themeQuery.removeEventListener("change", onSystemThemeChange);
    weatherControl?.removeEventListener("click", onWeatherControlClick);
    themeControl?.removeEventListener("click", onThemeControlClick);
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
  reduceQuery.addEventListener("change", onReducedMotionChange);
  mobileQuery.addEventListener("change", onMobileChange);
  themeQuery.addEventListener("change", onSystemThemeChange);
  weatherControl?.addEventListener("click", onWeatherControlClick);
  themeControl?.addEventListener("click", onThemeControlClick);

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

  buildMeteorSprites();
  resizeCanvas();
  applyScrollProgress();
  updateControls();
  const initialThemeColor = document.querySelector<HTMLMetaElement>("meta[data-theme-color]");
  initialThemeColor?.setAttribute("content", currentTheme === "dark" ? "#09111b" : "#faf9f5");
  window.requestAnimationFrame(() => {
    enteredAt = performance.now();
    hero.setAttribute("data-entered", "true");
    syncPlayback();
  });
}
