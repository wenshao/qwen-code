# Evidence assets for PR #11117 verification

Local verification of https://github.com/QwenLM/qwen-code/pull/11117
(`ci: make the Prettier lane a real gate`).

| File | Figure |
| --- | --- |
| `fig1-gate-ab.png` | The Prettier lane, before and after |
| `fig2-precommit-ab.png` | The commit hook, before and after |
| `fig3-matrix.png` | Verification matrix (12 axes) |
| `fig4-profile-hole.png` | The one hole the flip leaves open |

Environment: macOS 25.6 (Darwin 25.6.0), Node 24.18.1, prettier 3.6.1 (package-lock version).
Arms: `origin/main` 7567824d4c, merge-base 9c1c41a989, PR head c10ec57ca4, and the head x main merge tree.
