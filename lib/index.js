/**
 * Host half of the model-advanced-settings page (@muwinds/dsh-model-advanced-settings).
 *
 * Exposes a small JSON API under /dsh-model-advanced/* on the harness web server:
 *   POST /dsh-model-advanced/load        {}                        -> { routes, subagent }
 *   POST /dsh-model-advanced/save        { route, models, retryPolicy } -> { ok }
 *   POST /dsh-model-advanced/subagent    { provider, model }        -> { ok }
 *
 * "routes" = llm-pi-ai providers that declare a user models list, each with its
 * models (id/name/reasoningEfforts) and its retryPolicy. "subagent" is the
 * per-subagent default model, persisted to <harness home>/subagent-model.json
 * (derived from the settings document path). The browser half ships in the same
 * package (exports["./client"], dsh.client declaration).
 */

/** Wait for the browser HTTP carrier before registering the route. */
export const inject = ["webServer"];

/** Plugin display name for the loader. */
export const name = "dsh-model-advanced-settings";

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
    .map(([route, profile]) => ({
      route,
      displayName: typeof profile.displayName === "string" && profile.displayName.length > 0 ? profile.displayName : route,
      ...profile.retryPolicy === undefined ? {} : { retryPolicy: profile.retryPolicy },
      models: profile.models.map((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        const entry = {
          id,
          name: typeof model.name === "string" && model.name.length > 0 ? model.name : id,
        };
        return model.reasoningEfforts === undefined ? entry : { ...entry, reasoningEfforts: model.reasoningEfforts };
      }),
    }));
}

/** Derive the subagent-model.json path from the settings document path. */
function subagentPathOf(settingsDoc) {
  if (typeof settingsDoc !== "string" || settingsDoc.length === 0) return "";
  return settingsDoc.replace(/settings\.[^.]+$/, "subagent-model.json");
}

// ---------- apply ----------

export function apply(ctx) {
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
        routes: settings === undefined ? [] : customRoutes(settings),
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
      const byId = new Map(models.map((m) => [m && typeof m.id === "string" ? m.id : "", m]));
      let changed = false;
      const nextModels = profile.models.map((model) => {
        const id = typeof model.id === "string" ? model.id : "";
        const edit = byId.get(id);
        if (edit === undefined) return model;
        changed = true;
        return { ...model, reasoningEfforts: edit.reasoningEfforts };
      });
      if (!changed) return { ok: false, error: "no matching model" };
      const ops = [{ op: "set", path: ["providers", route, "models"], value: nextModels }];
      const retryPolicy = args && typeof args.retryPolicy === "object" ? args.retryPolicy : undefined;
      if (retryPolicy !== undefined) {
        ops.push({ op: "set", path: ["providers", route, "retryPolicy"], value: retryPolicy });
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
