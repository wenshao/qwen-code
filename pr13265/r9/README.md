# PR #13265 round 9 (final head 5986e18d3f)

The head moved six times during the round. The commit each result was taken at is noted in the file names. Code identity across commits:

| Area | Identical between | Notes |
| --- | --- | --- |
| Supervisor and cgroup | `2a3688d703` → head | |
| Executor | `ce870e6920` → head | |
| Record funnels | `b95765da88` → head | |
| Server Java | `4b339c9140` → head | |
| Final merge `5986e18d3f` | — | Touches only an unrelated ACP fix and the HTTP-store test file |

## Linux (192.168.0.75, kernel 6.6.89, cgroup v2): `linux-75/`

Builds, bundled with `probes/build-bundles.mjs`:

| Build | What it is |
| --- | --- |
| `head9` / `rest9` | 4b339c9140, and the same plus the two round-3 edits (`probes/fix-rest8.mjs`: H4 signal re-raise, H3 wait-after-kill). Logs in `linux-75/4b339c9140/`. |
| `head10` / `rest10` | 2a3688d703 and the same plus the two edits. |
| `head11` | ce870e6920, for L19/L20; the executor changed there. |
| `fix10` | head10 plus `probes/fix-terminate-race-r9.mjs`: terminate answers the natural end's evidence when that settle removed the unit first. |
| `fixr10` | rest10 plus the same race fix: the full measured patch set. |

Probe changes this round:
- `b-l15b-hold.mjs` is new. A launcher exits while a member keeps running: is the hold kept, and is the evidence given only once the member ends?
- `bound-waits-r9.mjs` bounds L19's and L15's waits, because a launcher that leaves a live member no longer ends.
- `add-route-terminate-r9.mjs` adds `routeTerminate` (shell-terminate on running Shells through `ManagedShellRuntime`, 20 per build) and makes the probe's own cleanup record errors instead of crashing.

Runners:
- `run-75-r9.sh`: 4b339c9140.
- `run-75-r9b.sh`: stopped at L15/L19 once the new hold semantics made them wait forever.
- `run-75-r9c.sh` and `run-75-r9d.sh`: the final measurements for head10/rest10, and head9's stop scenarios.
- `run-75-r9e.sh`, `run-75-r9f.sh` and `run-75-r9g.sh`: fix10, fixr10 and head11.
- `run-75-l15b.sh`: L15b.

`cmp75.mjs` and `cmp75b.mjs` compare result JSON across builds, ignoring timing fields.

## macOS real stack: `macos/`

Spring jar built at 4b339c9140 (server Java unchanged since) on native MySQL 8.4.7, fresh schema V1–V41.

| Scenario | What it covers |
| --- | --- |
| S1, S6–S12 | Run at 4b339c9140. They drive simplified manifests, which b95765da88's funnel refuses by design. |
| S13 | Refused finalize, then attach with and without `settleAttached`. Run at 370d933332, 2a3688d703 and b95765da88. |
| S14 (new) | The lineage rule under real publisher writes, sequential and concurrent (b95765da88). |

`*.flyway.txt` holds the Flyway runs: main's V40 then V41, and the round-8 schema refusing to start.

## Fixture probes: `fixture-probes/`

Local copies of the PR's own `RuntimeBrokerServiceTest` and `hosted-workspace-tool-turn.test.ts`, restored afterwards. Probes J1, J3, J4, J5, J6, J6b and TURN (H9); `results.txt` holds every result line.

## Mutants: `mutants/`

Each mutant was applied to a local worktree and restored afterwards, with `git diff` clean.

| Mutant | Edit | Result |
| --- | --- | --- |
| `mutant-reconcile.log` | Drop the reconcile arm's sibling settle | Killed |
| M1 | No `settleAttached` | Killed by the public-entry witness |
| M2 | No publication lane | Killed by the public-entry witness |
| M3 | Wake wiring compares `cause.name` | No deterministic failure |
| M4 | Settle on the root exit | Killed |
| M5 | Any higher revision advances | Killed |

`mutant-wake-wiring.txt` and `mutant-settle-attached*.txt` are the same checks at 370d933332, where both survived.

## Results: `results/`

| File | Contents |
| --- | --- |
| `ts-*-<commit>.txt` | TS suites per head |
| `harness-reruns.txt` | Takeover-family reruns |
| `java-build-*.txt` | Java `clean verify` with MySQL ITs |
| `broker-checkstyle-*.txt` | Broker checkstyle |
| `ToolPublicationStoreTest-alone-*.txt` | The flaky class run alone |
| `ci-test-ubuntu-4b339c9140-excerpt.txt` | The 12 HTTP-store cases inherited from main at 4b339c9140 |

The local rig database password is redacted as `<local-rig-password>`.
