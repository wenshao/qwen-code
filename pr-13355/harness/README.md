# PR #13355 verification harness

Local paths are kept as they were run (`/root/verify/pr13355/...`).

- `xlang.test.ts`: the cross-language differential. Drop it into `packages/core/src/__xlang13355__/`, start a server with `start-server.sh <arm> <port>`, then run `XLANG_URL=http://127.0.0.1:<port> XLANG_ARM=<arm> XLANG_OUT=<file> npx vitest run src/__xlang13355__` from `packages/core`. `summarize.py` prints the verdict table.
- `driver.py`: the revert arms, the base-with-PR-tests arm and the 23-mutant matrix. Each arm is a copy of `managed-agent-server` plus the shared contract fixtures, patched by an exact-once string replacement and run offline against the store test classes.
- `probe_split.py`: dumps the event and Part rows for the Fix 3 scenario, on the head arm and on the reverted arm.
- `race.py` + `Pr13355OutboxRaceProbeTest.java`: the task-event outbox concurrency probe on MySQL, with a negative control that removes the Session lock.
- `upgrade.sh`: goes from main's schema (`target=35`) to the renumbered V36, on the merged tree.
- `render.cjs`: renders the figures from `../data`.
