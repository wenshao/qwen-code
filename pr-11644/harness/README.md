# PR #11644 verification harness

Real `qwen serve` daemon + the daemon's own Web Shell in headless Chromium (Playwright), Linux, Node 22.

- **Tree**: PR head `144bc25a31`, built with `npm ci` (which runs the full build + bundle).
- **A/B**: one daemon binary; only the Web Shell client bundle differs.
  - `build-arms.sh` saves the PR bundle as `ws-pr`.
  - It then reverts the PR's changed files under `packages/web-shell` and `packages/sdk-typescript` to the merge base `00d86315c8`, rebuilds the SDK dist + `vite build` → `ws-base`, and restores.
  - A PR rebuild after the restore is byte-identical to `ws-pr` (index.html md5 + asset names).
- **Workspaces** (`setup.sh`): three trusted git repos bound with `--workspace` ×3.
  - `alpha-app` is the primary/active workspace: 3 modified, 2 stashed.
  - `beta-lib`: 1 modified.
  - `gamma-docs`: clean.
  - Each repo has a project skill `release-notes`.
- **Wire oracle** (`ui.mjs`): `page.on('request')` records every browser→daemon request and classifies it:
  - overview facets `/workspaces/<cwd>/{mcp,skills,extensions,channels,memory}`
  - `/git` and `/git?wait=1`
  - `/workspace/providers`, `/capabilities`, `/live/setup`
  - Sidebar Git accounting uses `beta-lib` (not the active workspace), so the chat composer's own poll of the active workspace cannot leak in.
- **Mock model** (`mock-openai.mjs`): OpenAI-compatible SSE; logs image parts and a run marker per request.

| script | what it measures |
| --- | --- |
| `s1-idle.mjs` | 95 s idle, 3 expanded workspaces: facet / Git / providers / capabilities reads |
| `s2-hover.mjs` | idle 35 s → details popover open 33 s → closed 67 s + focus event |
| `s3-menu.mjs` | workspace actions menu open 62 s → closed 67 s + focus; menu items at first paint |
| `s4-settings.mjs` | providers reads at startup, per Settings opening, while closed |
| `s5-skills.mjs` | composer Skills catalog reads: idle, ordinary typing, first `/`, second `/` |
| `s7-preflight.mjs <sdk>` | SDK: `/capabilities` vs source-filtered list requests (PR dist vs `build-base-sdk.mjs` bundle) |
| `s8-attach.mjs` | draft chat: image + `/release-notes …` submitted without browsing suggestions |
| `s9-stale.mjs` | hover Git summary after the repo changes while the popover is closed |
| `s10-chatgit.mjs` | after a real turn: active-workspace Git reads with the environment card closed vs open |

Run: `./setup.sh && node mock-openai.mjs & ./build-arms.sh && ./run-arm.sh pr && ./run-arm.sh base`.
