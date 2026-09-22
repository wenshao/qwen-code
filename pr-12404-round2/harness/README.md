# PR 12404 round-2 harness

Real `qwen serve` + the daemon's Web Shell in Chromium (Playwright), mock OpenAI provider (`mock-openai.mjs`).
Round 1's harness is in `../pr-12404/harness`; this directory adds the round-2 cases.

- `env.sh`, `setup-home.sh`, `start-daemon.sh <arm>` (`$WT/.arm-<arm>` = a full `dist/` copy; `RT=` runtime dir, `HQ=` home), `killd.sh`.
  Arms: `head` (8363acf1a8), `base` (8f86b4f1a8), `fix` (head + `fix-isValidComposerTag.diff`, Web Shell rebuilt), `mix` (head daemon + base Web Shell).
- `r2-cases.mjs`: raw `_meta.inputAnnotations` cases (NULLMIX, CAP256, CAP257, HUGE, FIELDVALUE, FIELDLABEL, FIELDSERIAL, VALIDONE).
- `r2-post.mjs <arm> [cases]`: live browser + raw POST; `persisted.py`: the persisted user record per case; `r2-view.mjs <arm> <label> <json>`: fresh-browser reload / post-restart view.
- `r2-live-edit.mjs <arm> <case>` (`RELOAD_FIRST=1` for the control): edit a live message and resend. `probe-remap.test.ts`: unit probe for the edit remap.
- `r2-title.mjs`, `r2-title-multi.mjs`: title side-query capture with `fastModel` set.
- `s1.mjs`, `view-url.mjs`: real @-picker core scenario and URL reopen. `compose.mjs`: figures.
- `run-cli-mutants.sh` (Session.ts, hardlinked copies), `run-fast-mutants.sh` (acp-bridge + web-shell), `stress2.sh` (git-branch-ops fixture arms under load).
