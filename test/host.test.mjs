/**
 * Regression tests for the host half (@muwinds/dsh-model-advanced-settings).
 *
 * Run with `node --test test/`. Mounts apply() against a fake ctx and drives
 * the /dsh-model-advanced/* handler directly, covering the reasoning-effort,
 * retry-policy, DeveloperRole, and subagent-default behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, Config } from "../lib/index.js";

const MOUNT_GUARD = Symbol.for("@muwinds/dsh-model-advanced-settings/mounted");

/** A settings document shaped like a real llm-pi-ai user layer. */
function fixture() {
  return {
    providers: {
      laneai: {
        displayName: "test123",
        models: [
          { id: "a", name: "A", input: ["text", "image"], reasoningEfforts: { low: "low" } },
          { id: "b", name: "B", reasoningEfforts: false },
        ],
        retryPolicy: { mode: "always" },
      },
    },
  };
}

/** A mutable stand-in for one schemastery `.volatile()` reference. */
function ref(value) {
  const box = { value, get() { return box.value; } };
  return box;
}

/**
 * Mount the plugin against a fake harness.
 * @param options - `{doc, subagent, namespace, mutate, noSettings}` overrides.
 * @returns `{post, writes, routes, config}` where `post` drives the HTTP handler.
 */
function mount(options = {}) {
  delete globalThis[MOUNT_GUARD];
  const doc = options.doc ?? fixture();
  const writes = [];
  const routes = [];
  const config = {
    subagentProvider: ref(options.subagent?.provider ?? ""),
    subagentModel: ref(options.subagent?.model ?? ""),
  };
  const settings = {
    describe: () => [{ ns: "llm-pi-ai", user: structuredClone(doc) }],
    mutate: async (ns, ops) => {
      if (options.mutate !== undefined) await options.mutate(ns, ops);
      writes.push({ ns, ops: JSON.parse(JSON.stringify(ops)) });
    },
  };
  let handler;
  apply({
    get: (name) => (name === "settings" && options.noSettings !== true ? settings : undefined),
    // The plugin registers the route and the mount guard through effects, so
    // the fake has to run them the way cordis does.
    effect: (fn) => fn(),
    on: () => {},
    fiber: { entry: { options: { id: options.namespace ?? "model-advanced-settings" } } },
    webServer: { register: (route) => { routes.push(route); handler = route.handler; return () => {}; } },
  }, config);
  const post = async (action, body) => {
    const req = {
      method: "POST",
      url: "/dsh-model-advanced/" + action,
      on(event, cb) {
        if (event === "data") cb(Buffer.from(JSON.stringify(body ?? {})));
        if (event === "end") cb();
      },
    };
    let status;
    let payload;
    await handler(req, {
      writeHead: (s) => { status = s; },
      end: (text) => { payload = JSON.parse(text); },
    });
    return { status, payload };
  };
  return { post, writes, routes, config };
}

test("the route is a prefix route registered through an effect", async () => {
  const { routes } = mount();
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, "prefix");
  assert.equal(routes[0].path, "/dsh-model-advanced");
  assert.equal(typeof routes[0].handler, "function");
});

test("load exposes each route's models, levels, and retry policy", async () => {
  const { post } = mount();
  const { status, payload } = await post("load", {});
  assert.equal(status, 200);
  const [route] = payload.routes;
  assert.equal(route.route, "laneai");
  assert.equal(route.displayName, "test123");
  assert.deepEqual(route.retryPolicy, { mode: "always" });
  assert.deepEqual(route.models.map((m) => m.id), ["a", "b"]);
  assert.deepEqual(route.models[0].reasoningEfforts, { low: "low" });
  assert.equal(route.models[1].reasoningEfforts, false);
});

test("load keeps the page's view of a route to the fields it manages", async () => {
  const { post } = mount();
  const { payload } = await post("load", {});
  // Input modalities belong to the harness Models page now; restating them
  // here would be a second writer of one field.
  assert.equal("input" in payload.routes[0].models[0], false);
  assert.equal("effectiveInput" in payload.routes[0].models[0], false);
});

