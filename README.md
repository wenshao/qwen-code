# PR #12120 — local verification evidence

Screenshots produced while verifying https://github.com/QwenLM/qwen-code/pull/12120
on macOS with real bundled builds (`npm run bundle` → `dist/cli.js`) of the PR base
(`f822124`), the PR head (`8daa1a2`), and a pre-#12105 build (`4fc3dec`) used to
record genuine legacy Goal sessions.

| file | what it shows |
| --- | --- |
| `01-legacy-session-resume.png` | a real legacy session (46 `checkpoint` records, 46 `evidenceCheckpoint`, 46 `checkpointPending`) resumed on base and on head — identical |
| `02-allowlist-mutation.png` | head with the legacy keys taken off the closed-key allowlist: the same session silently rewinds 22 turns and goes active again |
| `03-deprecated-setting-startup.png` | five invalid `model.goalCheckpointTimeoutSeconds` values: base refuses to start, head ignores them |
