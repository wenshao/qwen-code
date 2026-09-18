# PR #11251 — round 2 verification evidence

Head verified: `885e81e7822886d96df08ca9ebb48625c10042fe` (round 1 verified `c7c95e49`).
Platform: macOS (Darwin 25.6.0), Node 24.18.1. Driver: Playwright (round 1 used the Chrome extension).

| File | What it is |
| --- | --- |
| `fig-r2-a-mutations.png` | Round-2 mutation matrix: 23 mutations, 15 killed / 8 survived; M1 and M2 flipped to killed |
| `fig-r2-b-compression.png` | The third system-notice source the R11-1 fix cannot see, at unit level and against the real daemon |
| `fig-r2-c-repair.png` | What the new repair test pins: PROBE-A (marker removed) publishes, PROBE-B (test's own fixture) never does |
| `04-compress-real-ui.png` | Real UI: a `/compress` turn rendered as a system row, published to the host as the turn's assistant message |
| `05-split-view.png` | Real UI: Split View, one settlement per pane |
| `drive.mjs` | Playwright driver for the eight Reviewer-Test-Plan checks |
| `probe-compress.mjs` | The `/compress` probe against the real daemon |
| `mutate.mjs` | Round-2 mutation runner (adds M21–M23 on the new guard) |
| `repair-probe-a.tsx.txt`, `repair-probe-b.tsx.txt` | The two probes derived from the new repair test's own fixture |
| `mutation-matrix-round2.txt` | Full matrix output including the test names each mutant reddened |
| `e2e-playwright.txt` | The eight end-to-end checks with the payloads the host received |
| `compress-probe.txt` | Raw output of the `/compress` probe |
| `wire-round2.log` | Proxy ledger for the round-2 transport checks |

The round-1 rig (daemon command, isolated settings, fake model, SSE proxy, embedding host) is in the branch root and was reused unchanged except for ports.
