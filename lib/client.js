window.__ModuleLoader__.load({
  id: "@muwinds/dsh-model-advanced-settings",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // ---------- styles ----------
    var STYLE_ID = "dsw-mas-style";
    var CSS =
      ".dsw-mas-root{max-width:720px;display:flex;flex-direction:column;gap:16px;}" +
      ".dsw-mas-title{margin:0;font-size:16px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary);}" +
      ".dsw-mas-block{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;}" +
      ".dsw-mas-block-title{margin:0;font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary);}" +
      ".dsw-mas-block-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}" +
      ".dsw-mas-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:4px;}" +
      ".dsw-mas-input{box-sizing:border-box;height:30px;padding:0 10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;outline:none;}" +
      ".dsw-mas-select{width:auto;min-width:200px;}" +
      ".dsw-mas-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}" +
      ".dsw-mas-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:12px;}" +
      ".dsw-mas-card-head{display:flex;align-items:center;gap:8px;min-width:0;}" +
      ".dsw-mas-name{font-size:14px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsw-mas-id{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".dsw-mas-toggle{margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer;}" +
      ".dsw-mas-levels{display:flex;flex-wrap:wrap;gap:10px;}" +
      ".dsw-mas-level{display:flex;flex-direction:column;gap:4px;width:150px;}" +
      ".dsw-mas-level--muted{opacity:.55;}" +
      ".dsw-mas-level-name{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;cursor:pointer;}" +
      ".dsw-mas-level input[type=text]:disabled{opacity:.6;cursor:not-allowed;}" +
      ".dsw-mas-msg{margin:0;font-size:13px;line-height:20px;}" +
      ".dsw-mas-btn{align-self:flex-start;height:36px;border-radius:18px;border:none;cursor:pointer;padding:0 16px;font-size:14px;line-height:22px;background:var(--dsw-alias-button-primary-fill,#1f6feb);color:var(--dsw-alias-label-primary-foreground,#fff);}" +
      ".dsw-mas-btn:hover:not(:disabled){filter:brightness(1.06);}" +
      ".dsw-mas-btn:disabled{opacity:.6;cursor:default;}" +
      ".dsw-mas-num{width:90px;}";

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (e) {
        // ignore
      }
    }

    // ---------- api ----------
    function api(action, args) {
      return fetch("/dsh-model-advanced/" + action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args || {})
      }).then(function (res) {
        return res.json().catch(function () {
          return null;
        });
      }).then(function (payload) {
        if (payload === null || typeof payload !== "object") {
          throw new Error("无效响应");
        }
        if (payload.error) {
          throw new Error(String(payload.error));
        }
        return payload;
      });
    }

    // ---------- copy ----------
    var COPY = {
      en: {
        nav: "Model advanced settings",
        levelsTitle: "Thinking levels",
        levelsHint: "Tick the levels this model offers; the value is the wire spelling sent for it. Unticked levels are not offered.",
        offPlaceholder: "empty = send nothing",
        wireRequired: "Level {level} is ticked but has no wire value.",
        retryTitle: "Retry policy",
        retryHint: "Retries after a failed model request, per provider.",
        retryMode: "Retry",
        retryFinite: "Finite",
        retryAlways: "Unlimited",
        retryCount: "Retries",
        subagentTitle: "Subagent model",
        subagentHint: "Leave empty to inherit the parent model.",
        subagentProvider: "Provider",
        subagentModel: "Model",
        provider: "Provider",
        reasoning: "Reasoning model",
        save: "Save",
        saving: "Saving…",
        saved: "Saved.",
        error: "Error",
        none: "No custom provider with declared models found.",
        emptyLevels: "Tick at least one level.",
        offOnly: "\"Off\" needs at least one thinking level alongside it.",
        inherit: "Inherit parent"
      },
      zh: {
        nav: "模型高级设置",
        levelsTitle: "推理等级",
        levelsHint: "勾选该模型提供的等级，右侧填写对应发送值；未勾选的等级不会提供。",
        offPlaceholder: "留空 = 不发送参数",
        wireRequired: "「{level}」已勾选，但未填写发送值。",
        retryTitle: "重试策略",
        retryHint: "模型请求失败后的重试，按提供方设置。",
        retryMode: "重试",
        retryFinite: "有限次数",
        retryAlways: "无限重试",
        retryCount: "重试次数",
        subagentTitle: "Subagent 模型",
        subagentHint: "留空则继承父模型的提供方与模型。",
        subagentProvider: "提供方",
        subagentModel: "模型",
        provider: "提供方",
        reasoning: "推理模型",
        save: "保存",
        saving: "保存中…",
        saved: "已保存。",
        error: "错误",
        none: "未找到声明了模型的自定义提供方。",
        emptyLevels: "请至少勾选一个等级。",
        offOnly: "「Off」需要至少搭配一个推理等级。",
        inherit: "继承父模型"
      }
    };
    // The level vocabulary is CLOSED: dsh-llm-pi-ai validates the dict keys
    // against pi-ai's own `ModelThinkingLevel` union, so a name outside this
    // list cannot be added. What IS configurable per model is which of these
    // levels are offered, and the wire spelling each one sends.
    var LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    var LEVEL_LABELS = {
      off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "X-High", max: "Max"
    };
    var NAV = { zh: "模型高级设置", en: "Model advanced settings" };

    // ---------- helpers ----------
    /**
     * One model's declared levels into draft rows. A level is a row when the
     * key is PRESENT in the dict — `off: null` means "offered, send nothing"
     * and is distinct from an absent key, which means "not offered".
     * @param value - the stored `reasoningEfforts` dict, or anything else.
     * @returns one `{on, wire}` per level, all seven always present.
     */
    function effortsToLevels(value) {
      var dict = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
      var out = {};
      for (var i = 0; i < LEVELS.length; i++) {
        var level = LEVELS[i];
        var present = Object.prototype.hasOwnProperty.call(dict, level);
        // `null` is a declared-but-empty wire spelling; only `off` may use it.
        out[level] = {
          on: present,
          wire: present && typeof dict[level] === "string" ? dict[level] : ""
        };
      }
      return out;
    }
    function retryDraftOf(policy) {
      if (policy && typeof policy === "object" && policy.mode === "always") return { mode: "always", maxRetries: "" };
      if (policy && typeof policy === "object" && typeof policy.maxRetries === "number") return { mode: "normal", maxRetries: String(policy.maxRetries) };
      return { mode: "normal", maxRetries: "2" };
    }
    function pick(dict, locale) {
      return dict[locale] || dict.zh;
    }
    function detectLocale() {
      try {
        if (typeof document !== "undefined" && document.documentElement && document.documentElement.lang === "en") return "en";
      } catch (e) { /* ignore */ }
      return "zh";
    }

    // ---------- page component ----------
    function ModelAdvancedSettingsPage() {
      var locale = detectLocale();
      var t = pick(COPY, locale);
      var nav = NAV[locale] || NAV.zh;
      var _useState = react.useState("loading");
      var status = _useState[0];
      var setStatus = _useState[1];
      var _useState2 = react.useState([]);
      var routes = _useState2[0];
      var setRoutes = _useState2[1];
      var _useState3 = react.useState("");
      var route = _useState3[0];
      var setRoute = _useState3[1];
      var _useState4 = react.useState({});
      var drafts = _useState4[0];
      var setDrafts = _useState4[1];
      var _useState5 = react.useState({});
      var retry = _useState5[0];
      var setRetry = _useState5[1];
      var _useState6 = react.useState({ provider: "", model: "" });
      var subagent = _useState6[0];
      var setSubagent = _useState6[1];
      var _useState7 = react.useState({ provider: "", models: [] });
      var subagentChoices = _useState7[0];
      var setSubagentChoices = _useState7[1];
      var _useState8 = react.useState(false);
      var saving = _useState8[0];
      var setSaving = _useState8[1];
      var _useState9 = react.useState(false);
      var savingSub = _useState9[0];
      var setSavingSub = _useState9[1];
      var _useState10 = react.useState(null);
      var message = _useState10[0];
      var setMessage = _useState10[1];
      var _useState11 = react.useState(null);
      var ok = _useState11[0];
      var setOk = _useState11[1];

      react.useEffect(function () {
        var alive = true;
        api("load", {}).then(function (result) {
          if (!alive) return;
          var list = result && Array.isArray(result.routes) ? result.routes : [];
          var d = {};
          var r = {};
          for (var i = 0; i < list.length; i++) {
            var rr = list[i];
            d[rr.route] = (rr.models || []).map(function (m) {
              return {
                id: m.id,
                name: m.name || m.id,
                enabled: m.reasoningEfforts !== false,
                levels: effortsToLevels(m.reasoningEfforts)
              };
            });
            r[rr.route] = retryDraftOf(rr.retryPolicy);
          }
          var sub = result && typeof result.subagent === "object" ? result.subagent : {};
          var first = list.length > 0 ? list[0] : null;
          setStatus("ready");
          setRoutes(list);
          setRoute(first ? first.route : "");
          setDrafts(d);
          setRetry(r);
          setSubagent({ provider: typeof sub.provider === "string" ? sub.provider : "", model: typeof sub.model === "string" ? sub.model : "" });
          setSubagentChoices({ provider: first ? first.route : "", models: first ? (first.models || []).map(function (m) { return m.id; }) : [] });
        }).catch(function () {
          if (alive) setStatus("error");
        });
        return function () { alive = false; };
      }, []);

      function patchDraft(modelId, patch) {
        setDrafts(function (s) {
          var next = Object.assign({}, s);
          next[route] = (next[route] || []).map(function (d) {
            return d.id === modelId ? Object.assign({}, d, patch) : d;
          });
          return next;
        });
      }
      /**
       * Patch one level row of one model. `patch` may carry `on` (offer the
       * level or drop it) and/or `wire` (the spelling dispatch sends).
       */
      function patchLevel(modelId, level, patch) {
        setDrafts(function (s) {
          var next = Object.assign({}, s);
          next[route] = (next[route] || []).map(function (d) {
            if (d.id !== modelId) return d;
            var levels = Object.assign({}, d.levels);
            var current = levels[level] || { on: false, wire: "" };
            levels[level] = Object.assign({}, current, patch);
            return Object.assign({}, d, { levels: levels });
          });
          return next;
        });
      }
      function patchRetry(rt, patch) {
        setRetry(function (s) {
          var next = Object.assign({}, s);
          next[rt] = Object.assign({}, next[rt] || {}, patch);
          return next;
        });
      }
      function chooseSubagentProvider(provider) {
        var found = null;
        for (var i = 0; i < routes.length; i++) if (routes[i].route === provider) { found = routes[i]; break; }
        setSubagent(function (s) { return Object.assign({}, s, { provider: provider, model: "" }); });
        setSubagentChoices({ provider: provider, models: found ? (found.models || []).map(function (m) { return m.id; }) : [] });
      }
      function describe(err) {
        if (err === null || err === undefined) return String(err);
        if (typeof err === "object" && typeof err.message === "string") return err.message;
        return String(err);
      }
      function save() {
        var rows = drafts[route] || [];
        var models = [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (!row.enabled) {
            models.push({ id: row.id, reasoningEfforts: false });
            continue;
          }
          var efforts = {};
          var offered = 0;
          for (var j = 0; j < LEVELS.length; j++) {
            var level = LEVELS[j];
            var entry = row.levels[level] || { on: false, wire: "" };
            if (!entry.on) continue;
            offered++;
            var wire = (entry.wire || "").trim();
            if (level === "off") {
              // `off` may be declared with an empty value: "supported, send
              // nothing". A value turns it into a plain wire spelling.
              efforts.off = wire.length > 0 ? wire : null;
            } else {
              if (wire.length === 0) {
                setMessage(t.wireRequired.replace("{level}", LEVEL_LABELS[level]));
                setOk(false);
                return;
              }
              efforts[level] = wire;
            }
          }
          if (offered === 0) {
            setMessage(t.emptyLevels);
            setOk(false);
            return;
          }
          if (!LEVELS.some(function (level) { return level !== "off" && efforts[level] !== undefined; })) {
            setMessage(t.offOnly);
            setOk(false);
            return;
          }
          models.push({ id: row.id, reasoningEfforts: efforts });
        }
        var rd = retry[route];
        var retryPolicy;
        if (rd && rd.mode === "always") {
          retryPolicy = { mode: "always" };
        } else {
          var count = rd ? Number(rd.maxRetries) : NaN;
          if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
            setMessage(t.retryCount + " ≥ 0");
            setOk(false);
            return;
          }
          retryPolicy = { mode: "normal", maxRetries: count };
        }
        setSaving(true);
        setMessage(null);
        setOk(null);
        api("save", { route: route, models: models, retryPolicy: retryPolicy }).then(function () {
          setSaving(false);
          setOk(true);
          setMessage(t.saved);
        }).catch(function (err) {
          setSaving(false);
          setOk(false);
          setMessage(describe(err));
        });
      }
      function saveSubagent() {
        setSavingSub(true);
        setMessage(null);
        setOk(null);
        api("subagent", { provider: subagent.provider, model: subagent.model }).then(function () {
          setSavingSub(false);
          setOk(true);
          setMessage(t.saved);
        }).catch(function (err) {
          setSavingSub(false);
          setOk(false);
          setMessage(describe(err));
        });
      }

      if (status === "loading") return react.createElement("div", null, "…");
      if (status === "error") return react.createElement("div", null, t.error);
      if (routes.length === 0) return react.createElement("div", null, t.none);
      var rows = drafts[route] || [];
      var subProvider = null;
      for (var k = 0; k < routes.length; k++) if (routes[k].route === subagentChoices.provider) { subProvider = routes[k]; break; }
      var subModelOptions = subagentChoices.models;
      var retryMode = (retry[route] || {}).mode || "normal";

      return react.createElement("div", { className: "dsw-mas-root" },
        react.createElement("h2", { className: "dsw-mas-title" }, nav),
        react.createElement("div", { className: "dsw-mas-block" },
          react.createElement("h3", { className: "dsw-mas-block-title" }, t.levelsTitle),
          react.createElement("p", { className: "dsw-mas-block-hint" }, t.levelsHint),
          react.createElement("label", { className: "dsw-mas-label" },
            react.createElement("span", null, t.provider),
            react.createElement("select", {
              className: "dsw-mas-input dsw-mas-select",
              value: route,
              onChange: function (e) { setRoute(e.target.value); setMessage(null); setOk(null); }
            }, routes.map(function (r) {
              return react.createElement("option", { key: r.route, value: r.route }, r.displayName);
            }))
          ),
          rows.map(function (row) {
            return react.createElement("div", { key: row.id, className: "dsw-mas-card" },
              react.createElement("div", { className: "dsw-mas-card-head" },
                react.createElement("span", { className: "dsw-mas-name", title: row.name }, row.name),
                react.createElement("code", { className: "dsw-mas-id", title: row.id }, row.id),
                react.createElement("label", { className: "dsw-mas-toggle" },
                  react.createElement("input", {
                    type: "checkbox",
                    checked: row.enabled,
                    onChange: function (e) { patchDraft(row.id, { enabled: e.target.checked }); }
                  }),
                  t.reasoning
                )
              ),
              row.enabled ? react.createElement("div", { className: "dsw-mas-levels" },
                LEVELS.map(function (level) {
                  var entry = row.levels[level] || { on: false, wire: "" };
                  var isOff = level === "off";
                  return react.createElement("label", {
                    key: level,
                    className: "dsw-mas-level" + (entry.on ? "" : " dsw-mas-level--muted")
                  },
                    react.createElement("span", { className: "dsw-mas-level-name" },
                      react.createElement("input", {
                        type: "checkbox",
                        checked: entry.on,
                        onChange: function (e) { patchLevel(row.id, level, { on: e.target.checked }); }
                      }),
                      LEVEL_LABELS[level]
                    ),
                    react.createElement("input", {
                      type: "text",
                      className: "dsw-mas-input",
                      disabled: !entry.on,
                      value: entry.wire,
                      // `off` with no value is meaningful: send nothing at all.
                      placeholder: isOff ? t.offPlaceholder : level,
                      onChange: function (e) { patchLevel(row.id, level, { wire: e.target.value }); }
                    })
                  );
                })
              ) : null
            );
          }),
          react.createElement("div", { className: "dsw-mas-block" },
            react.createElement("h3", { className: "dsw-mas-block-title" }, t.retryTitle),
            react.createElement("p", { className: "dsw-mas-block-hint" }, t.retryHint),
            react.createElement("div", { className: "dsw-mas-row" },
              react.createElement("label", { className: "dsw-mas-label" },
                react.createElement("span", null, t.retryMode),
                react.createElement("select", {
                  className: "dsw-mas-input dsw-mas-select",
                  value: retryMode,
                  onChange: function (e) { patchRetry(route, { mode: e.target.value }); }
                },
                  react.createElement("option", { value: "normal" }, t.retryFinite),
                  react.createElement("option", { value: "always" }, t.retryAlways)
                )
              ),
              retryMode !== "always" ? react.createElement("label", { className: "dsw-mas-label" },
                react.createElement("span", null, t.retryCount),
                react.createElement("input", {
                  type: "number",
                  min: 0,
                  className: "dsw-mas-input dsw-mas-num",
                  value: (retry[route] || {}).maxRetries || "",
                  onChange: function (e) { patchRetry(route, { maxRetries: e.target.value }); }
                })
              ) : null
            )
          ),
          react.createElement("button", {
            type: "button",
            className: "dsw-mas-btn",
            disabled: saving,
            onClick: save
          }, saving ? t.saving : t.save)
        ),
        react.createElement("div", { className: "dsw-mas-block" },
          react.createElement("h3", { className: "dsw-mas-block-title" }, t.subagentTitle),
          react.createElement("p", { className: "dsw-mas-block-hint" }, t.subagentHint),
          react.createElement("div", { className: "dsw-mas-row" },
            react.createElement("label", { className: "dsw-mas-label" },
              react.createElement("span", null, t.subagentProvider),
              react.createElement("select", {
                className: "dsw-mas-input dsw-mas-select",
                value: subagentChoices.provider,
                onChange: function (e) { chooseSubagentProvider(e.target.value); }
              },
                react.createElement("option", { value: "" }, t.inherit),
                routes.map(function (r) {
                  return react.createElement("option", { key: r.route, value: r.route }, r.displayName);
                })
              )
            ),
            subProvider ? react.createElement("label", { className: "dsw-mas-label" },
              react.createElement("span", null, t.subagentModel),
              react.createElement("select", {
                className: "dsw-mas-input dsw-mas-select",
                value: subagent.model,
                onChange: function (e) { setSubagent(function (s) { return Object.assign({}, s, { model: e.target.value }); }); }
              },
                react.createElement("option", { value: "" }, t.inherit),
                subModelOptions.map(function (id) {
                  return react.createElement("option", { key: id, value: id }, id);
                })
              )
            ) : null
          ),
          react.createElement("button", {
            type: "button",
            className: "dsw-mas-btn",
            disabled: savingSub,
            onClick: saveSubagent
          }, savingSub ? t.saving : t.save)
        ),
        message !== null ? react.createElement("p", {
          className: "dsw-mas-msg",
          style: { color: ok === true ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" }
        }, String(message)) : null
      );
    }

    // ---------- apply ----------
    // `slots` and `locale` are client-runtime services, not modules: the boot
    // graph resolves `dsh.client.inject` entries as package rows, so only real
    // packages belong there (see package.json).
    var inject = ["slots", "locale"];

    /** Process-wide apply guard: an aggregate bundle may also carry this plugin. */
    var MOUNTED = "@muwinds/dsh-model-advanced-settings/mounted";

    function apply(ctx) {
      if (window[MOUNTED] === true) return;
      window[MOUNTED] = true;
      // Release the guard with the fiber, so an HMR reload can mount again.
      ctx.effect(function () {
        return function () { window[MOUNTED] = false; };
      }, "model-advanced-settings: mount guard");
      ensureStyle();
      ctx.effect(function () {
        try {
          if (ctx.locale && typeof ctx.locale.register === "function") {
            return ctx.locale.register("settings.model-advanced", { zh: COPY.zh, en: COPY.en });
          }
        } catch (e) { /* ignore */ }
      }, "model-advanced-settings: dicts");
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "model-advanced", order: 12, label: function () { return NAV[detectLocale()] || NAV.zh; } },
          ModelAdvancedSettingsPage
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
