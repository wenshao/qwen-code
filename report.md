# Deep verification: PR #8594 — fall back to system browser when built-in browser fails

**Verdict: ✅ merge-ready** — 94/94 scripted assertions passed, 0 unexpected failures.
Verified head: `b431c762919047293392391d29c763b2d24a143c` against base `63a8ed4338f894f97970afda3cad3084f8206d91`.
Local maintainer verification round (not the CI lane): two scratch worktrees, real `bun install`, real test/typecheck/eslint runs, A/B harnesses on both arms.

<details>
<summary>中文摘要</summary>

**结论：可以合并（merge-ready）** — 94/94 条脚本断言全部通过，无意外失败。

**A/B 核心结论**（base = 逐字复制的旧版 App.tsx 内联代码；head = PR 抽取的新模块）：

- **Issue #8593 的死点击在 base 上复现、在 head 上修复**：当 `create()` 成功后 `navigate()` 或 `focus()` 失败时，base 仅 `console.warn` 后静默返回（用户点击无任何反应），head 回退到系统浏览器（见证据图 01）。
- **主进程 URL 归一化对齐 + 两处顺带修复**（见证据图 02）：
  - base 中 `example.com?q=1`、`localhost:3000#docs` 这类带 query/fragment 的裸域名在渲染进程判定为"内置浏览器"，主进程却当成搜索词——两个进程判定不一致；head 两侧一致，直接加载 `https://…`。
  - base 对非法 host（如端口 70000 超限）会把**完整输入**（含 `?token=SECRET` 这类查询串）发给 DuckDuckGo——查询串泄漏；head 只搜索 host 部分，token 不出本机。
  - base 对含孤立 surrogate 的搜索词直接 `encodeURIComponent` 抛 URIError——navigate 拒绝 → 渲染进程吞掉 → 死点击（这是 #8593 的一个具体触发路径）；head 用 `toWellFormed()` 替换为 U+FFFD 后正常搜索。
- **突变矩阵 6/6 全部被杀**（证据图 03）：PR 引入的每个守卫（catch 回退、通道预检、scheme 分类、`new URL` 校验、`toWellFormed`、host-only 搜索）都有自己的测试钉住，无存活突变；阳性对照（M2）证明 harness 确实能让套件变红。
- **门禁**（证据图 04）：renderer 新测试文件 15/15 通过；主进程测试文件 base 60p/8f → head 64p/8f（+4 通过、+0 失败，8 个失败为环境性既有问题，两侧名单逐字节一致）；`tsc --noEmit` 两侧各 12 个既有错误、错误集完全相同；eslint 两侧各 5 个既有错误、完全相同；两个门禁的错误均不涉及本 PR 触及的文件。
- **对 PR 描述的三处更正**（均为描述漂移，非代码问题）：① 描述称失败时会"hide 半开面板"，但代码并不调用 `hide()`，且测试显式断言不调用（固定 ID 复用面板，不 hide 反而是对的）；② 描述称新增 6 个测试，实际 15 个用例（含 `it.each` 展开）；③ 描述称 `tsc` 10 个既有错误、eslint 0 错误，实际在当前 base 上是 12 个 tsc 错误和 5 个 eslint 错误——但两侧完全相同、零新增，且均不在本 PR 文件中。
- **未覆盖**：真实 Electron GUI 端到端（harness 用 PR 自己的 electron mock 驱动真实模块）；`shell.openExternal` 的真实 OS 行为；带 scheme URL 路径中孤立 surrogate 的 Chromium 侧表现（与 base 行为一致，无差异）；desktop 全量测试套件（按范围只跑了触及的文件）。

</details>

## Central claim and A/B proof

**Claim under test**: when any step of opening a link in the docked built-in browser fails (`create` / `navigate` / `focus`), or the browser-pane channel is unavailable, the renderer now falls back to the system browser. On base, a failure *after* a successful `create()` was logged and swallowed — the issue #8593 "styled but dead click".

**Control construction**: base has no importable module — the logic was inline in `App.tsx`. The base arm is that inline body copied **verbatim** into a harness module (`verify-impl-base.ts`), with exactly three harness seams: `window.electronAPI?.browserPane` → parameter, `handleOpenUrlExternal` → parameter, and the fire-and-forget `void open()` is awaited so the harness can observe completion. Classification regexes and control flow byte-identical. The head arm imports the real `open-url-in-built-in-browser.ts`. Both run under `bun` in their own worktree against a fake `browserPaneApi` that records every call; `openExternal` records every argument. The fake encodes the real failure semantics (`Navigation timed out after 30s`, `no handler for browser-pane:create`).

