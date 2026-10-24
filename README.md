# dsh-adaptive-effort

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that spends reasoning
tokens only where they buy something: it picks the model's **reasoning effort per
turn** instead of pinning one level for the whole session.

| Turn | Effort | Why |
| --- | --- | --- |
| "hi", "thanks!", "ok 👍" | `off` | no reasoning, and no chain-of-thought passed back into later requests |
| "what's the latest version?", "rename the folder", "show the files" | `low` | short, no complexity cue, no judgment verb |
| "fix the bug", "add a button", "why does it drop connections?" | `high` | judgment work; the harness default |
| code pasted with a complexity cue, ≥ 3 complexity cues, ≥ 900 chars with 2 cues, or an explicit "think hard" / "max effort" | `max` | genuine complexity, or you asked for it |

An explicit `off` selected in the UI is never overridden. A model that reports no
effort support is left untouched. A level that already matches is a no-op, so the
request header does not churn.

## How it works

- `agent/created` → one listener pair registered on that agent's own context,
  disposed with the agent.
- `agent/pre-step` → classifies the newest user message, once per prompt.
- `agent/request` → rewrites the waterfall result's `reasoningEffort`. This is the
  same extension point the harness's own model selection uses, so the loop hands
  the value to `llm.prepareCall()`, which validates it against the adapter's
  `off | low | high | max`.

Nothing is written to the session log, no messages are modified, and no extra
model call is made — the plugin costs zero tokens beyond the effect it has on
reasoning itself.

### Token economics it relies on

Reasoning effort costs twice: the thinking tokens are output tokens now, and
DeepSeek passes a reasoned turn's chain of thought back into later requests, so an
unnecessary `max` keeps charging input tokens afterwards. That is why `off`/`low`
are used aggressively on social and mechanical turns, and why `max` requires two
independent signals rather than "the prompt looked long".

## Install

This package is a **DSH bundle**: `package.json` declares `dsh.bundle.patch`, and
[`cordis.patch.yml`](./cordis.patch.yml) inserts the plugin row. Installed that
way it appears in the Harness **Plugins** tab with its title, description, and
icon.

- **From the Harness UI:** open *Plugins* and install this directory as a bundle
  (Creator-preset sessions expose the `plugin_manager` tool with
  `action: install_bundle` and this package directory as `target`).
- **Manually:** add it to the profile manifest and install:

  ```jsonc
  // ~/.dsh/profiles/<profile>/package.json
  {
    "dependencies": { "dsh-adaptive-effort": "file:/path/to/dsh-adaptive-effort" },
    "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-adaptive-effort"] } }
  }
  ```

  ```powershell
  pnpm install --dir "$env:USERPROFILE\.dsh\profiles\desktop"
  ```

Either way, restart DSH afterwards: the profile is composed at boot.

> A bundle dependency is a copy. After editing this checkout, run
> `pnpm install --dir <profile>` again (or reinstall the bundle) and restart.

## Tuning

Thresholds are `config` fields on the `adaptive-effort` row. To override them,
add a normal patch entry to the profile's `cordis.patch.yml`:

```yaml
- id: adaptive-effort
  name: dsh-adaptive-effort
  config:
    debug: true
    socialEffort: low
```

| Field | Default | Meaning |
| --- | --- | --- |
| `trivialMaxChars` | `160` | At or below this length, a signal-free ask is `low` |
| `longChars` | `900` | At or above this length, two complexity cues escalate to `max` |
| `complexCues` | `3` | Complexity cues that escalate to `max` on their own |
| `socialEffort` | `off` | Level for social turns; set `low` if you never want thinking disabled |
| `debug` | `true` | One line per decision in `%TEMP%\dsh-adaptive-effort.log` |

The debug log records the reason, so spend is auditable:

```
2026-10-24T13:10:24.382Z active levels=off/low/high/max social=off
2026-10-24T13:20:02.101Z turn=3 level=off reason=social chars=8
2026-10-24T13:21:44.900Z turn=4 level=max reason=code+cue chars=1841
```

## Verify, disable, remove

- **Verify:** the log contains the `active` line after a restart, then one line per
  classified turn. The session's logged `request/header` carries the level actually
  used.
- **Disable:** toggle the bundle off in the Plugins tab, or add `disabled: true`
  to the row override.
- **Remove:** remove the bundle from the Plugins tab (or from the profile
  manifest, then `pnpm install`).

## Development

```
node adaptive-effort.test.mjs   # or: npm test
```

The test covers the classifier and simulates both cordis contexts, including the
guard that keeps a user-selected `off` from being overridden.

| File | Role |
| --- | --- |
| `adaptive-effort.js` | The plugin (dependency-free, Node builtins only) |
| `adaptive-effort.test.mjs` | Classifier cases + listener simulation |
| `cordis.patch.yml` | Bundle patch that inserts the plugin row |
| `locale/en.json`, `locale/zh.json` | Display metadata for the Plugins tab |
| `icon.svg` | Plugin icon |
