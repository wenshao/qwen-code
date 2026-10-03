# PR #13206 real-stack verification evidence

Arms: `base` = main 5130c1a734, `head` = local trial merge of PR head 52867f323f into that main (54196242b3, not pushed).
Stack: MySQL 8.4.7, Java managed-agent server fat jar built from the trial merge (no Java changes in the PR),
packaged Hosted Harness (`dist/cli.js` from the trial merge) with a scripted OpenAI-compatible model,
two vite dev servers (one per arm) proxying the WebShell adapter through `harness/wire.mjs` to the same Java server,
headless Chromium via Playwright. Both arms watch the same Session at the same time.

- `01..03-*.png` figures used in the PR comment
- `harness/` rig scripts (`rig.env.example` has the local tokens removed)
  - `live.mjs` S1/S1b/S2/S2b/S2c/S3/S3b, `gap.mjs` S0/S4/S5, `paging.mjs` S6/S8 (DB=raw, materializer off)
  - `wire.mjs` frame-rewriting proxy between vite and the Java server; `mutate.mjs` mutation runner
- `results/ui`, `results/raw` per-scenario logs and JSON
- `results/mutation` mutation results; `results/static` gate summaries
- `candidate-stall-threshold-test.patch` test-only candidate (+5/-6) that pins the third-stall threshold
