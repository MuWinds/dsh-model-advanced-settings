/**
 * Host half of the model-advanced-settings page (@muwinds/dsh-model-advanced-settings).
 *
 * Exposes a small JSON API under /dsh-model-advanced/* on the harness web server:
 *   POST /dsh-model-advanced/load        {}                        -> { routes, subagent }
 *   POST /dsh-model-advanced/save        { route, models, retryPolicy, supportsDeveloperRole } -> { ok }
 *   POST /dsh-model-advanced/subagent    { provider, model }        -> { ok }
 *
 * "routes" = llm-pi-ai providers that declare a user models list, each with its
 * models (id/name/input/reasoningEfforts), its retryPolicy, and its
 * compat.supportsDeveloperRole switch when one is stored. "subagent" is the
 * per-subagent default model, persisted to <harness home>/subagent-model.json
 * (derived from the settings document path). The browser half ships in the same
 * package (exports["./client"], dsh.client declaration).
 */

/** Wait for the browser HTTP carrier before registering the route. */
export const inject = ["webServer"];

/** Plugin display name for the loader. */
export const name = "dsh-model-advanced-settings";

/**
 * Process-wide guard against a second host apply mounting the same routes.
 * A standalone install and an aggregate bundle can coexist in one profile; the
 * second apply must be a no-op instead of re-registering `/dsh-model-advanced`
 * and failing the boot.
 */
const MOUNTED = Symbol.for("@muwinds/dsh-model-advanced-settings/mounted");

// ---------- helpers ----------

/** Rebuild sandbox/realm-agnostic values as null-prototype plain objects. */
function toHostPlain(value) {
  if (Array.isArray(value)) return value.map(toHostPlain);
  if (typeof value === "object" && value !== null) {
    const out = Object.create(null);
    for (const key of Object.keys(value)) out[key] = toHostPlain(value[key]);
    return out;
  }
  return value;
}

/** A non-empty string field, or undefined. */
function str(args, key) {
  const v = args === null || typeof args !== "object" ? undefined : args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

// ---------- settings / subagent persistence ----------

/**
 * The level vocabulary dsh-llm-pi-ai accepts, mirroring pi-ai's
 * `ModelThinkingLevel`. The settings schema validates dict KEYS against this
 * union, so a name outside it can never be stored; the list is closed upstream.
 */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The request modalities dsh-llm-pi-ai accepts, mirroring pi-ai's
 * `Model<Api>['input'][number]` union. A profile may name nothing else.
 */
const MODALITIES = ["text", "image"];

/**
 * The wire protocols whose compat takes `supportsDeveloperRole`, mirroring
 * dsh-llm-pi-ai's own compat gate — the four OpenAI-shaped protocols. Anthropic
 * Messages is deliberately absent: it carries the system prompt in a top-level
 * parameter, so it has no message role to switch.
 */
const DEVELOPER_ROLE_PROTOCOLS = [
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
];

/**
 * Validate one modality list before writing.
 *
 * An empty list is accepted and means "states no answer": dsh-llm-pi-ai treats
 * an absent and an empty `input` identically, so the caller stores the field
 * away rather than persisting `[]`. A non-empty list must name known modalities
 * with no repetition, because the settings schema would otherwise reject the
 * whole write with a message that does not name the offending model.
 * @param value - the request's modality list, or anything else.
 * @param label - field name used in the diagnostic.
 * @returns `{}` when acceptable, else `{error}`.
 */
function validateModalities(value, label) {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: `${label} must be an array of modalities` };
  const seen = new Set();
  for (const modality of value) {
    if (typeof modality !== "string" || !MODALITIES.includes(modality)) {
      return { error: `${label} has unknown modality ${JSON.stringify(modality)}; pi-ai offers ${MODALITIES.join(", ")}` };
    }
    if (seen.has(modality)) return { error: `${label} lists "${modality}" twice` };
    seen.add(modality);
  }
  return {};
}

/** Validate every model's `input` declaration. */
function validateInputs(models) {
  for (const model of models) {
    const id = model && typeof model.id === "string" ? model.id : "";
    const checked = validateModalities(model && model.input, `model "${id}" input`);
    if (checked.error !== undefined) return checked;
  }
  return {};
}

