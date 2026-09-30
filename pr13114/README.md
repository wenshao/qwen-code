# PR #13114 verification assets

Rig for the real-stack runs behind the PR comment. It extends the #12894 rig:

- MySQL 8.4.7 (native), the Spring server jar built from each arm, the packaged Hosted Harness (`dist/cli.js`), real local-process workers running a real Shell command (`gen.mjs` writes deterministic stdout/stderr).
- `fake-oss.mjs`: TLS double of Aliyun OSS used by the real `aliyun-sdk-oss`. New here: `POST /throttle {"getBps":N}` streams object GET bodies at N bytes/s.
- `fault-proxy.mjs`: in front of the publication ingress and Session Store. `arm-oss` arms an object-store fault when a named publication request passes. New here: `corrupt-body` (flip byte 0 of the forwarded body) and `rewrite-op` (append `x` to the operation id header), used for F12/F13.
- `tcp-forward.mjs` + `realoss-hosts`: real Aliyun OSS runs. The JVM resolves the bucket host to 127.0.0.1 and the forwarder relays the TLS bytes unchanged, holding one chunk when armed. The temporary private bucket was deleted after the run.
- `s3-faults.ts`: one scenario (create a Hosted Workspace Session, fake model asks for the Shell command, report turn outcome, proxy ledger, catalog, operation windows, and an independent byte check of both streams against the generator).

Arms (see the `## arm=` line in each log):

| Label in logs | Server jar | Harness + worker |
| --- | --- | --- |
| `base` | 3b18cfe5 (main with #12894) | 3b18cfe5 |
| `head` | 0cc562d4 (PR head before the rebase) | 0cc562d4 |
| `new` | dfe3c2ef (current PR head) | dfe3c2ef |
| `mixed` | 0cc562d4 | 3b18cfe5 |
| `j4` | 0cc562d4 source with mutant J4 (recovery window = base timeout) | 0cc562d4 |

Runners: `r13114.sh` (groups F, S, X, T, M), `r13114b.sh` (R = T4, L = T5), `ro13114.sh` (real OSS), `cfg.sh` (startup budget), `mut.mjs` (mutants), `candidate-t7-test.diff` (candidate producer test).

Notes:

- `results/r13114-head-X.log` also contains a T4 run: I appended the R group to `r13114.sh` while that invocation was still running, and bash continued into the new text. The T4 lines there match the separate `r13114b-head-R.log` run. Later runs used an unmodified script.
- `results/replay-headf4.log`: direct replays of the captured F4 requests after the Session was blocked. Every call is refused at authorization (`Publication grant conflicts`), so deterministic-refusal precedence was tested in flight instead (F12/F13).
