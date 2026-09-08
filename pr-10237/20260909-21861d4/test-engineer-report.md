# PR #10237 deterministic runtime verification

## Reproduction Report

**Status**: REPRODUCED on the base; VERIFIED_FIXED for the stale-assignment race on the exact PR head and current-main trial merge.

**Method**: test-script integration with compiled production code, actual JSON persistence, real mutex/file locks, real TeamManager lifecycle/dispatch, and deterministic teammate model substitutes.

**Binary**: Node.js v22.22.2, darwin/arm64; compiled modules under `packages/core/dist/src`.

**Source commits**:

| Arm | Commit | Runtime scenarios | Separate-process pairs |
| --- | --- | ---: | ---: |
| Base | `fb12a6e7fe0586a6c0d75e7ba72fc8a1aad0fe0c` | 30/30 expected baseline outcomes | 5/5 reproduced duplicate dispatch |
| Exact PR head | `21861d474450c115a383281ef7e8529de1ceea07` | 30/30 fixed-state expectations | 5/5 one committed recipient |
| Current-main trial merge | `d55ed477279cd2ac5926eef7c83219930b38baa4` | 30/30 fixed-state expectations | 5/5 one committed recipient |

The base expectation passes deliberately confirm the pre-fix defects; they do not mean the baseline satisfies the fixed invariant. The main agent verified that the relevant Agent Team code closure is identical between the PR merge-base and this base snapshot.

### Observed behavior

| Scenario | Base observation | Exact head and trial merge |
| --- | --- | --- |
| Two concurrent leader assignments, same unowned snapshot, alternating requested-owner order | 20/20 pairs returned two successful updates and delivered to both Alice and Bob; disk retained only one owner | 20/20 pairs produced one success, one explicit snapshot conflict, and exactly one prompt to the owner retained on disk |
| Same race from two separate Node processes sharing the task file | 5/5 pairs delivered twice | 5/5 pairs delivered once; the other process returned the conflict |
| Actual TeamManager idle auto-claim versus a leader with a stale snapshot | Alice received the auto-claim prompt; Bob also received the later stale leader assignment; disk named Bob | Alice received one auto-claim prompt; stale leader returned conflict; Bob received none; disk named Alice |
| `claimTask` primitive versus stale explicit leader assignment | Leader overwrote Alice and delivered to Bob too | Leader rejected; Alice remained owner |
| Owner-only stale leader update, without an explicit status | Overwrote Alice and delivered to Bob | Rejected; Alice remained owner; no Bob prompt |
| Alice completed while stale leader tried to assign/restart Bob | Completed task became in_progress under Bob and was delivered | Completed state and original description remained; no Bob prompt |
| Status-only completion while a teammate claimed the task | Stale completion overwrote the teammate's in_progress state | Rejected; teammate's in_progress state remained |
| Content-only update while a teammate claimed the task | Content persisted and triggered an assignment prompt | Content persisted, owner/status preserved, no assignment prompt |
| Intentional sequential Alice → Bob reassignment and identical retries | Alice and Bob each received one assignment; retries did not re-deliver | Same behavior preserved |
| Inactive-owner recovery | Reassignment to Bob succeeded and delivered once | Same behavior preserved |
| Teammate ownership | Bob could not alter Alice's protected task; Alice could complete it | Same behavior preserved |
| Empty explicit owner in a stale call | Unassignment committed | Conflict correctly rejected the stale write; the content-only recovery hint is also appended for this input |

For every tested snapshot-conflict result, the harness additionally asserts `llmContent === error.message` and `returnDisplay === error.message`. It verifies the conflict and re-read guidance reaches both the model and display, not only an internal error field. Reassignment retry checks drain the deterministic agents' pending queues before counting receipts, so a queued duplicate cannot hide behind an ongoing fake-agent turn.

### Expected behavior

Of two assignments derived from the same stale owner/status snapshot, at most one commits and dispatches. A rejected update must leave the winner's owner/status/content intact and return an actionable conflict through both model and display surfaces.

### Key context and limits

These tests exercise the built implementation without changing product source or replacing production modules, task writes, locks, dispatch, or the idle-claim implementation. The existing repository `FakeBackend`/`FakeAgent` replace teammate LLM execution, and record prompts received at that boundary. They do not prove live-model reasoning or external task completion.

The same-process race holds the actual task's proper-lockfile lock until both real pre-update reads have completed. A supplied Config accessor observes the existing post-read seam; it does not alter the snapshot. The process-pair race uses the same lock with independent Node processes, so it tests real cross-process exclusion in addition to the in-process mutex.

The full idle-scan case pauses a separate leader at the Config accessor after its real task read. The main process emits a real IDLE transition; unmodified TeamManager event handling claims the task and enqueues Alice's prompt. Only then is the leader released. This verifies the automatic delivery path, not only a direct call to the claim primitive.

