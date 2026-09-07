import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestEnvironmentOptions {
  reduced?: boolean;
  viewTransition?: boolean;
}

function createEnvironment(options: TestEnvironmentOptions = {}) {
  const properties = new Map<string, string>();
  const stored = new Map<string, string>();
  const label = { value: "", replaceChildren(value: string) { this.value = value; } };
  const attributes = new Map<string, string>();
  const control = {
    dataset: {
      themeLabelToDark: "切换至夜色",
      themeLabelToLight: "切换至山雨",
    },
    querySelector: () => label,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  };
  const root = {
    dataset: { theme: "light" } as Record<string, string>,
    style: {
      removeProperty: (name: string) => properties.delete(name),
      setProperty: (name: string, value: string) => properties.set(name, value),
    },
  };
  const meta = {
    content: "#faf9f5",
    setAttribute(name: string, value: string) {
      if (name === "content") this.content = value;
    },
  };
  const win = Object.assign(new EventTarget(), {
    innerHeight: 600,
    innerWidth: 1000,
    matchMedia: () => Object.assign(new EventTarget(), { matches: options.reduced ?? false }),
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    hidden: false,
    querySelector: (selector: string) => selector === "meta[data-theme-color]" ? meta : null,
    querySelectorAll: (selector: string) => selector === "[data-theme-control]" ? [control] : [],
  });

  if (options.viewTransition) {
    Object.assign(doc, {
      startViewTransition(update: () => void | Promise<void>) {
        const finished = Promise.resolve().then(update).then(() => undefined);
        return {
          finished,
          ready: finished,
          skipTransition() {},
          types: new Set(),
          updateCallbackDone: finished,
        };
      },
    });
  }

  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });

  return { attributes, control, doc, label, meta, properties, root, stored, win };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme transitions", () => {
  it("commits the theme and component-specific labels without animation", async () => {
    const env = createEnvironment();
    const { applyTheme } = await import("./theme");

    await applyTheme("dark", { animate: false });

    expect(env.root.dataset.theme).toBe("dark");
    expect(env.meta.content).toBe("#09111b");
    expect(env.stored.get("wrain-theme")).toBe("dark");
    expect(env.attributes.get("aria-pressed")).toBe("true");
    expect(env.attributes.get("aria-label")).toBe("切换至山雨");
    expect(env.label.value).toBe("切换至山雨");
  });

  it("reveals the new snapshot from the requested viewport point", async () => {
    const env = createEnvironment({ viewTransition: true });
    const events: string[] = [];
    let geometry: Record<string, string | undefined> = {};
    env.win.addEventListener("wrain:theme-transition-start", () => {
      geometry = {
        radius: env.properties.get("--theme-transition-radius"),
        x: env.properties.get("--theme-transition-x"),
        y: env.properties.get("--theme-transition-y"),
      };
      events.push("start");
    });
    env.win.addEventListener("wrain:theme-change", () => events.push("change"));
    env.win.addEventListener("wrain:theme-transition-end", () => events.push("end"));
    const { applyTheme } = await import("./theme");

    await applyTheme("dark", { origin: { x: 100, y: 60 } });

    expect(geometry).toEqual({ radius: "1050px", x: "100px", y: "60px" });
    expect(events).toEqual(["start", "change", "end"]);
    expect(env.root.dataset.theme).toBe("dark");
    expect(env.root.dataset.themeTransition).toBeUndefined();
    expect(env.properties.size).toBe(0);
  });

  it("skips snapshot animation when reduced motion is requested", async () => {
    const env = createEnvironment({ reduced: true, viewTransition: true });
    const start = vi.fn();
    env.win.addEventListener("wrain:theme-transition-start", start);
    const { applyTheme } = await import("./theme");

    await applyTheme("dark");

    expect(start).not.toHaveBeenCalled();
    expect(env.root.dataset.theme).toBe("dark");
    expect(env.properties.size).toBe(0);
  });
});
