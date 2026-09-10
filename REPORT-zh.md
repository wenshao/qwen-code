# PR #11576 —— 本地端到端验证报告

Head `108f07dc42`，base `ac1edef974`（与 `main` 的 merge-base）。以下所有结论都跑在 Linux 上、
针对**构建产物**而不是测试替身：headless `qwen -p`、tmux 里的真实 Ink TUI、以及带 Web Shell 的
真实 `qwen serve` daemon，全部由一个 OpenAI 兼容 mock 驱动，该 mock 能按 PR 区分的每一种形状
让 Goal evidence checkpoint 校验器失败。A/B 对照是同一个 worktree 反向应用 PR diff 后重新构建。

## 结论

**建议合并。** PR 里每一条行为声明都端到端复现了。下面 4 条发现都不阻塞合并；其中 F1 值得一个
后续 PR，因为它正好落在 PR 自己的证据块所宣传的那种失败形状上。

## 1. PR 声明的检查

| 命令 | 结果 |
| --- | --- |
| core `npx vitest run src/goals` | 18 个文件、**566 通过** —— 与 PR 一致 |
| cli `GoalPill` + `GoalStatusMessage` + `live-session-model` | 3 个文件、**86 通过** —— 与 PR 一致 |
| web-shell `GoalsDialog` + `mappers` + `i18n` | 3 个文件、**105 通过** —— 与 PR 一致 |
| core、cli、web-shell 的 `tsc --noEmit` | 无错误 |
| 全部 24 个改动文件的 `prettier --check` + `eslint` | 通过 |

## 2. 停机原因跟随失败形状（真实 CLI，A/B）

每个 arm 都驱动一个真实 Goal，直到连续三次 checkpoint 停滞、runtime 把它停掉。mock 在每个 arm
里用不同方式让校验器失败；下面的 ladder 是从会话 journal 里读回来的（本分支的 `*.ladder`）。

| Arm | 停机记录上的 `lastCheckpointFailure` | 停机原因 |
| --- | --- | --- |
| **PR** 满额 claim 列表（32 条） | `checkpoint came back with a full claim list (32 claims) while the evidence window overflowed` | `STALLED` —— *收窄目标* |
| **PR** claim 引用了不存在的来源 | `InvalidGoalCheckpointError: Goal checkpoint claim 1 cites unknown source e1` | `UNUSABLE` —— *checkpoint 模型没有返回可用 JSON* |
| **PR** provider 返回 HTTP 500 | `Error: Failed to generate text content (side-query:goal-checkpoint-verifier): 500 mock upstream failure` | `UNREACHABLE` —— *provider 可达后再 resume* |
| **PR** 校验器始终不回应（runtime 超时） | `Error: Request was aborted.` | `UNREACHABLE` |
| **base**，四个 arm 全部 | *（没有这个字段）* | 四种情况都是同一条 PR 前的文案：*收窄目标* |

四个 PR arm 仍然都记录 `limitKind: "evidence_catalog"`，所以 resume 的行为与之前完全一致。
四个 base arm 的停机文案彼此完全相同 —— 这正是 #11326 描述的问题。

**不计停滞的失败也会被记录。** 在窗口仍有余量的情况下，一次运行在 `turnCount 8` 时记录了
`lastCheckpointFailure` 而**没有** `checkpointStalls`，与 PR 描述一致。

## 3. 停机之前就能看见

![停机前的底栏 pill 与状态卡](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-before-stop.png)

在 `checkpointStalls = 2` 时，底栏 pill 显示 `checkpoint 2/3 stalled`，`/goal` 渲染出
`Checkpoint: 2/3 stalled · Error: Request was aborted.` —— 此时 Goal 仍在运行。

同一时刻的 base 对照 —— 一个离被停机只差一次停滞的 Goal 看起来完全健康：

![pill A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-pill-ab.png)

停机之后的状态卡，上为 base、下为 PR：

![状态卡 A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-card-ab.png)

## 4. daemon 与 Web Shell 也带上了这两个字段

