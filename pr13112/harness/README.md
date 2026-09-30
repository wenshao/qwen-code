# PR #13112 verification rig (macOS arm64, host processes, no containers)

VERIFICATION RIG ONLY. Tokens in `rig.env` are local throwaway values.

- `build-java.sh <label> <worktree> <m2>`: builds the server fat jar and the test-only `X-Rig-Actor` adapter (`adapter-src/`).
- `build-ts.sh`: `npm run build && npm run bundle` in the head worktree. The result is copied to `dist/head`, which is the Hosted Harness and the Runtime worker entry.
- Native MySQL 8.4.7 on port 33112 (UTC).
- `aux.sh <db>`: starts the scripted model (`probe/model.mjs`) and the recording/fault proxy (`probe/tap.mjs`).
- `harness.sh <db> [dist]`: starts the packaged Hosted Harness with a clean env. Set `MODEL_URL`/`MODEL_KEY`/`MODEL_NAME` to point it at a real model.
- `spring.sh <jar> <db> <approval-mode|absent> <timeout|absent>`: starts the real Spring server with the embedded Broker, eight Workspace mounts and the opt-in. `WSFILES=false` turns the opt-in off.
- `vite.sh head|base`: serves the Managed panel from a worktree, using `fixture/rig-13112.{html,tsx}`.
- `fast.sh` / `it.sh`: run the unit lane (surefire) and `HostedPublicWorkspaceIT` on MySQL.
- `probe/`:
  - `s1` later Turn / cancel / rename / lifecycle
  - `s2` opt-in off
  - `s3` approvals
  - `s4` grant drift
  - `s5*` restarts
  - `s6*` lost cancel (F1)
  - `s7` Playwright panel
  - `s8` worker crash (F2)
  - `s9` real model
  - `mutate.mjs` mutation matrix
  - `figures*.mjs` evidence figures

Actors: `alice` is the creator (read+create), `carol` has read+create but is not the creator, `bob` can only read, `mallory` has no grant.
