# PR #13351 real-environment verification evidence (head 5e9bd4c, base 5ddfacc)

- `01-webshell-managed-panel.png` — Web Shell Managed panel (vite + Playwright) against each arm's Java server.
- `02-ab-matrix.png` — packaged-stack A/B matrix (fake gateway + MySQL 8.4.7 + server jar + dist/cli.js Hosted Harness).
- `03-feed-and-journal.png` — public feed, Harness journal and model requests for the issue scenario.
- `04-probes.png` — real-stack mutation (flush-before-retract removed), mixed versions, old-Harness journal open, blast radius.
- `results.tsv` — one row per run. File-name tags: `mixNewH` = head Harness on the base server, `mixOldH` = base Harness on
  the head server, `m1*` = mutant jar, `ctl*` = head jar control, both with `events.batch-interval=3s`; `invalid` runs excluded.
- `rig/` — the scripts (scripted gateway `model.mjs`, scenario driver, UI driver, cutting proxy for the real model).
  `real-settings.mjs` derives the Harness settings from ~/.qwen/settings.json the same way
  `scripts/run-managed-agent-server-e2e.ts` does; no credential is stored here.
