# dsh-model-advanced-settings

Model advanced settings for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI. Adds a **「模型高级设置 / Model advanced settings」** section to Settings with four capabilities:

- **Thinking levels (reasoningEfforts)** — per-model wire values (`minimal` / `low` / `medium` / `high` / `xhigh` / `max`), written to `llm-pi-ai.providers.<route>.models[].reasoningEfforts`.
- **Retry policy** — per-provider `retryPolicy`: finite (`normal` + `maxRetries`) or unlimited (`always`), written to `llm-pi-ai.providers.<route>.retryPolicy`.
- **DeveloperRole** — per-provider `compat.supportsDeveloperRole`: supported, unsupported, or left to detection, written to `llm-pi-ai.providers.<route>.compat.supportsDeveloperRole`.
- **Subagent model** — a default provider/model for delegated subagents, stored in this plugin's own settings entry; subagents use it instead of inheriting the parent model.

Input modalities are **not** here: the harness's own **Models** settings page owns `models[].input` for hand-declared pi-ai routes, with the same inheritance semantics, so a second editor would be a second writer of one field.

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
dsh plugin --profile web add github:MuWinds/dsh-model-advanced-settings
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

- `lib/index.js` — Host half: registers `/dsh-model-advanced/*` HTTP routes, owns the subagent default as its own settings entry, and hooks `agent/created` to override the subagent request route.
- `lib/client.js` — Browser half: the `settings.section` page (discovered through the `dsh.client` declaration).
- `cordis.patch.yml` — loader patch inserting the row into the profile.

Tests: `npm test` (`node --test "test/*.test.mjs"`). The suite mounts both halves
against fake harnesses — the browser half through a small React hook shim, so it
runs in plain Node with no browser and no build step. The suites need
`@deepseek-ai/schemastery` resolvable from this package (a real profile supplies
it from the installation scope), and a confined sandbox cannot run
`node --test`'s per-file child processes; `node test/host.test.mjs` runs the file
in process instead.

## Notes

- Only `llm-pi-ai` providers with a **user-declared `models` list** appear in the
  page. The built-in Models page owns catalog providers, and it now also owns
  `models[].input` for hand-declared routes; this page deliberately leaves every
  field it does not manage in place, `input` included.
- Leaving the subagent provider/model empty keeps the default behaviour (inherit
  the parent model).
- The HTTP route is a deliberate choice, not a shortcut. The harness's typed
  remote namespaces (`ctx.remote` / `ctx.apiGateway`) are assembled from
  generated Typert artifacts, which a hand-written plugin has no way to publish;
  `dsh-host-webserver` is the composition's route registry and expects feature
  plugins to claim their own paths.

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
- The subagent model is stored in **this plugin's own settings entry** — two
  `.volatile()` fields on its Config — so the harness persists it in the profile
  patch under `- id: model-advanced-settings`, revision-fenced and hot-reloaded.
  It previously wrote a `subagent-model.json` beside the settings document; dsh
  `0.2` replaced that document with the profile patch, so the derivation found
  nothing and the store went silently inert while the page still reported a
  save. The platform store also sidesteps the session file sandbox, which
  refused a write under the harness home.
- The subagent default is read from its reactive Config reference at each
  `agent/created`, not cached at apply time, so a settings write that lands
  without a remount is honoured by the next delegated agent. The override itself
  is applied at `agent/request`.
- `dsh.engines.dsh` is author metadata, not a gate: dsh `0.2` reads only
  `peerDependencies` entries named `@deepseek-ai/dsh*` when it decides whether a
  bundle may run. This package deliberately names none — a wrong range would
  have the bundle skipped silently — and declares only what it imports
  (`@deepseek-ai/cordis`, `@deepseek-ai/schemastery`), which the gate ignores.

### DeveloperRole

`dsh-llm-pi-ai` lets a profile override pi-ai's URL-based auto-detection with a
`compat` dict, and one of those switches decides whether the system prompt goes
out under the `developer` role or the older `system` role. The page exposes that
one switch per provider:

| Choice | Stored | Effect |
|---|---|---|
| Default (auto-detect) | key absent | pi-ai detects the answer from the endpoint URL |
| Supported | `compat: {supportsDeveloperRole: true}` | the `developer` role is sent |
| Unsupported | `compat: {supportsDeveloperRole: false}` | the `system` role is sent |

The three states are not a nicety. An absent key is not `false`: for
`openai-completions` pi-ai *detects* the answer from the URL, and for
`openai-responses` its own default is `true` — so a two-state checkbox would
turn "say nothing" into a declaration nobody made and silently change the
request for every route a user merely opened the page on. The page therefore
reads presence, not truthiness, and a switch it never set renders as the default.

It is a **provider-level** switch for two reasons: `compat` resolution lets a
model-level switch override the route's field by field, so a route default is
the value every model shares unless one says otherwise; and the trait belongs to
the gateway, not to one model. The write addresses only the one key —
`set`/`unset` on `providers.<route>.compat.supportsDeveloperRole` — never the
whole dict, because `compat` also carries switches this page does not manage
(`thinkingFormat`, `supportsReasoningEffort`, `cacheControlFormat`, …) and a
wholesale write would silently replace them with the page's partial view.

The vocabulary is closed, and narrower than pi-ai's compat types: only the four
OpenAI-shaped protocols offer the field (`openai-completions`,
`openai-responses`, `azure-openai-responses`, `openai-codex-responses`).
Anthropic Messages has no such switch because it carries the system prompt in a
top-level parameter rather than a message role. A route that declares
`api: anthropic-messages` is refused before the write, naming the protocol; a
route that declares no `api` is left to `dsh-llm-pi-ai`, whose own gate reports
the refusal, since which protocol a catalog route's models speak is the
installed catalog's business.

## License

MIT
