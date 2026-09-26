# PR 12729 round 2 addendum (heads a94d76f, 5decdd5, b76574e)

Round-1 harness (docref.py, fuzz.py, eval.mjs, worker-probe.mjs ...) is in `../../harness/`; this round reuses it.

- `worker-probe-v2.mjs`: boot v2 (managed-context/1 fixture boot) worker on the merge tree; installs a context, then Tool v3 requests with canaries. Env: `REPO`, `OUT`.
- `managed-tool-result-admission-boot-v2.test.ts`: candidate admission test over both route lists (boot v1 and `MANAGED_CONTEXT_WORKER_ROUTES`); only compiles after the branch has main (89b057b or later). Drop into `packages/cli/src/serve/`.
- `mutants-r2.py` / `mutants-r2.log`: the round-1 sweep plus four mutants of the F1 fix, at a94d76f.
- `size2.mjs`: rebuilds the two manifests of the updated size test.
- `fuzz-summary-r2.txt`, `worker-probe-v1.txt`, `worker-probe-v2.txt`: raw results.
