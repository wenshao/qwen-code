**Verdict: findings** — 33 executed assertions passed; the only failed assertions are the two carried Suggestions (S1, S2), both re-measured at head `81f7aa4bbc` and both still standing. The A/B is clean: under the same real host load (`load1 / 12 cores` = 2.02–2.12) the head refuses fresh-child creation with REST `503`, `code: system_overloaded`, `Retry-After: 15` and its real readings, while the base admits the identical request with `200`.

<details>
<summary>中文摘要</summary>

**结论：** findings。核心 A/B 在 head `81f7aa4bbc` 上成立：同一真实主机负荷口径（每核 load ratio 2.02–2.12）下，head 对需要新 child 的 `POST /standalone/sessions` 和带 caller-supplied id 的 `POST /session` 返回 `503 system_overloaded` + `Retry-After: 15` + 真实读数，base 对同一请求返回 `200`。已存在的 warm 会话在过载期间 prompt 202 / cancel 204 / detach 204、status 200；`--no-load-admission` 下 `enabled:false` 且创建 200；负荷下降后 `overloaded:false`，被拒的 caller id 可成功复用。

**沿用上轮的两条 Suggestion 依然成立：** S1（`EVENT_LOOP_LAG_ENTER_MS = 1000` 未被字面量钉住，变异 M5 存活 25/0）与 S2（`buildRuntime` 重建前的 `dispose()` 未被钉住，变异 M9 存活 4/0）。两条都是测试覆盖缺口，不是当前行为缺陷。上轮已报告的中央结论本轮独立复测通过，未新增发现。

**delta（相对上轮验证头 `13345ab766`）：** 仅一个 PR 提交 `338bfdc3ae`，在无关路由集成夹具上加 3 行 `--no-load-admission`（该夹具 42 个 `it` 中没有准入断言，未屏蔽任何覆盖）；其余为 `origin/main` 合入。生产默认仍开启准入。

**未覆盖：** macOS/Windows、cgroup 配额口径、内存压力信号、event-loop-lag / observation-gap 的在线路径（仅 CPU-load 路径实机驱动）、branch/worktree 与 scheduled-task 的实机路径、多 workspace、逐提交归因。

</details>

## Carried-forward findings

The previous round at `13345ab766` reported two Suggestions. Both are re-measured here at `81f7aa4bbc`, not inferred from the diff.

| Finding | Status at `81f7aa4b` | Evidence |
| --- | --- | --- |
| S1 — the documented 1000 ms event-loop-lag threshold is not pinned | **stands** | M5 (`EVENT_LOOP_LAG_ENTER_MS = 1_000` → `10_000`) survived the owning suite: **25 passed / 0 failed**. Same-file control M2C (`LOAD_ADMISSION_SUSTAIN_SAMPLES = 3` → `1`) was killed **22 / 3**, so the suite collects and executes. |
| S2 — the rebuild-path monitor `dispose()` is not pinned | **stands** | M9 (delete `loadAdmissionMonitor?.dispose()` before a `buildRuntime` re-entry) survived `run-qwen-serve-load-admission.test.ts`: **4 passed / 0 failed**. The same-file control M9C (opt-out condition → `true`) was killed **2 / 2** on retry, so the suite collects and reds. |

## Central claim and A/B

The PR gates **fresh child allocation** on sustained host load: three consecutive 2 s samples at `load1 / cores >= 2.0` (or event-loop p99 >= 1000 ms) latch overload; fresh spawns then return `503 system_overloaded` with `Retry-After: 15`; live sessions and the control plane stay usable; the gate releases after three samples below its exit thresholds; `--no-load-admission` disables it. The harness reads `/proc/loadavg` and `/proc/loadavg`-derived ratio itself, so both arms are judged by an oracle independent of the PR's own status field.

| Cell | Head `81f7aa4b` | Base `c1bf0ffb` |
| --- | --- | --- |
| Build under test | repo's own `node esbuild.config.js` from source (`dist/cli.js` + chunks) | same command from the base tree |
| Status while healthy (after wiring) | `runtime.loadAdmission`: `enabled: true`, `overloaded: false`, `sampledAtMs > 0`; the field appears ~1.5 s after the listening line | no `loadAdmission` section at steady state |
| Plain `POST /session` while healthy | `200`, session created | `200`, session created |
| External load | 30 `nice -n 19 yes` burners, `load1/12 = 2.12` | same burners, ratio 2.86 when the base arm ran |
| **`POST /standalone/sessions` under load** (documented fresh-child path) | **`503`**, `code: system_overloaded`, `reason: cpu_load`, `loadRatio: 2.03`, `eventLoopLagP99Ms: 22.2`, `Retry-After: 15` | **`200`**, standalone session created (`sourceType: "standalone"`) |
| **`POST /session {sessionId}` under load** (fresh-spawn reservation) | **`503`**, same contract, `loadRatio: 2.12`, `Retry-After: 15` | not driven |
| Plain `POST /session {}` under load | `200`; `runtime.memory.activeAcpChildren` stayed at the prewarmed **1** — a warm attach that allocates no fresh child, which the protocol doc explicitly exempts | not driven |
| Status while overloaded | `200`, `overloaded: true`, `issues[]` contains `system_overloaded` | not applicable |
| Warm session under load | prompt `202`, cancel `204`, detach `204`, status `200` — none gated | not driven |
| `--no-load-admission` under the same load | `enabled: false`, `overloaded: false`; create `200` | flag absent from the base CLI |
| Recovery | after load fell to ratio `0.95`: `overloaded: false`, create `200`, the refused caller-supplied id reused with `200` | not applicable |
| Assertions that bear on PR behaviour | live A/B **20 passed**, standalone **6 passed**, focused probe **6 passed**, opt-out **1 passed** | base cells included above |

