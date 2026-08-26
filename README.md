# PR #10042 — local real-environment verification evidence

Verified on macOS 15 (Darwin 25.6.0), node v24.18.1, OpenSSL 3.6.3, against PR
head `3f956bc` built from source (`npm ci && npm run build && npm run bundle`).

## What was run

A real `qwen serve` daemon, serving TLS from a renewed-CA bundle, with a real
daemon-managed channel worker attached, so the boot-time worker TLS trust
diagnostic (`describeWorkerTlsTrustGaps` → `walkWorkerAnchorPath`) ran for real
and its verdict could be compared against the handshake a channel worker
actually performs.

Two arms, same tree:

- **head** — PR head as-is.
- **base** — the same tree with a single hunk reverted: the greedy
  `chain.find(...)` restored at the issuer-selection site
  (`repro/revert-to-base.py`). Nothing else differs.

## Files

| Path | What it is |
| ---- | ---------- |
| `pr10042-ab.png` | Screenshot: real daemon boot log, base vs head, same serving bundle |
| `pr10042-matrix.png` | Screenshot: full evidence matrix + unit-suite / control-arm results |
| `logs/<arm>-<case>.txt` | Raw daemon stderr for each run |
| `logs/<arm>-<case>.race.json` | The worker-shape TLS handshake result captured against that live daemon |
| `logs/vitest-head.log` | `run-qwen-serve.test.ts` on macOS, PR head |
| `logs/vitest-mutant.log` | Same suite with the greedy walk restored |
| `repro/mkcerts.sh` | Builds the renewed-CA fixtures (two self-signed roots sharing subject **and** key) |
| `repro/run-case.sh` | Boots one daemon + fake GitHub channel and races a handshake against it |
| `repro/probe.mjs` | The daemon's own `WORKER_TLS_TRUST_PROBE`, verbatim, run standalone |
| `repro/fake-github.mjs` | Minimal `api.github.com` stand-in so a real channel worker stays connected |
| `repro/demo-ab.sh`, `repro/matrix-report.sh` | What the two screenshots render |
| `repro/pr10042-ab.ts` | terminal-capture scenario used for the screenshots |
| `certs/*.pem` | The generated fixtures (public certificates only; private keys withheld) |

## Cases

| Bundle (order as written in the PEM) | Purpose |
| ------------------------------------ | ------- |
| A `leaf-ok + EXPIRED root + renewed root` | the healthy renewed-CA configuration |
| B `leaf-badSAN + EXPIRED root + renewed root` | a real defect present, so the diagnostic prints |
| E `leaf-badSAN + renewed root + EXPIRED root` | same certificates as B, opposite order |
| F `leaf-badSAN + FUTURE root + renewed root` | the not-yet-valid direction |
| C `leaf-ok + EXPIRED root only` | true positive — must still be reported |
| G `leaf-ok + EXPIRED CA:TRUE root + valid CA:FALSE root` | the edge review called theoretical |
