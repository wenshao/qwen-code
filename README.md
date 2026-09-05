# PR #11054 verification figures

Real-environment verification of `feat(web-shell): add headless global turn navigation`
(head `278edd08a2`, merge-base `bdbdc459dd`).

Produced by a real `qwen serve` daemon (300+ turn persisted session) driven from a real
headless Chromium page that mounts the PR's own `DaemonSessionProvider` and public hooks.

| file | what it shows |
| --- | --- |
| `fig0-real-webshell.png` | the real Web Shell served by the harness daemon on the seeded session |
| `fig1-bounded-random-access.png` | head page + first/middle/last ordinal navigation |
| `fig2-seam-and-provisional.png` | historical/live seam dedup + provisional prompt reconciliation |
| `fig3-failure-paths.png` | real 409 / 413 / rewind / capability-off arms |
| `fig4-findings.png` | the two issues found |
| `fig5-budgets.png` | eviction and memory budgets under real traffic |
| `fig6-r1-1-confirmed.png` | independent real-daemon confirmation of the review bot's CRITICAL R1-1 |