真实 `qwen serve` 监听 `127.0.0.1:8576`，通过 `POST /session` 建会话、`POST /session/:id/prompt`
驱动 Goal。Goal 仍处于 active 时，`GET /goals` 返回的 snapshot 里已经带上两个字段：

```json
{"status": "active", "turnCount": 2, "checkpointStalls": 2,
 "lastCheckpointFailure": "Error: Request was aborted.", "limitKind": null}
```

由该 daemon 渲染出的 Goals 页面 —— 上为停滞过程中、下为停机之后：

![Web Shell Goals 对话框](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-webshell.png)

## 5. `get_goal` 与 resume

停机后在同一会话里调用 `get_goal`，`lastGoal` 里两个字段都在：

```json
{"active": false,
 "lastGoal": {"status": "usage_limited", "turnCount": 3, "checkpointStalls": 3,
              "lastCheckpointFailure": "Error: Request was aborted.",
              "lastReason": "…the last check failed before the checkpoint verifier answered…"}}
```

对 evidence 受限的 Goal 执行 `/goal resume`，两个字段连同 `limitKind`、`lastReason` 一起被清掉，
之后的状态卡不再带 `Checkpoint:` 行：

![resume 清掉停滞计数与诊断](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/pr-resume.png)

## 6. 新增测试不是空转 —— 15 个变异杀掉 14 个

每个变异只改一行发布代码，只跑应该察觉到它的那些测试（本分支的 `mutate.log`）。

| | 变异 | 结果 |
| --- | --- | --- |
| M1 | 把所有非 checkpoint 错误都归类为 `unusable` | 杀掉（3 个用例失败） |
| M2 | 发现窗口有余量的检查不再清掉诊断 | **存活** —— 见 F3 |
| M3 | 什么也没证明的检查丢掉此前的诊断 | 杀掉 |
| M4 | 停机原因忽略最后一次失败的形状（PR 前行为） | 杀掉（4 个用例失败） |
| M5 | 成功且未停滞的 checkpoint 不再清诊断 | 杀掉 |
| M6 | `edit` 不再清掉诊断 | 杀掉 |
| M7 | 记录解析器拒绝任何带新字段的记录 | 杀掉 |
| M8 | 上限按 UTF-16 单元而非码点计量 | 杀掉 |
| M9 | `get_goal` 的 `lastGoal` 摘要丢掉诊断 | 杀掉 |
| M10 | 底栏 pill 不再显示停滞计数 | 杀掉 |
| M11 | Ink 状态卡不再显示 `Checkpoint` 行 | 杀掉（3 个用例失败） |
| M12 | OpenTUI 卡片不再携带 `Checkpoint` 行 | 杀掉 |
| M13 | web-shell 映射重新丢掉诊断 | 杀掉 |
| M14 | Goals 对话框不再渲染 `Checkpoint` 行 | 杀掉 |
| M15 | 英文 `goal.checkpointFailed` 文案漂移 | 杀掉 |

---

# 发现

## F1 —— Important。校验器超时记录的是 `Error: Request was aborted.`，而不是超时信息

PR 的证据块宣传的是：

```text
"lastCheckpointFailure": "Error: Goal checkpoint verifier timed out after 180000ms"
```

那是直接抛出超时错误的桩校验器产生的结果。走真实 provider 时它不会保留下来。
`createGoalCheckpointVerifier` 用那个 `Error` 作为 abort *reason* 中止自己的
`timeoutController`，但这个中止先到达 OpenAI SDK，SDK 抛出自己的 `APIUserAbortError`
并使用默认文案，reason 被丢弃。最终记录里 —— 以及用户读到的 `Checkpoint:` 行 —— 是：

```text
Checkpoint: 3/3 stalled · Error: Request was aborted.
```

实测中把 `model.goalCheckpointTimeoutSeconds` 设为 8，三次检查记录的都是这条字符串。它没有说
检查超时了，没有给出触发的时限，也没有指明是哪个校验器 —— 而这恰恰是唯一一种「诊断本身就是
它等了多久」的失败形状。分类仍然是对的（`unreachable`，建议也正确），500 那一路的诊断也非常好，
所以这不阻塞合并；但它正是所关联事故讨论的那种形状，也正是 PR 正文承诺要解释清楚的那种形状。

