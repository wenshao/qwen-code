**Verdict: merge-ready** — 28 executed assertions, 28 passed, 0 failed, at head `4ece4fa7241f7b7a647979e56d0f442f6ed57d64`. The central claim holds at this head on a fresh live A/B: under the same real host load the head refuses fresh-child creation with `503 system_overloaded` + `Retry-After: 15` and its own real readings, while the base admits the identical request with `200`. The carried-forward S1 is now **fixed and measured load-bearing**; S2's author decline **stands** on a re-derived reachability proof.

<details>
<summary>中文摘要</summary>

**结论：merge-ready**（28 项已执行断言，28 通过，0 失败，head `4ece4fa7`）。

**A/B 结论**（见下方 A/B 表及图 `01-live-ab-and-gap.png`）：同一真实主机负荷口径下（harness 自读 `/proc/loadavg`，比率 2.055），head 对 `POST /standalone/sessions` 返回 `503` + `code: system_overloaded` + `Retry-After: 15` + 真实读数（`loadRatio 2.124`、`eventLoopLagP99Ms 23.97`）；base 在同一负荷（比率 2.127）下返回 `200` 并创建会话。过载期间 warm 会话 prompt `202`、cancel `204` 不被拦；`--no-load-admission` 下 `enabled:false` 且创建 `200`；负荷回落到 0.958 后 `overloaded:false`，此前被拒的 caller UUID 复用成功 `200`。

**上轮发现状态：** S1（lag 阈值未被字面量钉住）→ **fixed**，本轮变异 M1 在同一 head 上被精确杀死（29 通过 / 1 失败 / 共 30，唯一红项就是新增的 `uses the documented one-second lag enter boundary`）。S2（重建路径 dispose 未被钉住）→ 作者 declined，我独立复核认为**同意**：两处 `buildRuntime` 调用点互斥，且 `runtimeStarting` 置位后不再复位，该项为防御性死代码，无法在不臆造入口的前提下被钉住。

**新增覆盖（前几轮均列为未覆盖）：** observation-gap 在线路径首次实机驱动 —— 对 daemon 实施真实 8 s `SIGSTOP` 后，创建返回 `503 reason: observation_gap` + `Retry-After: 15`，闩锁于 +14.3 s 释放，随后创建 `200`（8/8 断言通过）。

**留作 Suggestion（非阻塞，且与既有 review 延后项一致）：** `observation_gap` 的 status 文案写作 "System overloaded (observation_gap) … (load ratio 1.26, event-loop p99 27 ms)"，两个数字都是停摆前的旧读数，正是闩锁存在所要否认的东西。

**未覆盖：** 两份被改夹具的集成套件、全仓 typecheck、其余四个阈值常量的变异（M2 已启动但未在本轮预算内跑完）、branch/worktree 与定时任务的在线路径、多 workspace、macOS/Windows。

</details>

## Central claim and A/B

The PR gates **fresh child allocation** on sustained host load: three consecutive 2 s samples at `load1 / cores >= 2.0` (or event-loop p99 `>= 1000 ms`) latch overload; fresh spawns then return REST `503 system_overloaded` with `Retry-After: 15`; live sessions and the control plane stay usable; the gate releases after three samples below its exit thresholds; `--no-load-admission` disables it. The harness reads `/proc/loadavg` and `os.cpus().length` itself and requires **its own** ratio before probing, so neither arm is judged by the PR's status field.

