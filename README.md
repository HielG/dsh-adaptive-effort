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

1. Deploy the module into the desktop profile:

   ```powershell
   pwsh -File deploy.ps1
   ```

2. Add the row to `~/.dsh/profiles/desktop/cordis.patch.yml` (once):

   ```yaml
   - insert:
       - id: adaptive-effort
         name: ./plugins/adaptive-effort.js
         config:
           debug: true
   ```

   Relative entry paths are anchored beside the patch file.

3. Restart DSH. The profile is composed at boot, so a running app keeps the old
   generation.

## Tuning

All fields are optional `config` keys on that row:

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
- **Disable:** add `disabled: true` to the row, or remove it.
- **Remove:** delete the row and `~/.dsh/profiles/desktop/plugins/adaptive-effort.js`.

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
| `deploy.ps1` | Copies the plugin into the desktop profile |