test("load reports no routes when the settings service is unavailable", async () => {
  const { post } = mount({ noSettings: true });
  const { payload } = await post("load", {});
  assert.deepEqual(payload.routes, []);
  assert.deepEqual(payload.subagent, { provider: "", model: "" });
});

test("save writes thinking levels and the retry policy", async () => {
  const { post, writes } = mount();
  const { payload } = await post("save", {
    route: "laneai",
    models: [
      { id: "a", reasoningEfforts: { low: "low", max: "max" } },
      { id: "b", reasoningEfforts: false },
    ],
    retryPolicy: { mode: "normal", maxRetries: 3 },
  });
  assert.equal(payload.ok, true);
  assert.equal(writes[0].ns, "llm-pi-ai");
  const next = writes[0].ops[0].value;
  assert.deepEqual(next[0].reasoningEfforts, { low: "low", max: "max" });
  assert.equal(next[1].reasoningEfforts, false);
  assert.deepEqual(writes[0].ops[1], {
    op: "set",
    path: ["providers", "laneai", "retryPolicy"],
    value: { mode: "normal", maxRetries: 3 },
  });
});

test("save preserves the fields this page does not own", async () => {
  const { post, writes } = mount();
  await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }, { id: "b", reasoningEfforts: false }],
    retryPolicy: { mode: "always" },
  });
  const next = writes[0].ops[0].value;
  // `input` and the capacity fields belong to the Models page; a save here
  // must not silently erase them.
  assert.deepEqual(next[0].input, ["text", "image"]);
  assert.equal(next[0].name, "A");
});

test("save reports an unknown provider and a bad reasoning level", async () => {
  const { post } = mount();
  assert.equal((await post("save", {
    route: "nope",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }],
  })).payload.error, "no user-declared models for this provider");

  assert.match((await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { bogus: "x" } }, { id: "b", reasoningEfforts: false }],
  })).payload.error, /unknown level "bogus"/);

  assert.match((await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "" } }, { id: "b", reasoningEfforts: false }],
  })).payload.error, /must not be an empty string/);

  assert.equal((await post("save", {
    route: "laneai",
    models: [{ id: "nope", reasoningEfforts: { low: "low" } }],
  })).payload.error, "no matching model");
});

test("a second apply is a no-op while the first fiber is mounted", async () => {
  const first = mount();
  let mountedAgain = false;
  apply({
    get: () => undefined,
    effect: () => {},
    on: () => {},
    fiber: { entry: { options: { id: "model-advanced-settings" } } },
    webServer: { register: () => { mountedAgain = true; } },
  }, {});
  assert.equal(mountedAgain, false, "the process-wide guard rejects a duplicate mount");
  assert.equal((await first.post("load", {})).status, 200);
});

/** A one-model route whose protocol and compat switches the test chooses. */
function developerRoleDoc(api, compat) {
  return {
    providers: {
      laneai: {
        displayName: "test123",
        ...api === undefined ? {} : { api },
        ...compat === undefined ? {} : { compat },
        models: [{ id: "a", name: "A", reasoningEfforts: { low: "low" } }],
      },
    },
  };
}

/** The compat op of a save, or undefined when the request wrote none. */
function compatOp(writes) {
  return writes[0].ops.find((op) => op.path.join(".") === "providers.laneai.compat.supportsDeveloperRole");
}

test("load exposes the stored DeveloperRole switch without the rest of compat", async () => {
  const { post } = mount({ doc: developerRoleDoc("openai-completions", { supportsDeveloperRole: false, supportsReasoningEffort: true }) });
  const { payload } = await post("load", {});
  assert.equal(payload.routes[0].supportsDeveloperRole, false);
  assert.equal("compat" in payload.routes[0], false, "sibling compat switches are not part of the page's view");
});

