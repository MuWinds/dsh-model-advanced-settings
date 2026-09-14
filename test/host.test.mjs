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
