# PR #10983 — local verification assets

Head verified: `e10b9f5f82237a63e27ddc323333ac3ac55a64a7`
Merge base:    `69c4f1e4bb4f32a28db75f0bcde21c4f884e4d32`
Date: 2026-09-04 · Linux 6.12 / node v22.22.2 / bash 5.2.37 / npm 10.9.7

## Arms
| arm | tree |
|---|---|
| `main` | merge-base 69c4f1e |
| `naive` | merge-base + "refuse to strip when the command contains `$` or a backtick" |
| `PR` | PR head e10b9f5 |
| `allowlist-inverted` | PR head with `isUnstrippableEnvVar` inverted to an inert-name allowlist |

## Images
- `imgs/e2e-ab.png` — real TUI A/B, three scenarios (bundled `dist/cli.js` per arm, scripted OpenAI backend)
- `imgs/matrix.png` — real-bash differential, 26 shapes × 4 arms + trade-off table
- `imgs/deny-and-sweep.png` — deny-rule regression + 13,940-pair blast-radius sweep

## Evidence / reproduction
`evidence/*.mts` are the harness scripts; run with `npx tsx` from a worktree with node_modules linked
(`evidence/setup-links.sh <worktree> <donor>`), `SB=<sandbox dir>`.
