# PR 12729 verification harness (head 4850293)

All scripts read the PR worktree through environment variables; nothing here is repo code.

- `docref.py`: an independent reading of the design document (value rules, manifest, pages, position, revisions, envelope, ledger).
- `replay.py <fixtures.json>`: replays every fixture verdict through `docref.py` (499/499).
- `fuzz.py <fixtures.json> <N>` + `eval.mjs` + `ajv.mjs`: mutational differential fuzz, TS module vs Ajv schema vs `docref.py`.
  Env: `CORE=<worktree>/packages/core` (uses `dist/`, built by `pnpm install`); `MODPATH`/`SCHEMAPATH` point at a patched build.
- `worker-probe.mjs`: spawns `node dist/cli.js managed-runtime-worker`, sends Tool v3 requests with canaries. Env: `REPO`, `OUT`.
- `probe-f1.mjs`, `size.mjs`: the F1 probe and the 64 KiB bound measurement.
- `mutants.py <worktree>`: 86 single-replacement mutants of `managed-tool-result.ts`, each run against the PR suite (file restored from a byte copy).
- `candidate-f1.patch`: the candidate fix for F1 (module, schema, two fixture cases); `git apply` at 4850293.
- `card.py`: the PNG card renderer.
