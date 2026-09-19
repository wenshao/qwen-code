# PR #12067 verification assets

Evidence images for the local verification of
[QwenLM/qwen-code#12067](https://github.com/QwenLM/qwen-code/pull/12067)
(`feat(core): Add the bwrap execution foundation`), head `25c6bf296ee71cfe88100c0c810d7b9f28ba1c63`.

Captured on real Linux x86_64 (kernel 6.12.63, bubblewrap 0.11.0, Node v22.22.2)
with working unprivileged bubblewrap.

| image | what it shows |
| --- | --- |
| `imgs/01-verifier-x64-ab.png` | `scripts/sandbox-prototype/verify.mjs` on real bwrap: 34/34 on `72ec6d50`, 33/34 on the PR tip, both as uid 0 and uid 65534 |
| `imgs/02-retention-leak.png` | root cause of the 33/34, quantified temp-directory leak, single-hunk causal mutation |
| `imgs/03-fix-ab.png` | 3-arm A/B/C proving the settle-wedge fix and the EPIPE fix, plus the mutation matrix |
| `imgs/04-packaging-gates.png` | packaging chain of custody through a real `npm pack`, gate results, abort-window measurement |

## Round 2 — head `8c270290abbce9dc2aa935c3b1d48ca9b2499181`

| image | what it shows |
| --- | --- |
| `imgs/05-round2-verifier-leak.png` | the round-1 leak is fixed; the verifier is still 33/34 on a different, stale assertion |
| `imgs/06-retention-matrix.png` | retention decision matrix from a real relay + real finalizer with a stand-in bwrap, and the measured fix |

## Round 3 — head `cb79dc40d54f39b3257dee7e5c1cfb47c888662c` (aarch64, kernel 6.6.89-cix, bubblewrap 0.8.0, Node v24.14.0)

| image | what it shows |
| --- | --- |
| `imgs/07-aarch64-01-ab-stream-settle.png` | streamStdout A/B: base settles at exit and loses trailing output; head keeps it and the 1s drain fence prevents the grandchild wedge |
| `imgs/07-aarch64-02-bwrap-verifier.png` | standalone verifier 34/36 on head; both reds attributed to this host (no CONFIG_PROC_CHILDREN; bwrap 0.8.0 namespace teardown) |
| `imgs/07-aarch64-03-structured-launch.png` | structured launch harness: literal argv, exact env, binary stdin round-trip, validation rejections |
