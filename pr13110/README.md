# PR #13110 — real-environment verification evidence

Head verified: `fbafd241c1f2ecc389e6e22da490279cf75a74c7` (a first round ran on `32dc814d03`). Base arm: main `7827a3ffcd`.

Everything here was produced by a local throwaway rig (MySQL 8.4.7, the server fat jar with its embedded Runtime Broker and
local-process workers, the packaged Hosted Harness). Tokens and passwords in `harness/rig.env` are rig-only values.

| Path | Content |
| --- | --- |
| `01-…08-*.png` | Figures used in the PR comment; rendered from the result logs by `harness/fig/` |
| `cand-no-brick.patch` | Candidate patch relative to `fbafd241c1` (Harness only, two unit tests) |
| `harness/` | Rig scripts: server, MySQL, builds, IT runner, batch runner |
| `harness/probe/` | Probes. `lib.mjs` is the shared client; `s1` test plan, `s2` faults, `s3` profiles, `s4` refusals, `s5` limits, `s6` durability, `s7` undo semantics, `s8` real model, `s11` core A/B, `s12` rollout order, `s13` public route |
| `harness/mut/` | Mutants and runners |
| `results/head-fbafd241/` | Probe logs on the PR head |
| `results/main-7827a3ff/` | Same probes on main |
| `results/candidate/` | Same probes on the PR head + candidate |
| `results/public-route/` | `POST /v1/agents/sessions` with a Workspace, three arms |
| `results/first-round-32dc814d/` | Probe logs of the first round |
| `results/gates/` | Fault-gate and unit-test summaries, CI failure excerpt of the first head |
| `results/mutation/` | Mutation logs |

Each probe log has one line per check (`PASS` / `FAIL` / `NOTE`) and ends with a `== RESULT` line.