| Cell | Head `4ece4fa7` | Base `7862c3ee` |
| --- | --- | --- |
| Build under test | repo's own `npm run bundle` (`node esbuild.config.js`) from source, `dist/cli.js` 18,417 B | same command from the base tree, `dist/cli.js` 18,397 B |
| Status while healthy | `runtime.loadAdmission`: `enabled: true`, `overloaded: false`, `sampledAtMs: 1795514977677` | no `loadAdmission` section (asserted absent) |
| Plain `POST /standalone/sessions` while healthy | `200` | `200` |
| Harness's own load oracle | `load1/12 = 2.055` | `load1/12 = 2.127` |
| **`POST /standalone/sessions` under load** | **`503`** | **`200`**, session created |
| Refusal wire contract | `code: system_overloaded`, `reason: cpu_load`, `Retry-After: 15`, `loadRatio: 2.124`, `eventLoopLagP99Ms: 23.97` | not applicable |
| Status while overloaded | `200`, `overloaded: true`, `issues[]` carries `system_overloaded` (severity `warning`) | not applicable |
| Warm session prompt under load | `202`, not gated | not driven |
| Warm session cancel under load | `204`, not gated | not driven |
| `--no-load-admission` under the same load | `enabled: false`, `overloaded: false`, create `200` | flag absent from the base CLI |
| Recovery | own ratio fell to `0.958` → `overloaded: false`; the refused caller UUID reused with `200` | not applicable |
| Assertions | **15 / 15** | **4 / 4** |

![Live A/B and the observation-gap probe: every cell as it printed](evidence/01-live-ab-and-gap.png)

## Carried-forward findings

| # | Finding | Severity | Status at `4ece4fa7` | Evidence |
| --- | --- | --- | --- | --- |
| S1 | the documented 1000 ms event-loop-lag threshold was not pinned to a literal | Suggestion | **fixed** | Mutation M1 (`EVENT_LOOP_LAG_ENTER_MS = 1_000` → `10_000`) applied to this head and run against both owning suites: **29 passed / 1 failed / 30 total**, and the single red is exactly `createLoadAdmissionMonitor uses the documented one-second lag enter boundary`. The new test drives literal `999` / `1000` inputs, so the constant cannot be retuned without a red test. Source restored; `git status --porcelain` clean. |
| S2 | the rebuild-path monitor `dispose()` is not pinned | Suggestion | **declined by author — I agree** | Re-derived independently: `buildRuntime` has two reachable call sites and they are mutually exclusive. The eager one (`run-qwen-serve.ts:9707`) only runs when `deps.bridge` is set, and the monitor is created only when `deps.bridge === undefined`, so the prior monitor is always `undefined` there. The lazy one is guarded by `runtimeStarting`, which is set once and never reset. A second `buildRuntime` cannot occur, so the `dispose()` at `run-qwen-serve.ts:6083` is **redundant defence** today — correct as written, unpinnable without inventing an entry point. |

## New coverage this round: the observation-gap latch, driven live

No previous round drove the gap latch through a real daemon (it was listed under _Not covered_ three times). This round drives it with a real process stall and no injected readings: the daemon is `SIGSTOP`ped for **8,001 ms** while the host is otherwise quiet, then resumed.

| Cell | Result |
| --- | --- |
| healthy precondition before the stall | `overloaded: false`, create `200` |
| create immediately after resume | **`503`** |
| refusal reason | `code: system_overloaded`, `reason: observation_gap`, `Retry-After: 15` |
| status at that moment | `overloaded: true`, `reason: observation_gap`, `loadRatio: 1.261`, `eventLoopLagP99Ms: 27.13` |
| latch release | `overloaded: false` at **+14,318 ms** |
| create after release | `200` |
| Assertions | **8 / 8** |

This is the commit-`8778150f9a` fix (`fix(cli): close load-admission observation gap`) working end to end: a stalled event loop is not read as healthy, and the refusal carries the retryable contract.

![S1 mutant killed at this head, and the observation-gap probe cells](evidence/02-s1-mutation-and-gap-probe.png)

## Findings

### Suggestion — the `observation_gap` rollup quotes the readings the latch exists to distrust

Measured, not inferred. The live probe produced this exact status text on a host whose load had already stopped:

```
System overloaded (observation_gap); new sessions are paused until load subsides
(load ratio 1.26, event-loop p99 27 ms).
```

