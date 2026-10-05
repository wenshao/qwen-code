# PR #13265 round 12 (head b883b6631c)

## Linux (192.168.0.75): `linux-75/`

`run-75-r12.sh` runs the probes for two builds:

| Build | What it is |
| --- | --- |
| `head14` | The exact-head dist |
| `rest14` | head14 plus the two round-3 edits |

## Real stack: `macos/`

Spring jar built at b883b6631c, native MySQL 8.4.7.

| File | What it covers |
| --- | --- |
| `s15c-redrive.mjs` | Injects failures into record forwards (`FAIL_SET` lists the call numbers; `FAIL_FOR_MS` sets an outage window after the first failure). It sends no client retry and watches the record for 10 s. Outputs: `s15c-oneshot`, `-twoshot`, `-outage30`, `-outage300`. |
| `*.flyway.txt` | Main's V44 then V45; the round-11 schema refusing at V41 |

## Broker: `broker/`

`R12BackgroundSweepProbeIT.java` was copied into a local runtime-broker test tree, run with `-Pmysql-integration` against the MySQL schema the build created, and removed afterwards. It compares the Jdbc and InMemory `findBackgroundProcesses` paging at limits 100, 7 and 1.

## Mutants: `mutants/`

| Mutant | What it removes | Result |
| --- | --- | --- |
| M9 | The durable backfill | Killed by `releaseSweepsADurableOnlyBackgroundRow` |
| M10 | The re-drive scheduling | Killed by the re-drive witness |

## Results: `results/`

TS and Java logs, plus the remerge-diff of 601c6bd03b.

The local rig database password is redacted as `<local-rig-password>`.