A normal CLI response serializes these unsafe `task_update` calls, so requesting two calls from an LLM is insufficient to deterministically create this overlap. The first required global-CLI attempt used the unchanged installed qwen 0.23.0 copied into isolation and stopped before the first turn because the isolated configuration had no selected authentication type. The main agent subsequently completed successful global and bundled-head CLI runs against a local scripted OpenAI provider with real scheduler/backend/HTTP traffic; those complementary results are recorded separately in `cli-global.log` and the CLI artifacts. No live hosted model or personal credentials were used.

Intentional sequential reassignment still delivers a new prompt to Bob after Alice has already received one. It does not retract Alice's earlier assignment; this is the PR's documented preserved contract and limits what closing #10207 means. The remaining empty-owner hint is a diagnostic observation, not a claim that content-only editing implements unassignment. Neither observation is presented here as a new merge blocker.

### Exact commands

All commands run from `/tmp/qwen-pr10237-verify-20260909` through the main agent's macOS sandbox wrapper.

```sh
./run-isolated.py node artifacts/runtime-harness.mjs /tmp/qwen-pr10237-verify-20260909/base /tmp/qwen-pr10237-verify-20260909/artifacts/base-runtime base
./run-isolated.py node artifacts/runtime-harness.mjs /tmp/qwen-pr10237-verify-20260909/head /tmp/qwen-pr10237-verify-20260909/artifacts/head-runtime head
./run-isolated.py node artifacts/runtime-harness.mjs /tmp/qwen-pr10237-verify-20260909/merge /tmp/qwen-pr10237-verify-20260909/artifacts/merge-runtime head
./run-isolated.py node artifacts/cross-process-harness.mjs /tmp/qwen-pr10237-verify-20260909/base /tmp/qwen-pr10237-verify-20260909/artifacts/base-cross-process base
./run-isolated.py node artifacts/cross-process-harness.mjs /tmp/qwen-pr10237-verify-20260909/head /tmp/qwen-pr10237-verify-20260909/artifacts/head-cross-process head
./run-isolated.py node artifacts/cross-process-harness.mjs /tmp/qwen-pr10237-verify-20260909/merge /tmp/qwen-pr10237-verify-20260909/artifacts/merge-cross-process head
```

The `head` final argument selects fixed-state assertions and is intentionally also used for the trial merge. The logs retain the source tree, actual Node process IDs for the process-pair runs, and complete returned tool messages. Each run uses unique team names, so repeating these commands cannot pick up earlier task fixtures.

### Raw artifacts

- `runtime-harness.mjs` and `cross-process-harness.mjs`: standalone reproducible harnesses; keep both together.
- `{base,head,merge}-runtime.log`: full scenario outcomes; each corresponding directory has `summary.json` plus 30 case JSON files containing final task-file contents and received prompts.
- `{base,head,merge}-cross-process.log`: pair outcomes; each corresponding directory has `summary.json` plus five pair JSON files with both process results, actual prompt text, persisted task, and process IDs.
- `global-cli-baseline.log`: initial unauthenticated setup attempt, superseded by the main agent's successful isolated scripted-provider CLI verification.

## 中文说明

基础版本真实复现了陈旧快照竞态：20 组同进程并发分配以及 5 组跨 Node 进程分配都发生两次派发，任务文件只保留一个 owner。精确 PR head 与当前 main 的本地试合并均通过相同验证：每组只有一个提交和派发，另一调用获得明确冲突，唯一收件人与磁盘 owner 一致。

还验证了真实 TeamManager 空闲事件触发的自动领取路径：基础版本 Alice 自动领取后，陈旧 leader 仍然将任务派给 Bob；head 和试合并仅向 Alice 投递一次，Bob 不会收到派发。陈旧 owner-only、status-only、完成状态、content-only 更新和 teammate 权限也分别覆盖。冲突文案同时校验 model 和显示字段，不只检查内部 error。

每个版本运行 30 项场景预期与 5 组跨进程验证。基础版本的“通过”表示预期的旧缺陷被稳定复现。编译后的工具、任务文件、mutex、proper-lockfile 和 TeamManager 均为实际实现；仅 teammate 的模型执行由仓库现有 FakeBackend/FakeAgent 替代。另有主代理完成的真实 CLI + 本地脚本化模型 HTTP 服务验证，无个人凭证、无在线真实模型调用。

主动顺序改派依然保留：Alice 已经收到的派发不会撤回，Bob 会收到一次新派发；同 owner 重试不重复投递。陈旧请求中显式空 owner 会得到冲突，但还会附加 content-only 提示；该文案问题作为现存非阻断限制记录。
