# PR #13265 round 10 (head edcbe0e537)

Java is unchanged since round 9: the broker since ce870e6920, the server since 4b339c9140. Every result here was taken at edcbe0e537.

## Linux (192.168.0.75): `linux-75/`

| Build | What it is |
| --- | --- |
| `head12` | The exact-head dist |
| `rest12` | head12 plus the two remaining round-3 edits (`probes/fix-rest8.mjs`) |

Runners:
- `run-75-r10.sh` runs L1/L13/L14/L15b/L19/L20 for both builds.
- `run-75-r10b.sh` runs an extra admission check (`bgValidation`, added by `probes/add-bg-validation-r10.mjs`) on ce870e6920 and edcbe0e537. It started the same commands on both heads, so it is not reported as a finding.

`cmp75c.mjs` compares the results with round 9 (`round-9 head` = ce870e6920 / 2a3688d703 builds), ignoring timing fields.

## Mutants: `mutants/`

`mutants-r10.mjs` applies each mutant to a local worktree and restores it, checking that `git diff` is clean afterwards. `summary.json` records each mutant's site, tally and failed tests.

| Mutant | What it changes |
| --- | --- |
| M3 | The Session's injected `needsRecovery` value compares names |
| M4 | The registry settles on the root exit |
| M6 | The supervisor terminate loses its `settled` guard |

## Real stack: `macos/`

S13 and S14 on the jar built at 4b339c9140 with native MySQL 8.4.7, against a fresh schema.

## Results: `results/`

TS cli (22 files) and core suites.

The local rig database password is redacted as `<local-rig-password>`.
