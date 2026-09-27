# PR #12840 verification harness (rig only, not for merge)

Paths are rewritten to `/path/to/scratchpad`; set it to a directory that holds
worktrees `wt-pr*` / `wt-base`, `jars/`, `out/`, `logs/` and this `rig/`.

| file | what it does |
| --- | --- |
| `spring.sh`, `harness.sh`, `daemon.sh`, `fake-model.mjs` | Spring jar on MySQL/MariaDB, packaged `qwen serve --profile hosted-harness`, an isolated daemon for the Web Shell, and a scripted OpenAI-compatible model |
| `replay.mjs` | S1/S2: paging via `next_cursor`, limits, identity vs Items, the replay floor (raised with SQL), 409 envelope, public and WebShell resync frames; Ajv against the PR spec (`SPEC_WT`) |
| `overflow.mjs` + `stuck_client.py` | S3/S3b/S4: a client with a 4 KiB receive buffer stops reading while Session renames write events (2 per rename), the hub drops its range, the floor rises past it; catch-up from 0 racing writers. MySQL general log counts the stream's `LIMIT 100` store reads |
| `ui-resync.mjs` | Real Web Shell (vite) in Chromium: holds the page's first events/stream request, runs a Turn, raises the floor, releases; records stream/transcript requests and screenshots |
| `upgrade.mjs` + `legacy-gen.mjs` | main's jar writes real Turns and randomized legacy events (SQL) and materializes them; the PR jar migrates V14/V15; every backfilled identity is checked against main's Snapshot; then a rollback to main and a roll-forward |
| `perf.sh`, `abtest.sh` | V15 on one Session of N events under a given heap; one V13 dump migrated by different jars, identity columns compared by MD5 |
| `RetractionIdentityProbeTest.java` | Store-level randomized retraction probe (copy into the managed-agent-server test tree, `-Dprobe.cases`, `-Dprobe.seed`) |
| `mutate.py` | Mutants outside the author's list, each against the full unit suite |
| `cards.py`, `cards-spec.cjs` | The evidence figures |