### Renderer A/B — 12 scenarios × both arms (58 assertions, all as predicted)

| scenario | base `63a8ed4` | head `b431c76` |
| --- | --- | --- |
| happy `https://…` | built-in (create→navigate→focus) | identical |
| `create` rejects (no pane handlers) | falls back, raw url | falls back, **normalized** url |
| **`navigate` rejects after create (#8593 shape)** | **nothing happens — dead click** | **falls back: `openExternal("https://example.com")`** |
| **`focus` rejects after navigate** | **nothing happens — dead click** | **falls back** |
| bare host + query `example.com?q=1` | built-in, navigate raw | identical |
| `localhost:3000#docs` | external, **raw scheme-less** string | built-in (classification aligned) |
| `  MAILTO:…  ` (spaces) | external, **untrimmed** | external, trimmed |
| pane API missing, `localhost:3000/docs` | external, **raw** | external, `https://localhost:3000/docs` |
| channel unavailable `127.0.0.1:3000/docs` | (no probe exists) create attempted → rejects → fallback | **0 create calls**, pre-check logs + fallback |
| invalid host `192.168.1.1:70000?token=SECRET` | built-in, navigate raw | identical (main process handles it — below) |
| navigate fails on `example.com?q=1` | dead click | falls back with **`https://example.com?q=1` (query preserved)** |
| lone-surrogate text `search \ud800 term`, API missing | external, raw string with surrogate | external, DDG search with U+FFFD |

The flip cells are the load-bearing proof: **3 scenarios go from "silent no-op" to "system browser opens"**, and every other cell is either identical or strictly better-formed (trimmed / scheme-normalized). Witness: `01-renderer-ab-dead-click-flip.png`.

### Main-process `navigate()` A/B — 12-input matrix through the real `BrowserPaneManager`

Drove the compiled-equivalent source of `browser-pane-manager.ts` on both arms (electron/logger/browser-cdp mocked with the PR's own test mock block, copied verbatim; the unit under test is real). Oracle: the exact string handed to `webContents.loadURL`, plus rejection shape. 26 assertions, all as predicted. Witness: `02-main-navigate-matrix-ab.png`.

| input | base hands Chromium | head hands Chromium |
| --- | --- | --- |
| `example.com?q=1` | `https://duckduckgo.com/?q=example.com%3Fq%3D1` (search!) | `https://example.com?q=1` |
| `localhost:3000#docs` | DDG search of the whole string | `https://localhost:3000#docs` |
| `192.168.1.1:70000?token=SECRET` | DDG search of **the whole string — token leaked** | DDG search of **host only** (`192.168.1.1%3A70000`) |
| `256.1.1.1:8080` / `localhost:70000` | invalid `https://` URL passed to Chromium | DDG host-only search |
| `search \ud800 term` | **`navigate()` rejects with `URIError`** → base renderer swallows → dead click | DDG search with U+FFFD |
| `qwen code docs`, `about:blank`, `10.0.0.1`, `mailto:…`, `https://…`, `example.com/docs` | identical on both arms | identical on both arms |

Three things this table proves beyond the central claim:

1. **Renderer↔main misalignment existed on base and is fixed**: base's renderer classified `example.com?q=1` as built-in-worthy while base's main process DDG-searched it — clicking such a link opened the pane with a *search for the URL* instead of the site. Both processes now share the same host pattern (`(?:[/?#]|$)`).
2. **A privacy leak is closed**: on base, any query string riding on an invalid host-like input (port > 65535, octet > 255) was sent to the search provider verbatim. Head searches only the host part. (The secret-probe assertion is encoded per-arm: leak expected on base, absent on head — both observed.)
3. **One concrete #8593 trigger is gone end-to-end**: a lone surrogate in free text made base's `encodeURIComponent` throw inside `navigate()`; that rejection landed exactly in the renderer's swallow branch. Head replaces the surrogates and searches normally.

### Mutation / vacuity matrix — every new guard is pinned (witness: `03-mutation-matrix.png`)

Six single-point mutations applied to the PR's production code in a scratch copy, each followed by the PR's own test file(s); pristine state restored and verified (`RESTORE-OK`) after each:

| mutation | suite result | killed by (attribution) |
| --- | --- | --- |
| M1: catch swallows again (base behavior restored) | 4 fail | exactly the 4 fallback tests |
| M2: **positive control** — built-in classifier always true | 1 fail | the `mailto:` routing test |
| M3: drop `toWellFormed()` | 1 fail | the lone-surrogate fallback test (URIError) |
| M4: drop `new URL` validation of host candidates | 3 fail | the 3 `it.each` invalid-host cases |
| M5: main host-pattern back to `(?:\/|$)` | 3 new fails* | the 2 alignment tests + invalid-host test |
| M6: main searches full input on invalid host | 1 new fail* | the host-only-search test (token leak returns) |

\* M5/M6 rows also contain the 8 pre-existing environment failures (present on both arms, unrelated to `navigate`); the counts shown net them out. No survivor mutations; M2 proves the harness can turn the suite red at all.

### Gates on the affected workspace (witness: `04-gates-summary.png`)

- `bun test` renderer `open-url-in-built-in-browser.test.ts` (new file): **15 pass / 0 fail**.
- `bun test` main `browser-pane-manager.test.ts`: base **60 pass / 8 fail** (68 tests) → head **64 pass / 8 fail** (72 tests) — **+4 passing, +0 failing**; the 8 failing test *names* are byte-identical on both arms (focus/toolbar/popup timing tests, none touch `navigate`).
- `tsc --noEmit` (apps/electron): 12 pre-existing errors on base, **identical set of 12** on head; none in files this PR touches.
- `eslint src/`: 5 pre-existing errors on base, **identical set** on head; none in touched files. (Both linters proven live by the pre-existing failures they caught.)

## Corrections to the PR description (description drift, not code problems)

1. **"hide the half-opened pane"** — the code never calls `hide()`, and the new tests explicitly assert it is *not* called (`falls back without hiding a reused pane…`). Since the pane is a fixed-ID reused docked instance, *not* hiding is the defensible behavior (hiding could close a pane showing unrelated content). The description's "Changes §1" predates this decision.
2. **"Adds 6 unit tests"** — the new file has 15 test cases (12 named + 3 `it.each` expansions); plus 4 new main-process tests. More coverage than described.
3. **"tsc — 10 pre-existing errors … eslint — 0 errors"** — at the current base the counts are 12 tsc errors and 5 eslint errors. What matters holds: zero *new* issues on both gates, byte-identical error sets, none in touched files.

## Boundary observations (no action needed)

Probed inputs outside the reported shape against the head module: `''` / `'   '` → built-in path → DDG empty search (same as base); `javascript:alert(1)` → external passthrough (same as base; scheme policy lives in `shell.openExternal`); `HTTPS://EXAMPLE.COM/UP` → built-in (same as base); `https://example.com/\ud800` → passed to Chromium with the surrogate intact (same as base — the `toWellFormed` guard covers the *search* branches only). None of these paths changed behavior versus base.

One accepted tradeoff worth naming: when `navigate()` **succeeds** but `focus()` fails, the page is already loaded in the docked pane *and* the fallback opens the system browser — the user can end up with two copies. Focus-level IPC failures imply the pane is not reliably visible, so falling back is still the right default; noting it because the description does not.

## Not covered

- **Real Electron GUI end-to-end** — harnesses drive the real modules under `bun` with the PR's own electron mocks; an actual desktop-app click was not performed. `shell.openExternal`'s real OS behavior (including how it treats scheme-less strings, which base used to send) was not exercised.
- The 8 pre-existing test failures / 12 tsc errors / 5 eslint errors are environmental/pre-existing (identical on both arms) and were not root-caused — they predate this PR.
- Full desktop `bun test` suite was not run; scope was the two touched test files plus targeted gates.
- Per-commit attribution across the 9 commits was not done; the aggregate base→head diff was verified as one unit.
- Evidence images are rasterized terminal captures of the live harness runs, not GUI screenshots.

## Methodology

macOS arm64, node v22.22.2, bun 1.3.14. Two scratch git worktrees: `tmp/pr8594-head` @ `b431c76`, `tmp/pr8594-base` @ `63a8ed4` (the resolved `baseRefOid`, not a parent guess). One `bun install --frozen-lockfile --ignore-scripts` in the head tree's `packages/desktop`, APFS-cloned to base — a clean control because the PR touches neither `bun.lock` nor any `package.json` (verified via `git diff --stat`), and internal workspace links were proven tree-local: `readlink -f node_modules/@craft-agent/shared` resolves to `../../packages/shared` **inside each respective tree** on both arms. Harnesses are mock-free with respect to the units under test: the renderer arm imports the real extracted module (head) or a verbatim copy of the base inline code (control), and the main arm imports the real `BrowserPaneManager` with only the electron environment mocked (mock block copied verbatim from the PR's own test file). Every number above comes from a scripted assertion that executed; harness sources and raw logs are in `tmp/pr8594-verify-20260807-235838/` (`harness/`, `logs-*`, `typecheck-*.txt`, `eslint-*-errors.txt`, `fail-names-*.txt`).