/**
 * Validate one route's DeveloperRole switch before writing it.
 *
 * An absent field and `null` both mean "states no answer", which pi-ai fills by
 * detecting the answer from the endpoint URL, so clearing the switch can never
 * be wrong and only a boolean is checked. A boolean is decidable only for a
 * route that names its protocol: the check stays silent when `api` is absent,
 * because a catalog route's models get their protocol from the installed
 * catalog and dsh-llm-pi-ai reports that refusal itself.
 * @param route - provider route key, used in the diagnostic.
 * @param profile - the stored provider profile, for its declared protocol.
 * @param value - the request's switch: a boolean, `null`, or absent.
 * @returns `{}` when acceptable, else `{error}`.
 */
function validateDeveloperRole(route, profile, value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "boolean") {
    return { error: "supportsDeveloperRole must be true, false, or null (leaving the choice to detection)" };
  }
  const api = profile !== null && typeof profile === "object" && typeof profile.api === "string" ? profile.api : undefined;
  if (api !== undefined && !DEVELOPER_ROLE_PROTOCOLS.includes(api)) {
    return {
      error: `provider "${route}" speaks "${api}", which has no developer role; the switch exists on ${DEVELOPER_ROLE_PROTOCOLS.join(", ")}`,
    };
  }
  return {};
}

/**
 * Validate the `reasoningEfforts` of every incoming model before writing.
 *
 * The settings schema alone is not enough: it accepts `{low: ""}` and
 * `{off: null}`, both of which `dsh-llm-pi-ai` rejects later at model
 * resolution — which would leave the provider unable to register. Refusing them
 * here keeps a bad request from persisting a config that breaks the route.
 * @param models - the request's model list.
 * @returns `{}` when every model is acceptable, else `{error}`.
 */
function validateEfforts(models) {
  for (const model of models) {
    const value = model && model.reasoningEfforts;
    if (value === false) continue;
    if (value === undefined) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { error: "reasoningEfforts must be a level dict or false" };
    }
    let hasThinking = false;
    for (const level of Object.keys(value)) {
      if (!THINKING_LEVELS.includes(level)) {
        return { error: `reasoningEfforts has unknown level "${level}"; the level vocabulary is fixed by pi-ai` };
      }
    }
    for (const level of THINKING_LEVELS) {
      if (!Object.prototype.hasOwnProperty.call(value, level)) continue;
      const wire = value[level];
      if (level === "off") {
        // `off` may be null ("supported, send nothing") or a wire string.
        if (wire !== null && typeof wire !== "string") return { error: 'reasoningEfforts.off must be a string or null' };
        continue;
      }
      if (typeof wire !== "string") {
        return { error: `reasoningEfforts.${level} needs the wire value dispatch should send; only "off" may leave it empty` };
      }
      if (wire.length === 0) return { error: `reasoningEfforts.${level} must not be an empty string` };
      hasThinking = true;
    }
    const keys = Object.keys(value);
    if (keys.length === 0) return { error: "reasoningEfforts must declare at least one level" };
    if (!hasThinking) return { error: 'reasoningEfforts offers no level beyond "off"' };
  }
  return {};
}

/** The llm-pi-ai namespace descriptor, or undefined. */
function piAiDescriptor(settings) {
  const descriptors = settings.describe();
  return descriptors.find((d) => d.ns === "llm-pi-ai");
}

/** Detached user-layer providers dict of llm-pi-ai. */
function userProviders(settings) {
  const desc = piAiDescriptor(settings);
  const user = desc && desc.user;
  return user && user.providers && typeof user.providers === "object" ? user.providers : {};
}

/** Provider routes that declare a user models list. */
function customRoutes(settings) {
  const providers = userProviders(settings);
  return Object.entries(providers)
    .filter(([, profile]) => profile && typeof profile === "object" && Array.isArray(profile.models))
    .map(([route, profile]) => {
      const compat = profile.compat !== null && typeof profile.compat === "object" && !Array.isArray(profile.compat) ? profile.compat : {};
      return {
        route,
        displayName: typeof profile.displayName === "string" && profile.displayName.length > 0 ? profile.displayName : route,
        ...profile.retryPolicy === undefined ? {} : { retryPolicy: profile.retryPolicy },
        // A route that stores no switch states no answer rather than `false`:
        // pi-ai detects the answer from the endpoint URL, and the page has to
        // be able to show that as its own "default" choice.
        ...typeof compat.supportsDeveloperRole === "boolean" ? { supportsDeveloperRole: compat.supportsDeveloperRole } : {},
        models: profile.models.map((model) => {
          const id = typeof model.id === "string" ? model.id : "";
          const entry = {
            id,
            name: typeof model.name === "string" && model.name.length > 0 ? model.name : id,
          };
          if (Array.isArray(model.input)) entry.input = [...model.input];
          return model.reasoningEfforts === undefined ? entry : { ...entry, reasoningEfforts: model.reasoningEfforts };
        }),
      };
    });
}

