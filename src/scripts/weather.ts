import { clamp, randomBetween, smoothstep } from "./motion";

type RainLayer = "far" | "mid" | "near";

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

interface Splash {
  active: boolean;
  layer: "mid" | "near";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  duration: number;
  size: number;
  opacity: number;
}

interface WeatherEngineOptions {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  waterline: HTMLElement | null;
  context: CanvasRenderingContext2D;
  isMobile: () => boolean;
}

export class WeatherEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly stage: HTMLElement;
  private readonly waterline: HTMLElement | null;
  private readonly context: CanvasRenderingContext2D;
  private readonly isMobile: () => boolean;

  private readonly drops: Drop[] = [];
  private readonly meteors: Meteor[] = [];
  private readonly meteorSprites: HTMLCanvasElement[] = [];
  private readonly ripples: Ripple[] = Array.from({ length: 10 }, () => ({
    active: false,
    layer: "mid",
    x: 0,
    y: 0,
    age: 0,
    duration: 0,
    radius: 0,
    rings: 1,
  }));
  private readonly splashes: Splash[] = Array.from({ length: 40 }, () => ({
    active: false,
    layer: "mid",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    duration: 0,
    size: 0,
    opacity: 0,
  }));

  private width = 1;
  private height = 1;
  private waterlineY = 1;
  private started = false;
  private startedAt = 0;

  constructor(options: WeatherEngineOptions) {
    this.canvas = options.canvas;
    this.stage = options.stage;
    this.waterline = options.waterline;
    this.context = options.context;
    this.isMobile = options.isMobile;
    this.buildMeteorSprites();
  }

  resize() {
    const stageRect = this.stage.getBoundingClientRect();
    this.width = Math.max(1, Math.round(stageRect.width));
    this.height = Math.max(1, Math.round(stageRect.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.isMobile() ? 1.12 : 1.35);
    this.canvas.width = Math.round(this.width * pixelRatio);
    this.canvas.height = Math.round(this.height * pixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.waterlineY = this.waterline
      ? this.waterline.getBoundingClientRect().top - stageRect.top
      : this.height * .89;
    this.buildDrops();
    this.buildMeteors();
  }

  start() {
    this.started = true;
    this.startedAt = performance.now();
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  tick(delta: number, time: number, weatherMix: number, advance: boolean) {
    if (advance) {
      const rainActivity = 1 - smoothstep(.05, .5, weatherMix);
      const meteorActivity = smoothstep(.58, 1, weatherMix);
      if (rainActivity > .001) this.updateRain(delta, time);
      if (meteorActivity > .001) this.updateMeteors(delta);
    }
    const entryOpacity = this.started ? clamp((time - this.startedAt) / 260) : 0;
    this.draw(entryOpacity, weatherMix, time);
  }

  drawStatic(weatherMix: number) {
    this.draw(1, weatherMix, performance.now());
  }

  private draw(entryOpacity: number, weatherMix: number, time: number) {
    const { context } = this;
    context.clearRect(0, 0, this.width, this.height);
    if (!this.started || entryOpacity <= 0) return;

    const rainOpacity = entryOpacity * (1 - smoothstep(.05, .5, weatherMix));
    const meteorOpacity = entryOpacity * smoothstep(.58, 1, weatherMix);

    if (rainOpacity > .001) {
      context.save();
      context.globalAlpha = rainOpacity;
      this.drawRainDrops();
      this.ripples.forEach((ripple) => this.drawRipple(ripple));
      this.splashes.forEach((splash) => this.drawSplash(splash));
      context.restore();
    }

    if (meteorOpacity > .001) {
      context.save();
      context.globalAlpha = meteorOpacity;
      this.meteors.forEach((meteor) => this.drawMeteor(meteor, time));
      context.restore();
    }
  }

  private buildMeteorSprites() {
    this.meteorSprites.length = 0;
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

      this.meteorSprites.push(sprite);
    });
  }

  private layerCount(layer: RainLayer) {
    if (this.isMobile()) return layer === "far" ? 12 : layer === "mid" ? 4 : 2;
    return layer === "far" ? 28 : layer === "mid" ? 12 : 4;
  }

  private chooseImpactX(layer: RainLayer) {
    if (layer === "far") return randomBetween(this.width * .04, this.width * .99);
    if (layer === "near") return randomBetween(this.width * .06, this.width * .62);
    return Math.random() < .72
      ? randomBetween(this.width * .04, this.width * .7)
      : randomBetween(this.width * .72, this.width * .96);
  }

  private resetDrop(drop: Drop, initial = false) {
    const angle = (6.5 + randomBetween(-1.1, 1.1)) * Math.PI / 180;
    drop.baseDirectionX = -Math.sin(angle);
    drop.baseDirectionY = Math.cos(angle);
    drop.directionX = drop.baseDirectionX;
    drop.directionY = drop.baseDirectionY;
    drop.impactX = this.chooseImpactX(drop.layer);
    drop.impactY = drop.layer === "far"
      ? this.height * randomBetween(.76, .94)
      : this.waterlineY + randomBetween(-2, 2);

    if (drop.layer === "far") {
      drop.length = randomBetween(18, 34);
      drop.width = randomBetween(.5, .8);
      drop.speed = randomBetween(600, 820);
      drop.opacity = randomBetween(.08, .15);
    } else if (drop.layer === "mid") {
      drop.length = randomBetween(36, 64);
      drop.width = randomBetween(.8, 1.1);
      drop.speed = randomBetween(820, 1120);
      drop.opacity = randomBetween(.16, .26);
    } else {
      drop.length = randomBetween(64, 104);
      drop.width = randomBetween(1.1, 1.5);
      drop.speed = randomBetween(1100, 1460);
      drop.opacity = randomBetween(.26, .4);
    }

    drop.y = -drop.length - randomBetween(8, Math.max(30, this.height * .18));
    drop.x = drop.impactX - drop.directionX * ((drop.impactY - drop.y) / drop.directionY);
    drop.delay = initial
      ? randomBetween(0, 1.25)
      : drop.layer === "far"
        ? randomBetween(.12, .9)
        : drop.layer === "mid"
          ? randomBetween(.18, 1.1)
          : randomBetween(.55, 1.6);
  }

  private prewarmDrop(drop: Drop) {
    const travel = drop.impactY + drop.length;
    drop.y = -drop.length + travel * randomBetween(.08, .88);
    drop.x = drop.impactX - drop.directionX * ((drop.impactY - drop.y) / drop.directionY);
    drop.delay = 0;
  }

  private buildDrops() {
    this.drops.length = 0;
    (["far", "mid", "near"] as RainLayer[]).forEach((layer) => {
      for (let index = 0; index < this.layerCount(layer); index += 1) {
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
        this.resetDrop(drop, true);
        const prewarmCount = this.isMobile()
          ? layer === "far" ? 6 : layer === "mid" ? 2 : 1
          : layer === "far" ? 15 : layer === "mid" ? 6 : 2;
        if (index < prewarmCount) this.prewarmDrop(drop);
        this.drops.push(drop);
      }
    });
    this.ripples.forEach((ripple) => { ripple.active = false; });
    this.splashes.forEach((splash) => { splash.active = false; });
  }

  private resetMeteor(meteor: Meteor, initial = false) {
    const angle = randomBetween(34, 43) * Math.PI / 180;
    meteor.directionX = -Math.cos(angle);
    meteor.directionY = Math.sin(angle);
    meteor.x = randomBetween(this.width * .48, this.width * 1.18);
    meteor.y = randomBetween(-this.height * .14, this.height * .22);
    meteor.length = randomBetween(this.isMobile() ? 96 : 150, this.isMobile() ? 172 : 285);
    meteor.width = randomBetween(.9, 1.6);
    meteor.speed = randomBetween(this.isMobile() ? 420 : 520, this.isMobile() ? 580 : 760);
    meteor.opacity = randomBetween(.46, .86);
    meteor.delay = initial ? randomBetween(.25, 2.8) : randomBetween(1.8, 5.4);
    meteor.fadeStart = this.height * randomBetween(.5, .62);
    meteor.fadeEnd = meteor.fadeStart + this.height * randomBetween(.1, .16);
    meteor.fadeProgress = 0;
    meteor.shimmer = randomBetween(0, Math.PI * 2);
    meteor.spriteIndex = Math.floor(randomBetween(0, this.meteorSprites.length));
  }

  private buildMeteors() {
    this.meteors.length = 0;
    const count = this.isMobile() ? 5 : 8;
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
      this.resetMeteor(meteor, true);
      meteor.delay += index * .72;
      this.meteors.push(meteor);
    }
  }

  private spawnSplash(drop: Drop) {
    if (drop.layer === "far") return;
    const count = drop.layer === "near" ? 3 : 2;
    for (let index = 0; index < count; index += 1) {
      const splash = this.splashes.find((candidate) => !candidate.active);
      if (!splash) break;
      const angle = Math.PI + randomBetween(-.95, .95);
      const speed = randomBetween(36, drop.layer === "near" ? 168 : 118);
      splash.active = true;
      splash.layer = drop.layer;
      splash.x = drop.impactX;
      splash.y = drop.impactY;
      splash.vx = Math.cos(angle) * speed;
      splash.vy = Math.sin(angle) * speed - randomBetween(40, 150);
      splash.age = 0;
      splash.duration = randomBetween(420, 720);
      splash.size = randomBetween(.8, drop.layer === "near" ? 2.4 : 1.7);
      splash.opacity = randomBetween(.24, .4);
    }
  }

  private spawnRipple(drop: Drop) {
    if (drop.layer === "far") return;
    const ripple = this.ripples.find((candidate) => !candidate.active)
      || this.ripples.reduce((oldest, candidate) => candidate.age > oldest.age ? candidate : oldest);

    ripple.active = true;
    ripple.layer = drop.layer;
    ripple.x = drop.impactX;
    ripple.y = drop.impactY;
    ripple.age = 0;
    ripple.duration = drop.layer === "near" ? randomBetween(950, 1300) : randomBetween(720, 1020);
    ripple.radius = drop.layer === "near" ? randomBetween(46, 62) : randomBetween(28, 42);
    ripple.rings = drop.layer === "near" ? 2 : 1;

    this.spawnSplash(drop);
  }

  private drawRainDrops() {
    const styles: Record<RainLayer, { core: string; coreWidth: number; soft: string; softWidth: number; head: string; headWidth: number }> = {
      far: { core: "rgba(27, 29, 27, .12)", coreWidth: .65, soft: "rgba(34, 36, 33, .03)", softWidth: 1.6, head: "rgba(45, 48, 44, 0)", headWidth: 0 },
      mid: { core: "rgba(27, 29, 27, .24)", coreWidth: .95, soft: "rgba(34, 36, 33, .06)", softWidth: 2.4, head: "rgba(47, 50, 46, .52)", headWidth: 1.05 },
      near: { core: "rgba(27, 29, 27, .4)", coreWidth: 1.35, soft: "rgba(34, 36, 33, .095)", softWidth: 3.4, head: "rgba(47, 50, 46, .72)", headWidth: 1.5 },
    };

    this.context.lineCap = "round";
    (["far", "mid", "near"] as RainLayer[]).forEach((layer) => {
      const visible = this.drops.filter((drop) =>
        drop.layer === layer && drop.delay <= 0 && drop.y >= -drop.length && drop.y <= drop.impactY);
      if (!visible.length) return;

      const drawBatch = (strokeStyle: string, lineWidth: number, lengthScale: number) => {
        this.context.strokeStyle = strokeStyle;
        this.context.lineWidth = lineWidth;
        this.context.beginPath();
        visible.forEach((drop) => {
          this.context.moveTo(
            drop.x - drop.directionX * drop.length * lengthScale,
            drop.y - drop.directionY * drop.length * lengthScale,
          );
          this.context.lineTo(drop.x, drop.y);
        });
        this.context.stroke();
      };

      drawBatch(styles[layer].soft, styles[layer].softWidth, 1);
      drawBatch(styles[layer].core, styles[layer].coreWidth, .82);
      if (layer !== "far") drawBatch(styles[layer].head, styles[layer].headWidth, .16);
    });
  }

  private drawRipple(ripple: Ripple) {
    if (!ripple.active) return;
    const progress = clamp(ripple.age / ripple.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const radius = 2 + (ripple.radius - 2) * eased;
    const opacity = (ripple.layer === "near" ? .28 : .18) * (1 - progress);
    const verticalScale = ripple.layer === "near" ? .19 : .15;

    this.context.lineWidth = ripple.layer === "near" ? .95 : .75;
    this.context.strokeStyle = `rgba(34, 36, 33, ${opacity})`;
    this.context.beginPath();
    this.context.ellipse(ripple.x, ripple.y, radius, radius * verticalScale, 0, 0, Math.PI * 2);
    this.context.stroke();

    if (ripple.rings === 2 && progress > .18) {
      const secondProgress = (progress - .18) / .82;
      const secondRadius = 2 + ripple.radius * .68 * (1 - Math.pow(1 - secondProgress, 3));
      this.context.strokeStyle = `rgba(34, 36, 33, ${opacity * .52})`;
      this.context.beginPath();
      this.context.ellipse(ripple.x, ripple.y, secondRadius, secondRadius * verticalScale, 0, 0, Math.PI * 2);
      this.context.stroke();
    }
  }

  private drawSplash(splash: Splash) {
    if (!splash.active) return;
    const progress = clamp(splash.age / splash.duration);
    const opacity = splash.opacity * (1 - progress);
    this.context.fillStyle = `rgba(34, 36, 33, ${opacity})`;
    this.context.beginPath();
    this.context.arc(splash.x, splash.y, splash.size, 0, Math.PI * 2);
    this.context.fill();
  }

  private drawMeteor(meteor: Meteor, time: number) {
    if (meteor.delay > 0) return;
    const shimmer = .9 + Math.sin(time * .008 + meteor.shimmer) * .1;
    const vanish = 1 - smoothstep(.04, .96, meteor.fadeProgress);
    const sprite = this.meteorSprites[meteor.spriteIndex] || this.meteorSprites[0];
    if (!sprite) return;

    this.context.save();
    this.context.globalAlpha *= meteor.opacity * shimmer * vanish;
    this.context.translate(meteor.x, meteor.y);
    this.context.rotate(Math.atan2(meteor.directionY, meteor.directionX));
    const lengthScale = .62 + vanish * .38;
    const spriteLength = meteor.length * lengthScale;
    const spriteHeight = (28 + meteor.width * 7) * (.76 + vanish * .24);
    this.context.drawImage(sprite, -spriteLength, -spriteHeight / 2, spriteLength, spriteHeight);
    this.context.restore();
  }

  private updateRain(delta: number, time: number) {
    const wind = Math.sin(time * .00019) * 22 + Math.sin(time * .000049) * 14 + Math.sin(time * .00092) * 5;
    this.drops.forEach((drop) => {
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
        this.spawnRipple(drop);
        this.resetDrop(drop);
      } else {
        drop.x += stepX;
        drop.y += stepY;
      }
    });

    this.ripples.forEach((ripple) => {
      if (!ripple.active) return;
      ripple.age += delta * 1000;
      if (ripple.age >= ripple.duration) ripple.active = false;
    });

    this.splashes.forEach((splash) => {
      if (!splash.active) return;
      splash.age += delta * 1000;
      splash.vy += 780 * delta;
      splash.x += splash.vx * delta;
      splash.y += splash.vy * delta;
      if (splash.age >= splash.duration) splash.active = false;
    });
  }

  private updateMeteors(delta: number) {
    this.meteors.forEach((meteor) => {
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
      if (meteor.x < -meteor.length || meteor.fadeProgress >= 1) this.resetMeteor(meteor);
    });
  }
}
