## 维护者验证：#13366 在真实 Broker + MySQL 上的 A/B

**结论：修复端到端成立，未发现正确性缺陷。** 我在真实的 Session Store、Runtime Broker、worker 与 MySQL 环境上运行了它。当前 `main` 精确复现了 #13328。PR 合入 `main` 后，第二个 Session 的回合会排队，在第一个回合之后运行，工具恰好执行一次并正常完成。排队机制也与 #13359 的回合截止时限正确衔接。

还有一个产品层面的取舍，需要维护者明确拍板：要么在合入前决定，要么作为跟进项记录。排队本身没有上限。当持有者永不释放挂卷时，原来约 36 ms 的泛化失败会变成最长 30 min 的无声等待，最后以 `hosted_turn_deadline_exceeded` 结束（发现 1）。CI 唯一的红灯是 `ubuntu-latest / Java 17`，它是 runner 自身故障而非本 PR 导致，需要重跑。

这补上了先前 E2E 报告与 triage 都留空的一环：真实 Broker 实际执行 `managed_workspace_execution_lease` 行锁。

### 环境

- Linux、Node 22.22.2、JDK 21、MySQL 8.4.11（Docker）。
- 两个对比臂都经过真实的 `npm run build && npm run bundle`：
  - `main @7ee1ec97` 对比 **PR head `0dccd187` 合入 `main @7ee1ec97` 后的树**。合入后的树就是实际会落地的版本，且已包含 #13359。
  - 另外还跑了 PR head 对比其父提交 `8a1a2efe`，结果一致。
- 每组对比共用一棵树。不含 PR 的一臂只把 `hosted-workspace-tool-turn.ts` 还原后重新 bundle。
- 临时 IT（`HostedVerify13366IT`，见文末，不属于本 PR）启动 managed-agent-server Spring 应用，其中包括 Session Store 与内嵌 Runtime Broker，后端为 MySQL。Broker 拉起 bundled worker。
- 每个场景使用独立的 Workspace 挂卷，挂两个 Session A、B，二者在同一个打包的 `qwen serve --profile hosted-harness` 进程中打开。这与生产形态一致：一个 Harness 承载多个 Session。
- 假 OpenAI 模型下发真实的 `run_shell_command`，命令向挂卷里共享的 `proof.txt` 追加 `start` 与 `end` 标记。
- 一个记录代理同时挡在 Store 与 Broker 前面。

### 两个 Session 共用一个挂卷

![两个 Session 共用一个挂卷](pr13366-two-sessions.png)

| | `main`（无 PR） | PR 合入 `main` |
| --- | --- | --- |
| 客户端看到的 B 的结果 | 首次 409 后 36 ms 即 `turn_error` `hosted_turn_failed` | `turn_complete` `end_turn` |
| B 的 acquire，A 持有挂卷 4 s | 1 次，被拒 `409 workspace_busy` | 17 次 409，之后返回 200，距 A 释放 +208 ms |
| B 的 acquire，A 持有挂卷 40 s | 1 次，被拒 409 | 149 次 409，之后返回 200，距 A 释放 +208 ms |
| `proof.txt` | `A1-start, A1-end`（B 的工具从未运行） | `A1-start, A1-end, B1-start, B1-end`（无交错） |
| MySQL `qwen_tool_execution` | A：1 行 `SETTLED/success`；B：无 | A、B 各 1 行，均为 `SETTLED/success`（各恰好一次） |
| stderr | `failed: Error: Runtime Broker returned HTTP 409 (workspace_busy).` | 一行 `waits for the Workspace mount held by another Session.` |

40 s 的持有时长是 Store writer 租约（5 s）的 8 倍。排队中的 Session 一直保持 activation，之后正常提交。A 的回合耗时在两臂中相同。

### 持有者永不释放

![持有者永不释放](pr13366-stranded-holder.png)

我在代理处丢弃了 A 的 `:release`，请求永远到不了 Broker。A 因此进入恢复阻断，它的租约行在整个运行期间都保持占用，也就是 #12937 描述的终态。

在 `main` 上，B 收到第一次 409 即失败（`hosted_turn_failed`），`DELETE` 立即成功。

PR 合入后：

- **等待：** B 进入等待。30 s 内我数到 115 次 409，约每秒 3.8 次 Broker acquire。
  - `GET /status` 返回 `{hasActivePrompt: true, recoveryBlocked: false}`。
  - +10 s 时 transcript 只有 `managed_journal_event` 记录，没有任何属于这个排队 prompt 的回合事件。
  - 唯一的信号是一行 stderr。
- **上限：**
  - **取消：** `POST /cancel` 返回 204，61 ms 后 B 空闲，结果为 `turn_complete cancelled`，且不处于恢复阻断。
  - **截止时限：** 携带 `deadlineMs: 3000` 的 prompt 在 3038 ms 时以 `turn_error hosted_turn_deadline_exceeded` 结束。
  - **关停：** 有回合排队时发送 `SIGTERM`，进程 17 ms 内以 exit 0 退出，轮询不会拖住进程。
