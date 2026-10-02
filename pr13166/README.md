# PR #13166 real-stack verification (head b2a28c4f)

Rig: macOS arm64, MySQL 8.4.7, Spring server jar built from the PR head (Java is identical to main
b3dda468), embedded Runtime Broker launching local Runtime workers from the packaged bundle, and the
packaged Hosted Harness (`qwen serve --profile hosted-harness`). Workspace Sessions are created through
the public `/v1/agents/sessions` API; the Harness `/session` route is driven directly with an explicit
`toolProfile` because the Spring connector still pins `hosted-workspace-files/1` (by design of the PR).
Scripted OpenAI-compatible model for deterministic scenarios; qwen3.8-max for S8.

Arms: `main` = b3dda468, `head` = b2a28c4f, `cand` = head + `candidate.patch`.
Databases: g1 head worker, g2 main worker (S3 main arm, S7 rollout skew), g3 head worker (S9),
g4 candidate worker, g5 head worker (clean S2 rerun, S10).

| Script | What |
| --- | --- |
| s1-profiles | declarations per profile, pinning across detach/load, unadvertised glob in a /1 Session |
| s2-glob | containment, sibling isolation, pre-acquisition refusals, output containment, relativization, wire + DB scan |
| s3-symlink | in-Session link to the sibling Session: glob, read/write/edit through it (head, main, cand) |
| s4-truncate | 100 paths x 827 B -> 83 KB result vs the 64 KiB inline limit |
| s5-approval | default / auto-edit: glob pre-approved, write_file control |
| s6-shell2, s6b | shell/2 through the route; captureBytes control (rig has no OSS publication backend) |
| s7-mixed, s7b | head Harness + main Runtime worker; aftermath in the same Workspace |
| s8-real-model | same task in files/2, files/1 and a monorepo Session holding an outward link |
| s9-continue | coordinator takeover + `/managed-runtime/continue` of a /2 Turn (files/2, shell/2, read control) |
| s10-gitignore | Workspace-root vs Session .gitignore |
| mutate.mjs | 27 anchored mutants; `mutation/` has the ledger and every run (ANSI stripped) |

Notes: `logs/g4/s2-glob-cand.log` was run before the transcript check was narrowed to tool results, so its
one FAIL is the `abspath` case's own call argument (the model put the host path into its call); the clean
head rerun is `logs/g5/s2-glob-head.log` (20/20). `rig.env` has the rig-only credential key redacted.