/**
 * Attach each model's *resolved* modalities, which is what dispatch will
 * actually use. A model stating no `input` inherits the installed catalog
 * entry, then the route's `defaultInput`, and only the adapter knows which —
 * so the page asks it rather than restating the fallback chain. The hint is
 * advisory: an adapter that cannot answer (or a route it does not own) leaves
 * the field absent and the page simply omits the hint.
 * @param routes - the configured routes.
 * @param llm - the llm service, or undefined.
 * @returns the routes, with `effectiveInput` on the models it could resolve.
 */
async function withEffectiveInput(routes, llm) {
  if (llm === undefined || typeof llm.listModels !== "function") return routes;
  return Promise.all(routes.map(async (route) => {
    let models;
    try {
      models = await llm.listModels(route.route);
    } catch {
      return route;
    }
    if (!Array.isArray(models)) return route;
    const resolved = new Map();
    for (const model of models) {
      if (model && typeof model.id === "string" && Array.isArray(model.inputModalities)) {
        resolved.set(model.id, [...model.inputModalities]);
      }
    }
    return {
      ...route,
      models: route.models.map((model) => resolved.has(model.id) ? { ...model, effectiveInput: resolved.get(model.id) } : model),
    };
  }));
}

/**
 * Derive the subagent-model.json path from the settings document path.
 * Only a document that actually is named `settings.<ext>` yields a sibling
 * file; anything else (a differently named or extensionless document) would
 * make `replace` a no-op and silently return the document path itself, so it
 * is rejected instead.
 */
function subagentPathOf(settingsDoc) {
  if (typeof settingsDoc !== "string" || settingsDoc.length === 0) return "";
  const next = settingsDoc.replace(/(^|[\\/])settings\.[^\\/]+$/, "$1subagent-model.json");
  return next === settingsDoc ? "" : next;
}

// ---------- apply ----------

