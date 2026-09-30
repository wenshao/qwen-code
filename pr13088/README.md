# PR #13088 — real-environment verification evidence

Head verified: `7c54aa78f9f9912ac507d27004c106ac6dcd34e9` (base: main `e263741eb0`). A first round ran on `0404833315`.

- `NN-*.png` — evidence cards (rendered from `harness/host/cards-*.mjs`; every value is copied from a log under `results/`).
- `cand-birth-time.patch` — proof-of-concept for finding 1 (adds the root directory's birth time to the registered identity).
- `harness/vm/` — scenario drivers that run inside the Linux VM (`lib.mjs` plus `sN-*.mjs`), the systemd unit and launcher.
- `harness/container/` — Java 21 container scripts (jar build, CI job replay, fault gates, README-verbatim maintenance run).
- `harness/mut/` — mutant tables and runners (TypeScript and Java), unit stage and Linux/MySQL integration stage.
- `harness/host/` — host-side runners and the figure renderer.
- `results/head-7c54aa78/` — logs of every scenario at the verified head; `results/first-round-04048333/` — the first round.
- `results/mutation/`, `results/ci/` — mutation consoles, CI replay consoles, GitHub job summary.

Verification rig only; paths are sanitized (`/rig`, `/home/rig`).
