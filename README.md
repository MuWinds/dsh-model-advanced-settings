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

Then install the dependency in the profile (e.g. `dsh plugin --profile web add @muwinds/dsh-model-advanced-settings`) and restart the web profile.

## Structure

Single-bundle plugin (the standard dsh plugin shape):

- `lib/index.js` — Host half: registers `/dsh-model-advanced/*` HTTP routes and hooks `agent/created` to override the subagent request route.
- `lib/client.js` — Browser half: the `settings.section` page (discovered through the `dsh.client` declaration).
- `cordis.patch.yml` — loader patch inserting the row into the profile.

## Notes

- Only `llm-pi-ai` providers with a **user-declared `models` list** appear in the page (custom providers; the built-in Models page already owns catalog providers).
- Leaving the subagent provider/model empty keeps the default behaviour (inherit the parent model).

## License

MIT
