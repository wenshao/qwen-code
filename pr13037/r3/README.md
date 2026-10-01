# Round 3 — head e47fa595ee (merges main 0a4bed5c9f)

Same rig as round 1 (`../harness`, start with its README), re-run on fresh MySQL schemas:
`o3g` (main scenario set) and `o3h` (in-place upgrade from main). The real-bucket leg was not repeated:
the only Java changes since db01133aec are the `Connection: close` header, the `created_at` clock and tests.

- `round3.sh` → `round3-extra.sh` → `round3c.sh` — the batches, in that order; `s10d-relay-paired.sh` — PR and candidate alternating behind the latency relay.
- `t-abort-corrupt.mjs` — new: intact full/range downloads (records `Connection`), then one bit flipped in segment 5 of 8.
- `b8-abort-ui.mjs` — new: the grant is revoked while the WebShell panel downloads 99 MiB; `ORIGIN` selects the Vite dev server (5137 = PR config, 5139 = candidate config).
- `s3-lifecycle.mjs` — its slow reader now uses `node:http`: Node's `fetch` hit an internal undici assertion when the server closed a paused body (`results/s3-s1a-crashed-fetch-client.log`; a client-library issue, not a server result).
- `candidate-e47fa595.patch` — the F1 part of the earlier candidate (the `Connection: close` part is now in the PR).
- `candidate-vite-proxy-e47fa595.patch` — 9 lines in `packages/web-shell/vite.config.ts`: destroy the browser response when the upstream response closes before it is complete.
- `results/invalid-overlap/` — runs made while a concurrent abort probe kept the 99 MiB Session's grant revoked (404); re-run afterwards (`s6-gone.log`, `s10-dblatency.log`). In `s10c-paired.log` the first pair's 99 MiB rows are the same 404s; its 1 GiB rows and the second pair are valid.
- `t-abort-corrupt-cand.mjs` / `results/t-abort-corrupt-cand.log` — the corruption probe against the F1 candidate (separate Workspace on `st-s87`): the candidate also stops at exactly 5 MiB.
