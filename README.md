# Assets — QwenLM/qwen-code PR #12265 verification

Evidence figures for the local verification report posted on
https://github.com/QwenLM/qwen-code/pull/12265

| File | What it shows |
| ---- | ------------- |
| `pr12265-fig1-partition-table.png` | §2.2's six-row partition table re-derived by executing the real `resolveDaemonMemoryBudget` + `createChildHeapPolicy` at the PR test-merge head, next to what a reader reproduces from §2.2's stated rule alone. |
| `pr12265-fig2-live-daemon.png` | A live `qwen serve` daemon built from the unpatched test-merge bundle: `GET /daemon/status` → `limits.memory`, and the real ACP child's command line from the OS process table. |
| `pr12265-fig3-heap-ab.png` | Child old-generation peak vs the 544 MiB candidate ceiling — the PR's four accepted candidate runs beside a local baseline/candidate A/B over 36 real-model turns. |
| `pr12265-fig4-checks.png` | The committed JSON summary's arithmetic and the EN/zh-CN parity checks, re-derived from scratch. |

Environment: macOS 15 arm64, 65,536 MiB, Node v24.18.1, real model provider.
Generated 2026-09-20.
