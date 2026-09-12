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

Levels are an **editable row list** — one row per level a model offers, each
with a level dropdown and a wire-value input, plus a `−` button on the row and
an **+ Add level** button under the list. A level with no row is absent from the
dict, which `dsh-llm-pi-ai` pins to `null` in pi-ai's `thinkingLevelMap`; that is
what removes it from the model picker. Each dropdown only offers levels no other
row already uses, since a duplicate key would collapse on save.

The level **vocabulary is closed**, which is the one thing the row list cannot
change. `dsh-llm-pi-ai` validates the dict keys against pi-ai's
`ModelThinkingLevel` union (`off | minimal | low | medium | high | xhigh | max`),
so a custom level name is rejected outright; and even if one were stored, pi-ai's
`clampThinkingLevel` maps an unrecognised id onto the first available level — a
silent wrong-parameter bug. Adding a genuinely new level therefore needs a pi-ai
change, not a plugin change. What you control per model is *which* of the seven
are offered and the wire spelling each sends.

`Off` sits on its own row (a checkbox rather than a list entry) because it is not
an escalation step:

| Off row | Stored | Effect |
|---|---|---|
| unchecked | key absent | not offered in the picker |
| checked, blank | `off: null` | offered; selecting it sends **no** reasoning parameter |
| checked, `none` | `off: "none"` | offered; selecting it sends that explicit value |

Every listed level must carry a wire value. The page refuses an empty one, a
duplicated level, and a list that is empty or that leaves only `off` —
`dsh-llm-pi-ai` rejects all of those at model resolution, which would otherwise
leave the whole provider unable to register.

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
