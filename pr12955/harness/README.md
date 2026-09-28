# PR #12955 real-stack rig (verification only)

Paths are the reviewer's scratchpad; adjust `SP`/`R` at the top of each script.

- `build-java.sh` / `build-ts.sh` — per-arm jars (`pr`, `base`, `merge`, `cand`) and CLI bundles (runs `patch-package` after an offline `pnpm install --ignore-scripts`).
- `spring.sh <jarArm> <db>` — production jar + `RigActorConfig` (trusted-principal stand-in, same shape as the PR's IT filter) via `-Dloader.path`; MySQL; embedded Broker with mounts `st-a..st-l`; env `FILES`, `HARNESS`, `STORE`, `BROKER`, `STORAGES`.
- `harness.sh` — packaged `qwen serve --profile hosted-harness` with a clean env and the deterministic `model.mjs`; `harness-real.sh` — same with a real OpenAI-compatible provider (`REAL_MODEL_BASE_URL`, `REAL_MODEL_API_KEY`).
- `tap.mjs` — Spring→Harness wire recorder; `touch tap.jsonl.fail` drops requests (S3b). Rewrites `Host` and propagates upstream aborts.
- Probes: `s1` happy path/replay/matrix/later ops/wire · `s2` same-Workspace concurrency + workers · `s3`/`s3b` binding refusal after admission (s3b = no Harness restart, used for the report) · `s4` Harness SIGKILL mid-Turn · `s5.sh` startup validation · `s7` base / opt-out admission · `s9` real model.
- Mutation: `mutate.mjs` (M1–M20, exact-string, asserts one hit), `mut-run.sh` (full unit suite), `mut-it.sh` (IT on survivors), `optin-test.sh` (candidate test vs M9/M10/M9+M10).
- `candidate-f1-f2.patch` — 2 commits on 3c53e186 (also applies to PR ⊕ main 9f6138ae): F1 coordinator fix + test, F2 opt-in test.
- `g0-rig.tsx` — managed Web Shell fixture page (Vite dev server with `QWEN_MANAGED_AGENT_JAVA_URL`).
