/**
 * Regression tests for the host half (@muwinds/dsh-model-advanced-settings).
 *
 * Run with `node --test test/`. Mounts apply() against a fake ctx and drives
 * the /dsh-model-advanced/* handler directly, covering the per-model input
 * modality path alongside the reasoning-effort and retry-policy behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

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

/**
 * Mount the plugin against a fake harness.
 * @param options - `{doc, llm}` overrides for the settings document and adapter.
 * @returns `{post, writes}` where `post` drives the HTTP handler.
 */
function mount(options = {}) {
  delete globalThis[MOUNT_GUARD];
  const doc = options.doc ?? fixture();
  const writes = [];
  const settings = {
    describe: () => [{ ns: "llm-pi-ai", user: structuredClone(doc) }],
    mutate: async (ns, ops) => { writes.push({ ns, ops: JSON.parse(JSON.stringify(ops)) }); },
    prepareDocument: async () => "/tmp/settings.yaml",
  };
  const llm = options.llm ?? {
    listModels: async () => [
      { provider: "laneai", id: "a", name: "A", inputModalities: ["text", "image"] },
      { provider: "laneai", id: "b", name: "B", inputModalities: ["text"] },
    ],
  };
  let handler;
  apply({
    get: (name) => (name === "settings" ? settings : name === "llm" ? llm : undefined),
    effect: () => {},
    on: () => {},
    webServer: { register: (route) => { handler = route.handler; } },
  });
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
  return { post, writes };
}

test("load exposes each model's declared and resolved modalities", async () => {
  const { post } = mount();
  const { status, payload } = await post("load", {});
  assert.equal(status, 200);
  const [a, b] = payload.routes[0].models;
  // `input` is what the document declares; `effectiveInput` is what dispatch
  // will use, which the adapter resolves through the catalog/defaultInput chain.
  assert.deepEqual(a.input, ["text", "image"]);
  assert.deepEqual(a.effectiveInput, ["text", "image"]);
  assert.equal("input" in b, false, "an undeclared input is not invented");
  assert.deepEqual(b.effectiveInput, ["text"]);
});

test("load keeps working when the adapter cannot answer", async () => {
  const { post } = mount({
    llm: { listModels: async () => { throw new Error("NO_ADAPTER"); } },
  });
  const { payload } = await post("load", {});
  const [a] = payload.routes[0].models;
  assert.deepEqual(a.input, ["text", "image"]);
  assert.equal("effectiveInput" in a, false, "no hint when the adapter cannot resolve");
});

test("save writes a declared modality list and drops the field when cleared", async () => {
  const { post, writes } = mount();
  const { payload } = await post("save", {
    route: "laneai",
    models: [
      { id: "a", reasoningEfforts: { low: "low" } },
      { id: "b", input: ["text", "image"], reasoningEfforts: false },
    ],
    retryPolicy: { mode: "always" },
  });
  assert.equal(payload.ok, true);
  const next = writes[0].ops[0].value;
  assert.equal("input" in next[0], false, "clearing every box returns the model to inherit");
  assert.deepEqual(next[0].reasoningEfforts, { low: "low" });
  assert.deepEqual(next[1].input, ["text", "image"]);
  assert.equal(next[1].reasoningEfforts, false);
});

test("save stores no `input` for an empty list, which states no answer", async () => {
  const { post, writes } = mount();
  await post("save", {
    route: "laneai",
    models: [
      { id: "a", input: [], reasoningEfforts: { low: "low" } },
      { id: "b", reasoningEfforts: false },
    ],
    retryPolicy: { mode: "always" },
  });
  // dsh-llm-pi-ai reads absent and `[]` identically, so storing `[]` would be a
  // document claiming a declaration the user did not make.
  assert.equal("input" in writes[0].ops[0].value[0], false);
});

test("save rejects modality lists dsh-llm-pi-ai would refuse", async () => {
  const cases = [
    [["video"], 'model "a" input has unknown modality "video"; pi-ai offers text, image'],
    [["image", "image"], 'model "a" input lists "image" twice'],
    ["image", 'model "a" input must be an array of modalities'],
  ];
  for (const [input, expected] of cases) {
    const { post } = mount();
    const { payload } = await post("save", {
      route: "laneai",
      models: [{ id: "a", input, reasoningEfforts: { low: "low" } }, { id: "b", reasoningEfforts: false }],
    });
    assert.equal(payload.error, expected);
  }
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
});

test("a second apply is a no-op while the first fiber is mounted", async () => {
  const first = mount();
  let mountedAgain = false;
  apply({
    get: () => undefined,
    effect: () => {},
    on: () => {},
    webServer: { register: () => { mountedAgain = true; } },
  });
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
