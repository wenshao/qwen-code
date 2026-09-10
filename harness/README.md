# PR #11576 verification harness

Real end-to-end kit: the built Qwen Code CLI (headless, Ink TUI and `qwen serve`)
driven against an OpenAI-compatible mock that can fail the Goal evidence
checkpoint verifier in each of the shapes the PR distinguishes.

| file | what it is |
| --- | --- |
| `env.sh` | isolated `HOME`, `QWEN_HOME`, workspace, mock port `4576`, tmux socket `pr11576` |
| `mock-model.mjs` | the mock provider; classifies every request by its system prompt and answers the checkpoint verifier per `out/control.json` |
| `setup-home.sh` | throwaway `HOME` + settings (`model.goalCheckpointTimeoutSeconds` is the arg) |
| `start-mock.sh` / `stop-mock.sh` | mock lifecycle (probes the port with curl; `ss` to kill) |
| `arm.sh <label> <mode>` | one headless run to a Goal stop, then the goal-state ladder |
| `tui-start.sh` / `send.sh` / `cap.sh` | the same run in a real Ink TUI under tmux |
| `goalstate.mjs` | journal `*.jsonl` → the Goal record ladder (`checkpointStalls`, `lastCheckpointFailure`, `limitKind`, `lastReason`) |
| `mutate.mjs` | the mutation matrix: one shipped line edited per mutant, only the tests that should notice are run |
| `ansi2png.py` | `tmux capture-pane -e` → PNG |

## Verifier modes (`out/control.json` → `verifier`)

| mode | what the mock does | shape the runtime should read |
| --- | --- | --- |
| `full` | 32 valid claims citing real evidence uuids | `full_claims` |
| `badref` | one claim citing an id that is not in the window | `unusable` |
| `empty` | `{"claims": []}` | `unusable` |
| `error` | HTTP 500 | `unreachable` |
| `timeout` | never answers; the runtime's own ceiling ends the check | `unreachable` |
| `ok` | one valid claim | no failure — clears the diagnostic |

## Gotchas worth keeping

- **A mock that keeps issuing tool calls never ends the Goal turn.** Answer the
  request that carries the tool results with text only; that is what ends the
  turn and lets the runtime run its checkpoint. Without it the run dies on the
  per-turn tool-call cap and looks like a harness failure.
- **The window has to overflow on *every* turn**, not just the first. A
  successful checkpoint advances the evidence cursor, so the next turn starts
  from a fresh window and the streak resets. Set `bulkTurns` high enough that
  every turn emits its 60 probes, or the `full_claims` arm never reaches three
  consecutive stalls (it ran 1081 turns without one before this was fixed).
- **Cite the real evidence uuids and their real `proofKind`.** A claim that
  changes a source's proof kind is rejected as *unusable*, which silently turns
  a `full_claims` arm into an `unusable` one.
- 60 shell probes per turn put ~57 entries in the bounded window — enough to
  truncate it (`CATALOG_ENTRY_LIMIT` 100, `CATALOG_BYTE_LIMIT` 24 000).
- `model.goalCheckpointTimeoutSeconds` is a real setting (1..cap): set it to
  8-15 s so the `timeout` arm finishes in seconds instead of 3 × 180 s.
- Do not pipe the TUI's stdout; capture with `tmux capture-pane -e -p`.