test("load leaves an unset DeveloperRole switch absent, which is not `false`", async () => {
  const { post } = mount();
  const { payload } = await post("load", {});
  // An absent key is pi-ai's "detect it from the URL", and the page has to be
  // able to tell that apart from a stored `false`.
  assert.equal("supportsDeveloperRole" in payload.routes[0], false);
});

test("save writes DeveloperRole as a narrow op under the provider's compat", async () => {
  const { post, writes } = mount({ doc: developerRoleDoc("openai-completions", { supportsReasoningEffort: true }) });
  const { payload } = await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }],
    supportsDeveloperRole: true,
  });
  assert.equal(payload.ok, true);
  // A whole-dict write would silently drop `supportsReasoningEffort`, which
  // this page does not manage.
  assert.deepEqual(compatOp(writes), {
    op: "set",
    path: ["providers", "laneai", "compat", "supportsDeveloperRole"],
    value: true,
  });
});

test("choosing the default unsets the switch rather than storing false", async () => {
  const { post, writes } = mount({ doc: developerRoleDoc("openai-completions", { supportsDeveloperRole: true }) });
  const { payload } = await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }],
    supportsDeveloperRole: null,
  });
  assert.equal(payload.ok, true);
  assert.deepEqual(compatOp(writes), {
    op: "unset",
    path: ["providers", "laneai", "compat", "supportsDeveloperRole"],
  });
});

test("a caller that omits DeveloperRole leaves the stored switch alone", async () => {
  const { post, writes } = mount({ doc: developerRoleDoc("openai-completions", { supportsDeveloperRole: true }) });
  await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }],
  });
  assert.equal(compatOp(writes), undefined);
});

test("save refuses a DeveloperRole value that is not a boolean or null", async () => {
  const { post, writes } = mount();
  const { payload } = await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }, { id: "b", reasoningEfforts: false }],
    supportsDeveloperRole: "yes",
  });
  assert.match(payload.error, /supportsDeveloperRole must be true, false, or null/);
  assert.equal(writes.length, 0, "nothing is written for a refused request");
});

test("save refuses DeveloperRole on a protocol that has no such role", async () => {
  const { post, writes } = mount({ doc: developerRoleDoc("anthropic-messages") });
  const { payload } = await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }],
    supportsDeveloperRole: true,
  });
  // Anthropic Messages carries the system prompt in a top-level parameter, so
  // pi-ai would refuse the route; the page names the mistake first.
  assert.match(payload.error, /speaks "anthropic-messages", which has no developer role/);
  assert.equal(writes.length, 0);
});

test("a route with no declared protocol still accepts DeveloperRole", async () => {
  const { post, writes } = mount();
  const { payload } = await post("save", {
    route: "laneai",
    models: [{ id: "a", reasoningEfforts: { low: "low" } }, { id: "b", reasoningEfforts: false }],
    supportsDeveloperRole: false,
  });
  // A catalog route omits `api`; which protocol its models speak is the
  // installed catalog's business, so the page cannot decide it here.
  assert.equal(payload.ok, true);
  assert.equal(compatOp(writes).value, false);
});

// ---------- subagent default ----------

test("the subagent Config declares two volatile string fields", () => {
  // Volatility is what makes the entry editable live through ctx.settings and
  // therefore what makes the values durable in the profile patch.
  assert.deepEqual(Object.keys(Config.dict).sort(), ["subagentModel", "subagentProvider"]);
  for (const name of Object.keys(Config.dict)) {
    const field = Config.dict[name];
    assert.equal(field.type, "string", `${name} must be a string`);
    assert.equal(field.meta.volatile, true, `${name} must be volatile to be editable live`);
  }
  // The serialized schema is what the settings service projects into a form, so
  // volatility has to survive the round trip too.
  const json = Config.toJSON();
  const root = json.refs[json.uid];
  for (const name of Object.keys(root.dict)) {
    assert.equal(json.refs[root.dict[name]].meta.volatile, true, `${name} loses volatility in toJSON()`);
  }
});