### Harness corrections (disclosed, not PR defects)

Five first-pass cells were mis-instrumented and were re-measured; none of them is counted as a failure:

- `head:status-shape-healthy` and `optout:status-disabled` read `/daemon/status` in the first ~0.1 s after the listening line, before the runtime was wired, so `loadAdmission` was absent. The focused probe shows the field first at 1.5 s (`enabled:true, sampledAtMs:0`) and the opt-out daemon reports `enabled:false, overloaded:false` after wiring.
- `head:refusal-allocated-no-child` / `base:created-session-allocated-a-child` counted direct children of the daemon PID (always 0 — the ACP child is not a direct child). Replaced by `runtime.memory.activeAcpChildren`; the daemon prewarms one child at boot, and a plain create attaches to it rather than allocating.
- `probe:activeAcpChildren-tracks-creation` and `standalone:head-no-child-after-refusal` expected a zero baseline, but the prewarmed child makes the baseline 1. The observed value after both a plain create and a refused standalone create stayed at that single prewarmed child.
- `probe:refused-create-503` expected a plain `POST /session {}` to be gated; it is a warm attach (no fresh child) and is documented as not gated. The gated paths above replace it.

## Delta since the previously verified head

The previous report verified `13345ab76636795758216f84dd86d9b8a581327f`. The current head is `81f7aa4bbcc8b98a54ca61c62647003792577e89`. Among the PR's 42 files, exactly one changed in that interval:

- `338bfdc3ae` **test(cli): keep route fixtures independent of host load** — +3 lines in `integration-tests/cli/qwen-serve-routes.test.ts`, adding `--no-load-admission` to the fixture's daemon argv. That file contains 42 `it(...)` cases and no `overload` / `loadAdmission` / `503` assertion (grep count 0), so the opt-out silences no coverage of its own. Production remains default-on: `--load-admission` is declared with `default: true`, and only `--no-load-admission` sets it false.