`loadRatio 1.26` is a decaying 1-minute `loadavg` average from load that had already been released, and the p99 is the last pre-stall window — both are precisely the numbers the latch declares untrustworthy. A reader sees "System overloaded … until load subsides" with two quiet-looking figures and cannot tell what is actually wrong. The `reason: observation_gap` field is correct and machine-readable; only the human rollup sentence misleads. This **confirms deferred review finding** `packages/cli/src/serve/daemon-status.ts:930` with a live reading rather than a code read; it is a Suggestion and non-blocking.

Reproduce: `ARM_DIR=<head> node harness/observation-gap.mjs` — the `gap:issue-message-quotes-idle-load` cell records the message verbatim.

### Not re-measured — the other five shipped thresholds

`LOAD_RATIO_ENTER`, `LOAD_RATIO_EXIT`, `EVENT_LOOP_LAG_EXIT_MS`, `LOAD_ADMISSION_SAMPLE_MS` and `LOAD_ADMISSION_SUSTAIN_SAMPLES` are still built into the tests through the exported constants. The deferred review item at `load-admission.test.ts:14` (the constants import block) makes the same claim. I started mutation M2 (`LOAD_RATIO_ENTER = 2.0` → `20.0`) at this head but the owning suite had not finished when the round's budget ran out, so **it has no verdict and is reported as unmeasured**, not as a survivor. `LOAD_ADMISSION_SUSTAIN_SAMPLES` is separately known pinned (prior round: killed 22/3; same closure, below). What would close this: one literal-boundary case per constant, the way S1 was closed.

## Delta since the previously verified head

The previous report verified `c2284fe06a1d0fcdff7451dfde1b7e447626aecc`. The current head is `4ece4fa724…`. Of this PR's 44 files, exactly four changed in that interval, and **none is a production source**:

- `integration-tests/cli/qwen-serve-feedback.test.ts` (+7/−4) — adds `--no-load-admission` to the fixture's daemon argv and pins the observer's runtime base dir with `Storage.runWithResolvedRuntimeBaseDir`, so an inherited `QWEN_RUNTIME_DIR` cannot redirect it to the host profile;
- `integration-tests/cli/daemon-workflow-ancestor-trust.test.ts` (+7/−1) — adds `--no-load-admission`;
- `packages/acp-bridge/src/bridge.test.ts` (+259/−0) and `docs/developers/qwen-serve-protocol.md` (+1/−1) — both from the `origin/main` merge (the doc hunk is about moved background shell commands, unrelated to this feature).

Neither opted-out fixture contains an admission assertion (`overload` / `loadAdmission` / `503` grep count 0 across their 7 and 3 `it(...)` cases), so the opt-out silences no coverage of its own — the same check the previous round applied to `qwen-serve-routes.test.ts`. Production remains default-on: `--load-admission` is declared with `default: true` (`packages/cli/src/commands/serve.ts:422`).

The PR's production files are byte-identical to the previously verified head, which is why the S1 measurement below carries on a proven-identical input closure rather than on a promise.

## Corrections

**Harness correction, disclosed, not a PR defect.** The first pass of both harnesses sent non-UUID `sessionId` values (`healthy-head-1`, …). `POST /standalone/sessions` requires an RFC UUID v1–v5 (`routes/standalone-sessions.ts:319`) and answered `400 invalid_request` in both arms, which made four create cells and two control-plane cells red for a reason that has nothing to do with the PR. The cells were re-measured with `randomUUID()` ids; the `400` observations are not counted anywhere. The same first pass read `sampledAtMs: 0` because it read the status 2.5 s after boot, before the first 2 s tick — the re-run waits 4 s and reads a real timestamp.

## Not covered

