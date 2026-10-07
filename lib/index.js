/**
 * Host half of the model-advanced-settings page (@muwinds/dsh-model-advanced-settings).
 *
 * Exposes a small JSON API under /dsh-model-advanced/* on the harness web server:
 *   POST /dsh-model-advanced/load        {}                        -> { routes, subagent }
 *   POST /dsh-model-advanced/save        { route, models, retryPolicy, supportsDeveloperRole } -> { ok }
 *   POST /dsh-model-advanced/subagent    { provider, model }        -> { ok }
 *
 * "routes" = llm-pi-ai providers that declare a user models list, each with its
 * models (id/name/reasoningEfforts), its retryPolicy, and its
 * compat.supportsDeveloperRole switch when one is stored.
 *
 * The subagent default lives in this plugin's own Config (two volatile fields),
 * so the harness stores it in the profile patch beside every other setting:
 * revision-fenced, hot-reloaded, and outside the session file sandbox — none of
 * which a plugin-owned JSON file beside the harness home was. `settings.mutate`
 * addresses it by the plugin's own loader entry id.
 *
 * The route stays a plain HTTP route rather than a remote namespace because
 * Typert remotes are generated artifacts; a hand-written plugin cannot register
 * one. dsh-host-webserver is the composition's route registry and expects
 * feature plugins to claim their own paths.
 */

import z from "@deepseek-ai/schemastery";

/** Wait for the browser HTTP carrier before registering the route. */
export const inject = ["webServer"];

/** Plugin display name for the loader. */
export const name = "dsh-model-advanced-settings";

/**
 * The plugin's own settings surface.
 *
 * Both fields are `.volatile()`, which is what makes the entry editable live
 * through `ctx.settings` and therefore what makes the values durable in the
 * profile patch. An empty string is the documented "inherit the parent model"
 * state, so no default model is declared until the user chooses one.
 */
export const Config = z.object({
  subagentProvider: z.string().default("").volatile(),
  subagentModel: z.string().default("").volatile(),
});

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

/**
 * One Config field's current value.
 *
 * A `.volatile()` field is handed to the plugin as a reactive reference rather
 * than a plain value, and reading it through `.get()` is what makes the
 * subagent default current after a settings write instead of frozen at apply
 * time.
 * @param ref - the resolved Config field, reactive or plain.
 * @returns the current string value, or "" when the field states none.
 */
function readConfigString(ref) {
  const value = ref !== null && typeof ref === "object" && typeof ref.get === "function" ? ref.get() : ref;
  return typeof value === "string" ? value : "";
}

/**
 * The loader entry id this plugin is mounted as — the namespace
 * `ctx.settings` addresses it by.
 *
 * `settings.describe()` reports `entry.options.id`, so that is the spelling to
 * write back; `createEntry.id` is scoped by its parent include and would not
 * match.
 * @param ctx - the plugin context.
 * @returns the namespace, or "" when the harness exposes no loader entry.
 */
function ownNamespace(ctx) {
  const entry = ctx.fiber === undefined ? undefined : ctx.fiber.entry;
  const id = entry === undefined ? undefined : entry.options === undefined ? undefined : entry.options.id;
  return typeof id === "string" && id.length > 0 ? id : "";
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

// ---------- llm-pi-ai settings ----------

/**
 * The level vocabulary dsh-llm-pi-ai accepts, mirroring pi-ai's
 * `ModelThinkingLevel`. The settings schema validates dict KEYS against this
 * union, so a name outside it can never be stored; the list is closed upstream.
 */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

/**
 * Provider routes that declare a user models list.
 *
 * Only the fields this page manages are projected. Input modalities are
 * deliberately absent: the harness's own Models page owns `models[].input` for
 * exactly these hand-declared routes, with the same inheritance semantics, so a
 * second editor here would be a second writer of one field.
 */
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
          return model.reasoningEfforts === undefined ? entry : { ...entry, reasoningEfforts: model.reasoningEfforts };
        }),
      };
    });
}

// ---------- apply ----------

export function apply(ctx, config) {
  if (globalThis[MOUNTED] === true) return;
  globalThis[MOUNTED] = true;
  // Release the guard with the fiber, so a dispose/reload can mount again.
  ctx.effect(() => () => {
    globalThis[MOUNTED] = false;
  }, "model-advanced-settings: mount guard");

  // `settings` is resolved lazily inside the handlers so the route always
  // registers even if the service is not ready at apply time.
  const subagent = () => ({
    provider: readConfigString(config === undefined ? undefined : config.subagentProvider),
    model: readConfigString(config === undefined ? undefined : config.subagentModel),
  });

  const handlers = {
    load: async () => {
      const settings = ctx.get("settings");
      return {
        routes: settings === undefined ? [] : customRoutes(settings),
        subagent: subagent(),
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
        // Every field the page does not own — `input` and the capacity fields
        // among them — travels through untouched; the Models page owns them.
        return { ...model, reasoningEfforts: edit.reasoningEfforts };
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
      const settings = ctx.get("settings");
      if (settings === undefined) return { ok: false, error: "settings service unavailable" };
      const ns = ownNamespace(ctx);
      if (ns === "") return { ok: false, error: "cannot address this plugin's settings entry" };
      try {
        await settings.mutate(ns, [
          { op: "set", path: ["subagentProvider"], value: provider },
          { op: "set", path: ["subagentModel"], value: model },
        ]);
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

  // Registered as an effect so a dispose/reload releases the route before the
  // next apply claims the same path; a duplicate prefix route throws.
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/dsh-model-advanced",
    handler
  }), "model-advanced-settings: route");

  // Per-subagent default model: when a subagent is created and a default
  // provider/model is configured, override its request route on the agent's
  // scoped context. The listener is registered on the plugin fiber; each child
  // agent registers its own scoped listener, cleaned up with the agent.
  ctx.on("agent/created", (payload) => {
    const agent = payload && payload.agent;
    if (!agent) return;
    if (agent.options === undefined || agent.options.subagentDepth === undefined) return;
    const { provider, model } = subagent();
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