export function apply(ctx) {
  if (globalThis[MOUNTED] === true) return;
  globalThis[MOUNTED] = true;
  // Release the guard with the fiber, so a dispose/reload can mount again.
  ctx.effect(() => () => {
    globalThis[MOUNTED] = false;
  }, "model-advanced-settings: mount guard");

  // `settings` is resolved lazily inside the handlers so the route always
  // registers even if the service is not ready at apply time.
  const fs = ctx.get("fs");

  let subagentConfig = { provider: "", model: "" };
  let subagentPath = "";

  async function loadSubagentConfig() {
    if (fs === undefined) return;
    const settings = ctx.get("settings");
    if (settings === undefined) return;
    try {
      const doc = await settings.prepareDocument();
      subagentPath = subagentPathOf(doc);
      if (subagentPath === "") return;
      const target = await fs.resolve(subagentPath);
      const text = await fs.readText(target);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        subagentConfig = {
          provider: typeof parsed.provider === "string" ? parsed.provider : "",
          model: typeof parsed.model === "string" ? parsed.model : "",
        };
      }
    } catch {
      /* absent file or unreadable: keep defaults */
    }
  }

  ctx.effect(() => {
    loadSubagentConfig().catch(() => {});
  });

  const handlers = {
    load: async () => {
      const settings = ctx.get("settings");
      return {
        routes: settings === undefined ? [] : await withEffectiveInput(customRoutes(settings), ctx.get("llm")),
        subagent: subagentConfig,
      };
    },
    save: async (args) => {
      const settings = ctx.get("settings");
      if (settings === undefined) return { ok: false, error: "settings service unavailable" };
      const route = str(args, "route");
      const models = args && Array.isArray(args.models) ? args.models : [];
      if (route === undefined || models.length === 0) return { ok: false, error: "bad request" };
      const providers = userProviders(settings);
      const profile = providers[route];
      if (!profile || !Array.isArray(profile.models)) return { ok: false, error: "no user-declared models for this provider" };
      const checked = validateEfforts(models);
      if (checked.error !== undefined) return { ok: false, error: checked.error };
      const checkedInput = validateInputs(models);
      if (checkedInput.error !== undefined) return { ok: false, error: checkedInput.error };
      // The switch is read by presence, not by truthiness: `null` is the
      // request's "state no answer", and an absent key means the caller does
      // not manage it at all.
      const developerRole = args !== null && typeof args === "object" && Object.prototype.hasOwnProperty.call(args, "supportsDeveloperRole")
        ? args.supportsDeveloperRole
        : undefined;
      const checkedDeveloperRole = validateDeveloperRole(route, profile, developerRole);
      if (checkedDeveloperRole.error !== undefined) return { ok: false, error: checkedDeveloperRole.error };
      const byId = new Map(models.map((m) => [m && typeof m.id === "string" ? m.id : "", m]));
      let changed = false;
      const nextModels = profile.models.map((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        const edit = byId.get(id);
        if (edit === undefined) return model;
        changed = true;
        const { input: _inheritedInput, ...rest } = model;
        const next = { ...rest, reasoningEfforts: edit.reasoningEfforts };
        // An empty list states no answer, which dsh-llm-pi-ai spells by the
        // field being absent; storing `[]` would be the same value but a
        // document that claims a declaration the user did not make.
        if (Array.isArray(edit.input) && edit.input.length > 0) next.input = [...edit.input];
        return next;
      });
      if (!changed) return { ok: false, error: "no matching model" };
      const ops = [{ op: "set", path: ["providers", route, "models"], value: nextModels }];
      const retryPolicy = args && typeof args.retryPolicy === "object" ? args.retryPolicy : undefined;
      if (retryPolicy !== undefined) {
        ops.push({ op: "set", path: ["providers", route, "retryPolicy"], value: retryPolicy });
      }
      // Only the named key is addressed, never the whole compat dict: compat
      // also carries switches this page does not manage, and a wholesale write
      // would silently replace them with the page's own partial view. `unset`
      // is a no-op when the key is already gone, which is what choosing the
      // default means.
      if (developerRole !== undefined) {
        ops.push(developerRole === null
          ? { op: "unset", path: ["providers", route, "compat", "supportsDeveloperRole"] }
          : { op: "set", path: ["providers", route, "compat", "supportsDeveloperRole"], value: developerRole });
      }
      try {
        await settings.mutate("llm-pi-ai", toHostPlain(ops));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error && error.message) || String(error) };
      }
    },
    subagent: async (args) => {
      const provider = str(args, "provider") ?? "";
      const model = str(args, "model") ?? "";
      subagentConfig = { provider, model };
      if (fs === undefined) return { ok: true };
      const settings = ctx.get("settings");
      if (settings === undefined) return { ok: true };
      try {
        if (subagentPath === "") {
          const doc = await settings.prepareDocument();
          subagentPath = subagentPathOf(doc);
        }
        if (subagentPath === "") return { ok: true };
        const target = await fs.resolve(subagentPath);
        await fs.writeText(target, JSON.stringify(subagentConfig, null, 2));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: (error && error.message) || String(error) };
      }
    },
  };

  async function handler(req, res) {
    if ((req.method || "") !== "POST") {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "");
    let action = null;
    for (const key of Object.keys(handlers)) {
      if (pathname === "/dsh-model-advanced/" + key) {
        action = key;
        break;
      }
    }
    if (action === null) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw.trim().length > 0) body = JSON.parse(raw);
    } catch (e) {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    try {
      sendJson(res, 200, await handlers[action](body));
    } catch (e) {
      sendJson(res, 500, { error: (e && e.message) || String(e) });
    }
  }

  ctx.webServer.register({
    kind: "prefix",
    path: "/dsh-model-advanced",
    handler
  });

  // Per-subagent default model: when a subagent is created and a default
  // provider/model is configured, override its request route on the agent's
  // scoped context. The listener is registered on the plugin fiber; each child
  // agent registers its own scoped listener, cleaned up with the agent.
  ctx.on("agent/created", (payload) => {
    const agent = payload && payload.agent;
    if (!agent) return;
    if (agent.options === undefined || agent.options.subagentDepth === undefined) return;
    const provider = subagentConfig.provider;
    const model = subagentConfig.model;
    if (provider === "" || model === "") return;
    const agentCtx = agent.ctx;
    if (!agentCtx || typeof agentCtx.on !== "function") return;
    agentCtx.on("agent/request", async (_payload, next) => {
      const resolved = await next();
      return {
        ...resolved,
        provider,
        model,
      };
    });
  });
}
