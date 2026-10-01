# Round 2 — head db01133aec (rebased onto main 937ed13a15)

Same rig as round 1 (`../harness`, start with its README), re-run on fresh MySQL schemas:
`o3e` (main scenario set), `o3f` (in-place upgrade from main), `o3r2` (real private OSS bucket, deleted afterwards).

- `round2.sh`, `round2b.sh`, `round2c.sh`, `round2d.sh` — the batches, in that order.
- `spring.sh` — adds the two settings main #13114 made mandatory (`verification-bytes-per-second`, `max-verification-timeout`).
- `candidate-db01133a.patch` — the round-1 candidate, applied unchanged to this head.
- `results/failed-start/` — the first batch attempt, before those two settings were added (the server did not start; nothing in it is a result), and a latency run made while the delay relay was not running.
