## Maintainer verification (round 4) — follow-up at `0851c08947`, macOS, real fake-platform stack

**Verdict: `merge-ready` on correctness — 2554/2554 scripted assertions passed, 0 unexpected failures.** Verified head `0851c08947d57c9323da7f518cbaafe3723ac5a3` against base `43a6e1e5e453a23f4fca79303594886ac382e522` (the merge-base with `main`; the branch is merged up to it). One maintainer decision from round 3 still stands open — the `operators` default (Finding 1) — re-measured below with identical results. macOS 26 (arm64), Node 24; round 3 covered Linux. Previous rounds: [round 3 on this PR](https://github.com/QwenLM/qwen-code/pull/13250#issuecomment-5965051094), rounds [1](https://github.com/QwenLM/qwen-code/pull/8241#issuecomment-5270862724) and [2](https://github.com/QwenLM/qwen-code/pull/8241#issuecomment-5963800765) on #8241.

<details>
<summary>中文摘要</summary>

## 维护者验证（第 4 轮）—— 在新 head `0851c08947` 上的跟进复测

**结论：`merge-ready`（从正确性看可以合并）——2554/2554 条脚本断言全部通过，0 个意外失败。** 验证 head `0851c08947`，对照 base `43a6e1e5`（与 `main` 的 merge-base，分支已合并到它）。第 3 轮遗留的唯一待拍板事项——`operators` 默认值（发现 1）——本轮原样复测，结果与第 3 轮完全一致（未配置的群被一次工具审批卡住 300.1 s，详见下文发现 1 复测表）。

**第 3 轮发现的处理状态：**

| 发现 | 状态 | 本轮实测 |
|---|---|---|
| F1 `operators` 默认（未配置的群被审批卡住 5 分钟） | **仍然存在（作者选方案 a：接受并写文档）** | head 上重测：零配置群里 U1/U2 的 `/approve` 均被拒，工具未执行，群会话被挂起 **300.1 s**（第 3 轮为 300.0 s）；配上 `operators:["U1"]` 后审批通过、工具执行、群恢复正常。启动 WARNING、PR 正文 Risk & Scope、`qqbot.md` 三处文档均已落地。**作为维护者我接受方案 (a)**——github/gitlab/dws/email 四个频道本就在同一规则下运行，QQ 是加入既有模型；但发布说明必须写明群聊部署要配 `operators`（正文已写）。 |
| F2 flush 链 4 个门禁无测试固定 | **已修复** | 4 个变异点在新 head 全部被各自见证测试杀死（m06/m07/m09/m12，见变异矩阵）；新 head 套件 691 通过。 |
| F3 需要再合并 `main`（文档冲突） | **已修复** | 作者已合并并解决 `overview.md` 冲突；本轮 `git merge-tree` 对当前 `main`（`ad6039aa`）试合并零冲突，且 `main` 自 merge-base 以来对本 PR 涉及的 20 个文件零改动。 |

**本轮新增探测（针对第 3 轮之后的 delta，即 R4–R10 修复批次）：** 核心场景 A/B 全量重跑（S1 隔离、S2 媒体、S3 steer 边界，base/head 行为翻转与第 3 轮逐格一致）；对最新提交 `0851c08947` 的修复做了变异回滚验证（回滚后其专属测试精确变红）；变异矩阵抽查 3 个 R7/R8 区域门禁（m05/m08/m16，分别被 134/11/15 个测试杀死）。门禁：qqbot 691、channel-base 1463、cli 相关 276、web-shell 57 全绿；tsc、eslint（已做活性验证）、prettier 干净。

**未覆盖：** daemon 模式（S4）本轮未在 macOS 重跑（无 root 权限改 /etc/hosts；daemon 路径的 delta 由 session-scope-parity 等单测固定；第 3 轮已在 Linux 实测通过）；真实 QQ 凭据与生产平台；gateway 断线重连、cron、视频附件；purge 升级路径（第 2 轮已端到端实测，本轮由 persistence 单测覆盖）。

</details>

### Round-3 finding status (every row re-measured at `0851c08947`, none quoted from the old report)

| # | Finding (round 3) | Status | Evidence this round |
|---|---|---|---|
| F1 | Empty `operators` wedges an untouched group for 300 s on one approval-gated tool call | **Stands — author chose option (a), accept + document; I accept (a)** | S5/S5b re-run: head-zero wedges **300.1 s** (round 3: 300.0 s), tool never runs, both members refused; head-ops works as documented; base-zero unaffected. Boot warning, PR-body Risk & Scope, and `qqbot.md` all carry the consequence and remedy (verified in code/log/docs). |
| F2 | Four flush-chain guards not pinned by any test | **Fixed** | Mutation re-measure: all four guards (m06/m07/m09/m12) are killed at the new head, each by its named witness test (table below). |
| F3 | Branch conflicts with `main` (docs only) | **Fixed** | Author merged `main` and resolved `overview.md`. This round: `git merge-tree` against current `main` `ad6039aa` is conflict-free, and `main` has not touched any of the PR's 20 files since the merge-base (`git diff --stat 43a6e1e5..ad6039aa -- <paths>` is empty). |

### Central claim A/B — re-run in full at the new head

Same harness, same fake QQ platform (real TLS + WSS, SNI and hostname verification against the harness CA), one build per arm. Expected base failures are the known base defects, encoded as expected-fail cells.

| | Cell | base `43a6e1e5` | head `0851c08947` |
|---|---|---|---|
| S1 | Zero-config `groupAllPolicy:"all"` (`qwen channel start qq`) | forced-single warning fires; keys `qq:U1:GA qq:U2:GA qq:U2:U2 qq:U3:GB`; cross-member recall `NONE`; DM `/clear` refused as shared | no forcing warning; keys `qq:GA qq:GB qq:U2`; recall `PP-ALPHA`; GB and DM isolated; DM `/clear` clears. **7/7** (base 3 pass + 4 expected-fail) |
| S2 | Inbound image under thread scope | image stays in sender's own session (U2 sees `FILES=0`) | image becomes GA group context (`FILES=1`), does not reach GB/DM; mid-stream image turn queued, keeps its own `msg_id`; every chunk anchored to its streaming turn. **11/11** (base 9+2) |
| S3 | Operator's image steers another member's stream (both arms `sessionScope:"thread"`) | cancelled partial merged into the image reply | partial flushed alone on the cancelled turn's `msg_id`, image reply separate; exactly-once chunk delivery; no unanchored sends. **7/7** (base 5+2) |

![S1 A/B](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-01-ab-isolation.png)
![S2 A/B](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-02-ab-media.png)
![S3 A/B](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-03-ab-steer.png)

### Finding 1 re-measurement (S5/S5b) — unchanged, and I accept option (a)

Zero-config @mention group, no `operators`, no `approvalMode`: model asks for `touch` → permission prompt posted → requester's `/approve` answered "Only authorized members can answer permission requests in this shared session." (same for U2) → tool never runs → U2's follow-up answered **300.1 s** later, exactly when `AcpBridge` times the permission request out (`timed out after 300000ms` in the channel log). With `operators:["U1"]`: U1 approves, tool runs, group keeps working. On base the session is user-scoped so the gate never fires and the requester approves their own prompt.

Option (a) is the right call for this PR: `github`, `gitlab`, `dws` and `email` already ship `defaultSessionScope: 'chat_thread'` under this exact gate with `operators` unset — QQ joins the existing model rather than inventing a second one, and option (b) would change shared-session semantics for all of them. The mitigation chain is complete at head: startup WARNING (observed in the S1/S5 logs), the PR body's Risk & Scope paragraph, and the `qqbot.md` operators section all state the consequence and the remedy. **Release note must keep the line that group deployments need `operators`.**

![S5 variants](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-04-operators.png)
![S5b wedge](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-05-wedge.png)

### Finding 2 re-measurement + delta mutations

Each mutant is a single-edit revert in `packages/channels/qqbot/src`, run against the package's full suite (unmutated control: 691 passed; liveness control m01 on `index.ts` killed as expected; tree restored clean after every mutant).

| Mutant | Guard removed | Result | Killed by |
|---|---|---|---|
| m06 | `onPromptStart` clears `completedTurns` | KILLED (1) | witness `onPromptStart clears completedTurns so a restarted turn cannot alias it` |
| m07 | `onPromptStart` drops a dead orphan stash | KILLED (3) | witness `onPromptStart drops a dead orphan stash left behind a turn-counter reset` + 2 buffer-cap tests |
| m09 | `isMsgSeqStillInUse` counts in-flight anchored sends | KILLED (3) | witness `isMsgSeqStillInUse holds a suspended cancelled-stash send on its counter` + 2 seq tests |
| m12 | flush chain `.finally` releases `flushingSessions` only for its own state | KILLED (1) | witness `the flush chain's .finally releases flushingSessions only for its own state` |
| m05 | delta: `onPromptStart` turn-counter bump | KILLED (134) | suite-wide |
| m08 | delta: anchor identity gate (`expectedMsgId`) | KILLED (11) | — |
| m16 | delta: boundary `residual` upgrade | KILLED (15) | — |
| m01 | control: `defaultSessionScope: 'thread'` removed | KILLED (2) | send.test.ts scope tests |

Separately, the newest commit's own pinning test was vacuity-checked: reverting `0851c08947`'s guard (`deleteTurnGenerationIfOwned` dropping the turn counter while a prompt is in flight) turns exactly `delivers the head a terminal settle would strand by dropping the turn counter` red (277 other stream tests unaffected), then the tree was restored.

![mutation matrix](https://raw.githubusercontent.com/wenshao/qwen-code/verify-pr13250-assets/pr-13250/r4-06-mutation-matrix.png)

### Gates (head `0851c08947`)

| Gate | Result |
|---|---|
| `npx vitest run` in `packages/channels/qqbot` | 8 files, **691 passed** (540 at round 3 → 691 now) |
| `npx vitest run` in `packages/channels/base` | 24 files, **1463 passed** |
| `packages/cli`: `config-utils`, `session-scope-parity`, `channel-settings-store` | **276 passed** |
| `packages/web-shell`: `channel-editor-state` | **57 passed** |
| `tsc --build` (qqbot) | clean |
| `eslint --max-warnings 0` on all 18 changed `.ts` files | clean — gate proven live (`debugger;` probe → `no-debugger` error, exit 1) |
| `prettier --check` on changed files | clean |
| `git merge-tree` vs `main` `ad6039aa` | conflict-free; `main` untouched on all PR paths since merge-base |

### Not covered

- **Daemon mode (`qwen serve --channel qq`, round 3's S4)**: not re-run on this Mac — the serve worker scrubs `NODE_OPTIONS`, so the preload can't reach it, and this machine has no passwordless sudo for the `/etc/hosts` override round 3 used on Linux. Not a carried finding; the daemon-path delta since round 3 (`channel-settings-store`, `config-utils` scope resolution) is pinned by the `session-scope-parity` (169 new lines) and settings-store suites above. Round 3's Linux S4 result (7/7) was on code whose daemon-relevant surface is unchanged since.
- Real QQ credentials and the production platform; gateway RESUME/reconnect; cron flows; video attachments (images only).
- The purge upgrade path end-to-end (round 2 measured it; this round covers it via the persistence suite only).
- Windows; round 3 covered Linux, this round covers macOS.
- Per-commit attribution of the R4–R10 fixes (12+ qqbot commits): verified as an aggregate delta plus the newest commit's vacuity check, not one A/B per commit.

### Methodology

Two worktrees (head `0851c08947`, base `43a6e1e5`), each installed with pnpm from a shared store and fully built; `readlink -f node_modules/@qwen-code/qwen-code-core` confirmed to resolve inside each tree (no cross-tree leak; the PR does not touch the lockfile, so the shared store is a clean control). The fake QQ Open Platform serves the token endpoint, `/gateway`, and a WSS gateway, records `/v2/{groups,users}/:id/messages`, and serves attachment downloads — all over real TLS with a harness CA (`NODE_EXTRA_CA_CERTS`), real SNI and hostname checks. Round 3 ran as root on Linux with a loopback alias on :443; this Mac is unprivileged, so the fake listens on 127.0.0.1:18444 and a `--require` preload redirects the TLS connect by SNI (hostname verification unchanged). The channel processes run with a scrubbed environment (all `QWEN_*` removed, then `QWEN_HOME` set to an isolated dir — this machine exports `QWEN_RUNTIME_DIR` globally, which otherwise defeats HOME isolation). The model is a recording OpenAI-compatible server whose answer is a pure function of the history it receives. Harness, scenario scripts, mutation scripts, raw per-run ledgers/transcripts and result.json files: [`pr-13250/` on the assets branch](https://github.com/wenshao/qwen-code/tree/verify-pr13250-assets/pr-13250).

---
<sub>🤖 Generated with [Qwen Code](https://github.com/QwenLM/qwen-code) — maintainer verification round 4, driven locally by @wenshao</sub>