- **被阻塞的会话路由：** 排队期间 `DELETE /session/:id` 与 `POST /detach` 都返回 `409 hosted_turn_active`。

单看 PR head（#13359 合入之前），排队期间截止时限到期会结算为 `turn_complete cancelled`。在 `main` 上则按上文归类，而 `main` 已包含 #13359，无需处理。

### 测试

![测试](pr13366-tests.png)

- **PR head：** 改动涉及的两个测试套件通过，147/147。
- **合入 `main` 后：** 上述两个套件加上 `hosted-harness-session.test.ts`（#13359 改过该文件）通过，335/335。
- **负向对照：** 把生产文件还原为 base 后，PR 新增测试中有 5 个失败，包括 issue 复现测试。说明新测试确实能区分修复前后的代码。
- **定向变异：** 针对改动行做了 6 个单行变异，全部被杀死：
  - 取消的等待被当作阻断
  - `workspace_unavailable` 也排队
  - 恢复路径的 acquire 也排队
  - 每次轮询都打印提示
  - `execute()` 不再传入 signal
  - 等待忽略取消
- **静态检查：** ESLint（`--max-warnings 0`）、Prettier（含两份设计文档）以及 `packages/cli` 的 `tsc --noEmit` 均通过。

### 发现（均不影响正确性）

1. **排队本身没有上限，持有者永不释放时会变成长时间的无声等待。** Managed Agent connector 会发送 `qwen.managed-agent.harness.turn-deadline`（默认 30 min，见 #13359）。因此排在这类持有者后面的回合最多等待 30 min，按实测速率约 6,900 次 Broker acquire，最后以截止时限错误码失败，而这个错误码完全不提挂卷被占。不释放挂卷的持有者包括：
   - **处于恢复阻断的 Session**（已在真实环境中运行，见上）。triage 列为排队前置条件的 #12937、#12904、#13182/#13219 目前全部仍处于 OPEN。
   - **MCP profile 与 hook catalog Session，这是设计如此。** 这一点来自代码阅读，未实际执行。这类 Session 跨回合保持 acquire，只在 `close()` 中释放：
     - `finish()` 对它们跳过 `release()`（`hosted-workspace-tool-turn.ts:2112`）。
     - `HostedHookSession.acquire()` 在 `hosted-hook-session.ts:310`；释放在 `close()` 中，`:1518-1527`。
     - `HostedMcpSession.acquireOwner()` 在 `hosted-mcp-session.ts:893`；释放在 `close()` 末尾，`:871-883`（`close()` 从 `:730` 开始）。

     同一 Workspace 上的普通 shell 或 files Session 会一直等到那个 Session 关闭。

   建议修法（可作为跟进项）：把等待上限设得明显短于回合截止时限，到期后以可归类的 `workspace_busy` 结算。这相当于把 issue 的 (a)、(b) 两个方案合在一起。另一种做法是在 status 或事件流里暴露“正在等待 Workspace”的信号，让客户端与运维能区分排队中的回合和卡死的回合。
2. **回合排队期间，Session 无法删除或 detach**（`409 hosted_turn_active`），客户端必须先 cancel。这个守卫原本就存在，只是本 PR 之前只会短暂触发，现在最长可持续整个回合截止时限。
3. **轮询开销。** 每 250 ms 一次轮询都会走 Broker 完整的 acquire 路径：worker attestation、runtime session 准入、租约行的 `SELECT … FOR UPDATE` 事务。没有退避、没有抖动，等待者之间也没有 FIFO 顺序（triage 同样指出了顺序问题）。加上最多约 2 s 的退避可以大幅降低开销，且不会带来明显延迟。
4. **设计文档措辞。** “表示另一 Session 的工具回合持有挂卷”并不是唯一情形。持有者也可能是 MCP 或 hook Session，或处于恢复阻断的 Session。建议把这些情形写明，并注明限制等待时长的截止时限。

### CI

`ubuntu-latest / Java 17` 在 runner `ecs-qwen-hk1-30` 上失败，surefire 内报 `NoClassDefFoundError: org/junit/platform/commons/PreconditionViolationException`。本 PR 没有改动任何 Java 代码。同一 job 在 `main` push 的 run 37179596621 以及相邻 PR 上都通过，所以只需重跑。其余已完成的 lane 全部为绿。

### 未验证

- Windows 与 macOS：只在 Linux 上验证。
- MCP 与 hook 这类终身持有者：仅来自代码阅读。
- 完整的 Managed Agent coordinator 路径，即由 Java 提交 prompt 的路径：我的 IT 直接调用 Harness HTTP API，Java 侧的截止时限接线来自代码阅读。
- issue 中提到的打包栈 runner 的 `--second-workspace-session` 模式：该模式不在仓库中。

证据：IT、驱动、运行脚本与变异 runner 在 `harness/` 目录。每次运行的驱动结果、MySQL 导出与测试报告在 `data/` 目录。`e2e-head`/`e2e-base`/`e2e-head2`/`e2e-base2` 使用的是较早版本的驱动，缺少部分 detach/截止时限探针；`e2e-head3`、`e2e-merged` 与 `e2e-main` 使用最终版本。