The rest of the interval is the `origin/main` merge (#17896, #18150, #18092, #17789, #17698, #17922, #18093, #18134, #18115). The merge is part of the verified tree; the PR's own gate sources are unchanged since the last verified head. Package scope between the two arms is acp-bridge (2 files), cli (31) and sdk-typescript (2) only, which is why every other package's built `dist` could be shared across arms.

## Findings

### S1 (Suggestion) — the documented 1000 ms lag threshold is still not pinned

`EVENT_LOOP_LAG_ENTER_MS` is exported and `load-admission.test.ts` builds its boundary inputs from the constant (`:111`, `:135`, `:143`). Mutation M5 changed `1_000` to `10_000`; the suite still passed **25/25** at `81f7aa4b`. The live round drove `cpu_load`, not the lag path, so no executed evidence fixes the documented `p99 >= 1000 ms` criterion. Add a literal-boundary case (`999` healthy, `1000` enters after the three-sample sustain) or assert the exported constant is `1000`.

Reproduce: `mutations/mutations.json` row M5 (`report-M5.json`: `numPassedTests: 25`, `numFailedTests: 0`). The mutated suite wrote its JSON but did not exit (the monitor keeps a handle); the runner read the completed report and terminated teardown.

### S2 (Suggestion) — rebuild-path monitor disposal is still not pinned

Deleting `loadAdmissionMonitor?.dispose()` before a `buildRuntime` re-entry (M9, `run-qwen-serve.ts:6083`) left `run-qwen-serve-load-admission.test.ts` at **4/4**. The line prevents a daemon rebuild from leaving the old 2 s sampler and histogram alive beside the new monitor. Add a rebuild case that asserts the first monitor's `dispose` runs before the second `createLoadAdmissionMonitor` and that only one sampler remains. Test gap, not a current behaviour defect.

Reproduce: `mutations/mutations.json` row M9. The mutated suite wrote 4/4 and did not exit (the undisposed interval keeps a handle); the runner terminated teardown.

## Corrections

None. One clarification of scope, not a correction: the PR text says create is refused under overload, and the protocol doc is precise that only fresh child spawns are gated. This round measured both sides: `POST /standalone/sessions` and a caller-supplied `POST /session` are refused, while a plain `POST /session` that attaches to the already-live primary child is admitted and allocates nothing. That matches "A live bound-session attach is not a fresh child spawn, so it remains available under load."

## Not covered

- **Full `npm run build` and a repo-wide `npm run typecheck`.** Each arm was installed with `node scripts/setup-worktree.js` (pnpm, frozen lockfile), then the workspace was built; the head `packages/cli` tsc build needed an 8 GB heap and the first attempt OOM'd at 4 GB. The bundle is the repository's own `esbuild.config.js` path. A separate repo-wide typecheck gate was not run.
- **Live event-loop-lag / observation-gap paths.** The live round drove `cpu_load`; the lag and sampling-blackout paths are exercised by `load-admission.test.ts` / `load-admission-signals.test.ts` but were not driven through a real daemon.
- **Branch/worktree, scheduled-task and load/resume live paths.** Unit/integration-tested by the PR; this round drove create, standalone create, the control plane, opt-out and recovery.
- **Multi-workspace runtime rebuild**, **macOS/Windows `loadavg` semantics**, and **cgroup quota calibration**.
- **Scheduled-task keepalive suite** — not re-run this round.
- **Per-commit attribution** beyond the single delta commit.

## Methodology

**Boundary.** Local run on the Orange Pi verify host (Orange Pi OS 1.0.2 Bookworm, aarch64, 12 cores, Node 24.14.0), outside a sandbox. No model API key was used by the daemons: each arm ran with an isolated `HOME`/`QWEN_HOME`, a dummy OpenAI-compatible config pointed at `127.0.0.1:9`, and a fresh workspace directory. The PR code, the bundle, the daemons and the load generators all ran on this host.

- **Trees.** Head `81f7aa4bbcc8b98a54ca61c62647003792577e89` and base `c1bf0ffb644612c8cbe6b96969dbc67af90e3b50` (which is also the merge-base) in separate git worktrees. Both bundled with `node esbuild.config.js` from source (head bundle exit 0, base exit 0; `dist/cli.js` 18,397 bytes in each arm, code-split chunks beside it).
- **Dependency build.** `node scripts/setup-worktree.js` in the head arm (38.7 s), workspace build, then the base arm received the identical pnpm tree + every package `dist` whose sources are byte-identical (proven by `git diff --name-only base..head -- packages/`: only acp-bridge, cli, sdk-typescript differ); base's `acp-bridge` was built from base sources, and `git-commit.ts` regenerated in the base tree.
- **Load source.** 22–30 `nice -n 19 yes` burners. The harness sampled `/proc/loadavg` every 2 s and required `load1 / 12 >= 2.05` for its own oracle before probing.
- **Daemons.** `node dist/cli.js serve --hostname 127.0.0.1 --port 0 --workspace <fresh tmp> --token <token> --initialize-timeout-ms 60000`, with `--no-load-admission` only for the opt-out arm.
- **Control plane.** The head arm opened a prompt, cancel and detach on the pre-load session while overloaded; the assertions require "not a `system_overloaded` 503", not a particular model output.
- **Recovery.** Burners killed with `SIGKILL`; the harness waited for `load1 / 12 < 1.0`, then for the status verdict to clear, then retried the exact caller-supplied id that had been refused.
- **Mutation matrix.** `harness/mutations.mjs` applies one exact replacement per row, runs the owning suite with `--reporter=json`, restores the file and `git checkout`, and asserts `git status --porcelain` is empty (it was, after each row).

| Row | Mutation | Suite | Result |
| --- | --- | --- | --- |
| M5 | `EVENT_LOOP_LAG_ENTER_MS = 1_000 → 10_000` | `load-admission` | **survived (25, 0)** |
| M2C | `LOAD_ADMISSION_SUSTAIN_SAMPLES = 3 → 1` | `load-admission` | killed (22, 3) — same-file control |
| M9 | remove `loadAdmissionMonitor?.dispose()` before a rebuild | `run-qwen-serve-load-admission` | **survived (4, 0)** |
| M9C | opt-out condition `opts.loadAdmission !== false → true` | `run-qwen-serve-load-admission` | killed (2, 2) on retry — same-file control; the first attempt aborted with `ENOENT ... coverage/.tmp/coverage-0.json` and wrote no report |

Raw evidence (branch `asserts`, directory [`pr18052-verify-20261124-012108`](https://github.com/wenshao/qwen-code/tree/asserts/pr18052-verify-20261124-012108)): [live A/B results](https://github.com/wenshao/qwen-code/blob/asserts/pr18052-verify-20261124-012108/01-live-ab-results.json) (23 cells), [standalone A/B](https://github.com/wenshao/qwen-code/blob/asserts/pr18052-verify-20261124-012108/03-standalone-ab-results.json) (7), [focused probe](https://github.com/wenshao/qwen-code/blob/asserts/pr18052-verify-20261124-012108/04-probe-oracle-results.json) (8), [mutations](https://github.com/wenshao/qwen-code/blob/asserts/pr18052-verify-20261124-012108/07-mutations.json), [opt-out status](https://github.com/wenshao/qwen-code/blob/asserts/pr18052-verify-20261124-012108/05-optout-status.txt), and the run logs in the same directory.

_— DeepSeek-V4.1-Flash-1017@fda99a87 via Qwen Code /verify-pr (v0.28.3; skill 7898dd943f)_
