/**
 * Render harness for the browser half of @muwinds/dsh-model-advanced-settings.
 *
 * `lib/client.js` is a plain browser bundle: it registers itself through
 * `window.__ModuleLoader__` and asks for `react` by name. This module supplies
 * both — a tiny hook shim that reproduces React's call-order indexing, and a
 * `document`/`fetch` stub — so a test can mount the page, drive its handlers,
 * and read the resulting element tree without a browser.
 */
import { readFileSync } from "node:fs";

/** Capture rendered elements with the same shape `createElement` would build. */
function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat() };
}

/**
 * Mount the client bundle.
 *
 * The shim keeps one slot array per mounted page and resets its cursor each
 * render pass, which is what makes `useState`/`useEffect` indices line up the
 * way React requires. Effects run on the first render only; their cleanups are
 * deliberately not called, because the page's load effect uses its cleanup to
 * mark itself unmounted and would otherwise discard the fetched result.
 * @param options - `{load}` overrides the /load response.
 * @returns the mounted page's helpers.
 */
export function mountClient(options = {}) {
  const load = options.load ?? {
    routes: [{
      route: "laneai",
      displayName: "test123",
      retryPolicy: { mode: "always" },
      models: [
        { id: "a", name: "A", input: ["text", "image"], effectiveInput: ["text", "image"], reasoningEfforts: { low: "low" } },
        { id: "b", name: "B", effectiveInput: ["text"], reasoningEfforts: false },
      ],
    }],
    subagent: { provider: "", model: "" },
  };

  const calls = [];
  const slots = [];
  const pending = [];
  let cursor = 0;
  let effectsRan = false;

  const react = {
    createElement,
    useState: (init) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
      return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useEffect: (fn) => { cursor++; pending.push(fn); },
  };

  const saved = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document };
  globalThis.fetch = async (url, init) => {
    const action = String(url).split("/").pop();
    const body = JSON.parse(init.body);
    calls.push({ action, body });
    return { json: async () => (action === "load" ? load : { ok: true }) };
  };

  let Page;
  const sections = [];
  const ctx = {
    effect: () => {},
    locale: { register: () => {} },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, component) => { sections.push(meta); Page = component; },
    },
  };

  let exports;
  globalThis.window = {
    __ModuleLoader__: {
      // The loader hands back whatever the factory returns, which is the
      // plugin's exports object carrying `apply`/`inject`.
      load: ({ factory }) => {
        exports = factory((name) => {
          if (name === "react") return react;
          throw new Error("unexpected require: " + name);
        });
      },
    },
  };
  globalThis.document = {
    documentElement: { lang: options.locale ?? "zh" },
    getElementById: () => null,
    createElement: () => ({ style: {} }),
    head: { appendChild: () => {} },
  };

  // The bundle is an IIFE over `window`, so evaluating it registers the plugin.
  // The mount guard is deliberately process-wide, so a previous mount must be
  // released before this one can register its section.
  delete globalThis.window["@muwinds/dsh-model-advanced-settings/mounted"];
  new Function(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"))();
  exports.apply(ctx);

  const render = () => {
    cursor = 0;
    pending.length = 0;
    const tree = Page();
    if (!effectsRan) {
      effectsRan = true;
      for (const fn of pending) fn();
    }
    return tree;
  };

  /** Flush the pending /load promise, then render with the loaded state. */
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return render();
  };

  const restore = () => {
    globalThis.fetch = saved.fetch;
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  };

  return { render, settle, calls, sections, restore };
}

/** Flatten a rendered tree into `{type, className, props, text}` entries. */
export function walk(node, out = []) {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (typeof node === "string" || typeof node === "number") { out.push({ text: String(node) }); return out; }
  const entry = { type: node.type, className: node.props.className, props: node.props, children: [] };
  out.push(entry);
  for (const child of node.children) {
    const kids = [];
    walk(child, kids);
    entry.children.push(...kids);
    out.push(...kids);
  }
  return out;
}

/** Every rendered node carrying the given class. */
export function byClass(tree, className) {
  return walk(tree).filter((n) => typeof n.className === "string" && n.className.split(" ").includes(className));
}

/** The text of a node's direct children, joined. */
export function textOf(node) {
  return node.children.filter((c) => c.text !== undefined).map((c) => c.text).join("");
}

/** One checkbox inside a class-tagged node. */
export function checkboxOf(node) {
  return node.children.find((c) => c.props && c.props.type === "checkbox");
}