test("load reads the subagent default from the plugin's own config", async () => {
  const { post, config } = mount({ subagent: { provider: "laneai", model: "a" } });
  const first = await post("load", {});
  assert.deepEqual(first.payload.subagent, { provider: "laneai", model: "a" });
  // A reactive field is read at request time, so a settings write that lands
  // without a remount is visible immediately.
  config.subagentProvider.value = "agentrouter";
  const second = await post("load", {});
  assert.deepEqual(second.payload.subagent, { provider: "agentrouter", model: "a" });
});

test("saving the subagent default writes this plugin's own settings entry", async () => {
  const { post, writes } = mount();
  const { payload } = await post("subagent", { provider: "laneai", model: "a" });
  assert.equal(payload.ok, true);
  // The namespace is the loader entry id `ctx.settings` addresses, not a
  // plugin-owned file beside the harness home: the platform owns persistence.
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ns, "model-advanced-settings");
  assert.deepEqual(writes[0].ops, [
    { op: "set", path: ["subagentProvider"], value: "laneai" },
    { op: "set", path: ["subagentModel"], value: "a" },
  ]);
});

test("clearing the subagent default stores empty strings, not a deletion", async () => {
  const { post, writes } = mount({ subagent: { provider: "laneai", model: "a" } });
  const { payload } = await post("subagent", {});
  assert.equal(payload.ok, true);
  assert.deepEqual(writes[0].ops.map((op) => op.value), ["", ""]);
});

test("a refused subagent write is reported rather than reported as saved", async () => {
  const { post } = mount({
    mutate: async () => { throw new Error("Config field \"subagentProvider\" is not volatile"); },
  });
  const { payload } = await post("subagent", { provider: "laneai", model: "a" });
  assert.equal(payload.ok, false);
  assert.match(payload.error, /not volatile/);
});

test("the subagent default cannot be saved without an addressable entry", async () => {
  const { post, writes } = mount({ namespace: "" });
  const { payload } = await post("subagent", { provider: "laneai", model: "a" });
  assert.equal(payload.ok, false);
  assert.match(payload.error, /settings entry/);
  assert.equal(writes.length, 0);
});

test("an absent settings service fails the subagent write instead of dropping it", async () => {
  const { post } = mount({ noSettings: true });
  const { payload } = await post("subagent", { provider: "laneai", model: "a" });
  assert.equal(payload.ok, false);
  assert.match(payload.error, /settings service unavailable/);
});

test("the subagent override reaches a delegated agent's request", async () => {
  delete globalThis[MOUNT_GUARD];
  const listeners = [];
  const agentListeners = [];
  apply({
    get: (name) => (name === "settings" ? { describe: () => [], mutate: async () => {} } : undefined),
    effect: (fn) => fn(),
    on: (name, listener) => { if (name === "agent/created") listeners.push(listener); },
    fiber: { entry: { options: { id: "model-advanced-settings" } } },
    webServer: { register: () => () => {} },
  }, { subagentProvider: ref("laneai"), subagentModel: ref("a") });

  assert.equal(listeners.length, 1);
  // A root agent is not a delegated one, so it is left alone.
  listeners[0]({ agent: { options: {}, ctx: { on: () => {} } } });
  assert.equal(agentListeners.length, 0);

  const agentCtx = { on: (name, listener) => { if (name === "agent/request") agentListeners.push(listener); } };
  listeners[0]({ agent: { options: { subagentDepth: 1 }, ctx: agentCtx } });
  assert.equal(agentListeners.length, 1);
  const resolved = await agentListeners[0]({}, async () => ({ provider: "parent", model: "parent-model", reasoningEffort: "high" }));
  assert.deepEqual(resolved, { provider: "laneai", model: "a", reasoningEffort: "high" });
});
