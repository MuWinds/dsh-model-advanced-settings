# dsh-model-advanced-settings

Model advanced settings for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI. Adds a **「模型高级设置 / Model advanced settings」** section to Settings with three capabilities:

- **Thinking levels (reasoningEfforts)** — per-model wire values (`minimal` / `low` / `medium` / `high` / `xhigh` / `max`), written to `llm-pi-ai.providers.<route>.models[].reasoningEfforts`.
- **Retry policy** — per-provider `retryPolicy`: finite (`normal` + `maxRetries`) or unlimited (`always`), written to `llm-pi-ai.providers.<route>.retryPolicy`.
- **Subagent model** — a default provider/model for delegated subagents, persisted to `<harness home>/subagent-model.json`; subagents use it instead of inheriting the parent model.

## Install

Add the package to a dsh profile's `dsh.profile.bundles`:

```jsonc
// <profile>/package.json
{
  "dependencies": {
    "@muwinds/dsh-model-advanced-settings": "github:MuWinds/dsh-model-advanced-settings"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...existing bundles,
        "@muwinds/dsh-model-advanced-settings"
      ]
    }
  }
}
```

Then install the dependency in the profile and restart the web profile:

```
dsh plugin --profile web add @muwinds/dsh-model-advanced-settings
```

Installing from a local checkout: `dsh plugin` forwards its arguments through a
shell on Windows, so a spec containing spaces is split. Point at a space-free
path instead (a junction works):

```
mklink /J C:\dsh-mas-src "C:\path with spaces\dsh-model-advanced-settings"
dsh plugin --profile web add link:C:\dsh-mas-src
```

`dsh plugin` reconciles the profile's `dsh.profile.bundles` from the installed
state, so the bundle joins the layer stack on its own — no need to hand-edit the
package.json above.

## Structure

Single-bundle plugin (the standard dsh plugin shape):

- `lib/index.js` — Host half: registers `/dsh-model-advanced/*` HTTP routes and hooks `agent/created` to override the subagent request route.
- `lib/client.js` — Browser half: the `settings.section` page (discovered through the `dsh.client` declaration).
- `cordis.patch.yml` — loader patch inserting the row into the profile.

## Notes

- Only `llm-pi-ai` providers with a **user-declared `models` list** appear in the page (custom providers; the built-in Models page already owns catalog providers).
- Leaving the subagent provider/model empty keeps the default behaviour (inherit the parent model).

### Thinking levels

Each of the seven levels has its own tick box, so a model offers exactly the
levels you tick — unticked levels are pinned to `null` in pi-ai's
`thinkingLevelMap` and disappear from the model picker.

The level **vocabulary is closed**. `dsh-llm-pi-ai` validates the dict keys
against pi-ai's `ModelThinkingLevel` union (`off | minimal | low | medium |
high | xhigh | max`), so a brand-new level name cannot be declared — only which
of the seven are offered, and the wire spelling each one sends. Adding a level
upstream would need a pi-ai change.

`Off` is special, and is why it now has a tick box of its own:

| `off` value | Stored | Effect |
|---|---|---|
| unticked | key absent | not offered in the picker |
| ticked, blank | `off: null` | offered; selecting it sends **no** reasoning parameter |
| ticked, `none` | `off: "none"` | offered; selecting it sends that explicit value |

Every other ticked level must carry a wire value — `dsh-llm-pi-ai` rejects an
empty string, and rejects a dict whose only level is `off` (`reasoningEfforts
offers no level beyond "off"`), so the page refuses both before writing.

- Requires dsh `>= 0.1.5-rc.1` (`dsh.engines.dsh`). It previously declared
  `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-ui-slots` under
  `dsh.client.inject`; those packages do not exist — the boot graph resolves
  every `inject` entry as a package row — and the browser half failed to
  compose. `slots` and `locale` are client-runtime services and belong only in
  the bundle's own `inject` export, so the declaration now names just
  `@deepseek-ai/dsh-client-ui-settings`.
- The subagent model is persisted to `<harness home>/subagent-model.json`,
  derived from the settings document path. Only a document named
  `settings.<ext>` yields a sibling file; any other name leaves the feature
  inert rather than writing to the settings document itself.
- The subagent override is applied at `agent/request`; if a session runs with a
  confined (non-`danger-full-access`) write policy, writing
  `subagent-model.json` is refused by the sandbox and the handler returns
  `{ ok: false, error: … }` — the page surfaces that message. The reasoning-effort
  and retry-policy writes go through the settings service and are unaffected.

## License

MIT