一行修复，放在已经有 `finally { clearTimeout(timer) }` 的那个 `try` 上：

```ts
} catch (error) {
  // provider 自己的 abort 错误抹掉了我们中止的原因。
  if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
  throw error;
} finally {
  clearTimeout(timer);
}
```

顺带一提：诊断的 `ErrorName:` 前缀只有在抛出的类设置了 `.name` 时才带信息。
`InvalidGoalCheckpointError` 设置了，多数 provider 错误没有，所以它们都渲染成裸的 `Error:`。

## F2 —— Nit。「Goal 状态卡会显示 `Checkpoint:` 行」需要加一个限定

`shouldDisplayGoalStateCause` 对 `'checkpoint'` 返回 `false`（本 PR 未改动，Ink 与 OpenTUI 共用），
所以一次停滞的 checkpoint 永远不会主动**推送**一张卡片。在一个只是在干活的 Goal 里 —— 没有终态
提案、没有暂停 —— 从 `create` 到停机之间卡片上什么也不会出现，这也正是我观察到的：三次停滞
累积过程中，transcript 里没有出现任何卡片。

这条声明仍然成立，只是需要主动触发：`/goal` 会渲染卡片，并且在停滞过程中确实带着
`Checkpoint: 2/3 stalled · …`（截图见第 3 节），任何生命周期卡片（`pause`、`resume`、
`verifier_reject`）也一样。真正「一直在线」的停机前提示面是底栏 pill 和 Web Shell，两者都已验证。
建议把 PR 正文和 `docs/users/features/goals.md` 里的措辞放软一些：pill 是会自己变化的那个，
卡片则是在被渲染时会带上这一行。

## F3 —— Nit。`'room'` 分支的清除是唯一没有被测试钉住的一行（M2）

`finishCheckpointCheck` 里写的是 `health = outcome === 'room' ? 'clear' : failure`。把整个表达式
换成 `failure` —— 也就是让「窗口其实还有余量」的检查保留一条陈旧诊断而不是把它退休 ——
171 个 `goal-runtime` 用例全部照常通过。

场景其实已经搭好了：`resets the stall streak when a check needs no checkpoint at all` 先跑两个
停滞回合（会在记录上留下 `FULL_CLAIM_LIST_FAILURE`），再跑一个走 `'room'` 分支的安静回合。
它断言了停滞计数被清掉，却没断言诊断。加一行就能杀掉这个变异：

```ts
expect(runtime.getSnapshot().goal).not.toHaveProperty('lastCheckpointFailure');
```

## F4 —— Nit。复制出来的 `GOAL_CHECKPOINT_STALL_LIMIT` 没有防漂移保护

`packages/sdk-typescript/src/daemon/types.ts` 重新声明了 `= 3`，注释说明它必须与 core 保持一致，
但没有任何东西强制这一点；而 Web Shell 渲染 `N/3` 里的分母用的是 SDK 这份副本，runtime 停机用的
却是 core 的值 —— 一旦漂移，用户看到的是错误的上限，而不是构建失败。PR 说这沿用了已有的
`GOAL_PAUSE_REASON_COMMAND` 做法，这没错，那一处同样没有保护；一条相等断言就能同时覆盖两者。

---

## 验证工具

在本分支的 `harness/`，README 里记了那些坑。有四条值得重复：一个不停发工具调用的 mock 永远
不会结束一个 Goal 回合（运行会死在单回合工具调用上限上）；窗口必须**每个回合**都溢出，因为一次
成功的 checkpoint 会推进游标并把停滞计数清零；claim 必须引用真实的 evidence uuid **并且**用它
真实的 `proofKind`，否则一个 `full_claims` arm 会悄悄变成 `unusable` arm；以及
`model.goalCheckpointTimeoutSeconds` 能让超时那一路在几秒内跑完，而不是 3 × 180 秒。
