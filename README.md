# dsh-model-advanced-settings

Model advanced settings for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web UI. Adds a **「模型高级设置 / Model advanced settings」** section to Settings with five capabilities:

- **Thinking levels (reasoningEfforts)** — per-model wire values (`minimal` / `low` / `medium` / `high` / `xhigh` / `max`), written to `llm-pi-ai.providers.<route>.models[].reasoningEfforts`.
- **Input modalities** — per-model `text` / `image` acceptance, written to `llm-pi-ai.providers.<route>.models[].input`.
- **Retry policy** — per-provider `retryPolicy`: finite (`normal` + `maxRetries`) or unlimited (`always`), written to `llm-pi-ai.providers.<route>.retryPolicy`.
- **DeveloperRole** — per-provider `compat.supportsDeveloperRole`: supported, unsupported, or left to detection, written to `llm-pi-ai.providers.<route>.compat.supportsDeveloperRole`.
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

Tests: `npm test` (`node --test "test/*.test.mjs"`). The suite mounts both halves
against fake harnesses — the browser half through a small React hook shim, so it
runs in plain Node with no browser and no build step.

## Notes

- Only `llm-pi-ai` providers with a **user-declared `models` list** appear in the page (custom providers; the built-in Models page already owns catalog providers).
- Leaving the subagent provider/model empty keeps the default behaviour (inherit the parent model).
- The page reads the `llm` service on `/load` to resolve inherited modalities for
  its hint; a harness without that service still loads the page, just without the
  hint.

### Input modalities

Each model card carries a **Text / Image** checkbox pair, written to
`providers.<route>.models[].input`. The vocabulary is closed — `dsh-llm-pi-ai`
validates it against pi-ai's own `Model<Api>['input'][number]` union, which is
`text | image` — so the page cannot offer anything else.

What the boxes mean is subtler than it looks, because an absent list and an empty
one are the same thing to `dsh-llm-pi-ai`:

| Boxes | Stored | Effect |
|---|---|---|
| all unticked | field absent | the model states no answer, so it inherits |
| some ticked | `input: [...]` | the model claims exactly those modalities |

That "inherit" is not a fixed default: `dsh-llm-pi-ai` falls back to the
installed catalog entry's modalities, then to the route's `defaultInput` (itself
`["text"]` unless configured). Which of those wins is a fact only the adapter
knows, so the page asks it — through `llm.listModels()` — and shows the resolved
list as an `inherit: …` hint next to the boxes. The hint is advisory: when the
adapter cannot answer, or the route is not mounted, the hint is simply omitted
and the boxes still work.

Declaring modalities is what makes a hand-declared vision model usable: a model
pi-ai has never heard of gets no catalog entry, so without an explicit `input` it
falls back to `defaultInput` and the harness refuses image attachments with
`pi-ai model "…" does not support image input`. It is a claim about the endpoint,
not a check of it — nothing interrogates a gateway — so a model claiming images
its endpoint refuses fails at the provider instead, mid-turn.

Modalities are orthogonal to reasoning, so the pair stays editable on a model
whose **Reasoning model** toggle is off; a non-reasoning model can still accept
images. The page refuses a list naming an unknown modality or one repeated
twice; both would otherwise be rejected by the settings schema with a message
that does not name the offending model.

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