- **The two changed fixture suites** (`qwen-serve-feedback.test.ts`, `daemon-workflow-ancestor-trust.test.ts`) were not executed. I confirmed by census that neither asserts admission behaviour, but I did not verify the new `runWithResolvedRuntimeBaseDir` pin makes them pass on this head. The author reports 2 files / 10 tests green.
- **Repo-wide `npm run typecheck` and the workspace test suites.** Each arm was installed with `node scripts/setup-worktree.js` (pnpm, frozen lockfile); the head arm then ran `npm run build:packages` (10 m 8 s) and both arms bundled through the repo's own `esbuild.config.js`. The base arm received every package `dist` whose sources are byte-identical and built `packages/acp-bridge` from **base** sources (verified: `dist/bridgeErrors.js` differs between arms, as the PR changes that file).
- **Mutation M2–M8.** Only M1 completed (see above); the rest were stopped and the mutated source restored.
- **Live branch/worktree, scheduled-task and resume paths.** Unit/integration-tested by the PR, not driven here.
- **Multi-workspace runtime, macOS/Windows `loadavg` semantics, cgroup-quota calibration.**
- **Per-commit attribution** beyond the four-file delta.

## Methodology

**Boundary.** This was a local maintainer-driven round on the Orange Pi verify host (Orange Pi OS 1.0.2 Bookworm, aarch64, 12 cores, Node 24.14.0), **run outside a declared sandbox boundary** — the untrusted PR code (daemons, bundles, load generators) executed directly on the host rather than in a credential-free container. No model API key was reachable by the daemons: each ran with an isolated `HOME`/`QWEN_HOME`/`QWEN_RUNTIME_DIR`, a dummy OpenAI-compatible provider pointed at `127.0.0.1:9`, and a fresh workspace directory, so no model call could succeed. The round did hold a GitHub token (needed for the `--publish` path) — that is the isolation gap a sandboxed CI run would not have.

- **Trees.** Head `4ece4fa7241f7b7a647979e56d0f442f6ed57d64` and base `7862c3eef3c660bc7aebf8560292ec277de3e7a4`, the latter confirmed to be the merge-base of head and base by `git merge-base`. Separate git worktrees under `/root/v18052r3/{head,base}`.
- **Dependency build.** `node scripts/setup-worktree.js` in each arm (36.6 s / 36.2 s, pnpm 11.24.0, frozen lockfile). Head ran `npm run build:packages`; base rebuilt `@qwen-code/acp-bridge` and `@qwen-code/web-templates` from its own sources after receiving the 44 identical package `dist` trees. Both bundles produced by the repository's own `npm run bundle`.
- **Load source.** 30 `nice -n 19 yes` burners. The harness samples `/proc/loadavg` every second and refuses to probe until its own `load1 / 12 >= 2.05`.
- **Daemons.** `node dist/cli.js serve --port 0 --hostname 127.0.0.1 --token <t> --workspace <fresh tmp> --initialize-timeout-ms 60000`, `--no-load-admission` only for the opt-out arm. Listening port parsed from the daemon's own `listening on http://127.0.0.1:<port>` line.
- **Observation-gap probe.** Same daemon, no burners: real `SIGSTOP` for 8,001 ms, `SIGCONT`, then an immediate create plus a status read; the latch was polled to release.
- **Mutation, M1 only.** `harness/mutations.mjs` applies one exact replacement, sleeps 1.2 s so vitest cannot reuse a transform cached for the pre-edit mtime, runs `vitest run --reporter=json --outputFile=<abs>` on both owning suites, then restores the file and asserts a clean `git status`. Row M1: 29 passed / 1 failed / 30 total.
- **Input closure for S1.** Between `c2284fe06a` and `4ece4fa724`, `git diff --quiet` reports **unchanged** for `load-admission.ts`, `load-admission.test.ts`, `load-admission-signals.test.ts`, `packages/cli/vitest.config.ts`, `packages/cli/package.json`, `package-lock.json` and `pnpm-lock.yaml`; the M1 row above was nonetheless executed at this head rather than quoted.
- **Raw logs.** `01-live-ab-head.json` (15 cells), `02-live-ab-base.json` (4), `03-observation-gap.json` (8), `mutation-logs/M1-*.json` (the vitest report behind the kill), per-arm `*.daemon.log`, `mutation-run.log`, and the harness `.mjs` files, all in this directory.

_— deepseek-v4.1-flash-1017@e6bf8ffe via Qwen Code /verify-pr (v0.28.4; skill 7898dd943f7f)_