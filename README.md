# PR #10066 — maintainer verification assets

Evidence for the local end-to-end verification of
`feat(serve): allow relocating session attachment storage via env var`
(`QWEN_SERVE_SESSION_ATTACHMENTS_ROOT`), run against a **real `qwen serve`
daemon** at head `702c665c94d66e4cd2aff1853502e6b74d5e6c47`.

| file | what it shows |
| --- | --- |
| `01-migration.png` / `A-migration.log` | baseline (env unset) → restart with the env set: fallback read, no shadowing, per-workspace hash isolation |
| `02-lifecycle.png` / `B-lifecycle.log` | attachment delete, session delete, archive, session branch — across both roots |
| `03-config.png` / `C-config.log` | a project `.env` cannot redirect storage; `~/…` and relative path forms |
| `04-degraded.png` / `D-degraded.log` | degraded-root probes with the daemon dropped to uid 1500 (`chmod 000` = real `EACCES`) |
| `05-mutation.png` / `E-mutation.log` | 9 mutation probes on the PR's new logic, 9 killed |
| `06-rotation.png` / `F-rotation.log` | the two migration directions the fallback does not cover |

Harness lives at `/root/git/pr10066-harness` (not committed here).
