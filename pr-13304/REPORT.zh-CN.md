## 维护者验证：真实拓扑 A/B（合入后）

**结论：两处修复在端到端层面都成立，没有发现阻塞项。** 我在本地搭了真实的 Hosted 拓扑并逐一注入故障：base `691a374d` 两个缺陷都能复现，head `52baa3c1` 两个都扛住了。有两项值得跟进（见文末），都不是回归。

> 我验证的是 `52baa3c1`。验证进行期间，本 PR 以 squash 方式合入为 `2c591ecc`。四个改动文件在 `52baa3c1`、`2c591ecc` 和当前 `main` 上逐字节一致，所以以下结论适用于实际发布的代码。

### 环境

- Linux、Node 22.22.2、JDK 21、MySQL 8.4.11（Docker），对 PR head 做了真实的 `npm run build && npm run bundle`。
- 临时 IT（`HostedVerify13304IT`，见下方发布的文件，不属于本 PR）启动 managed-agent-server 的 Spring 应用：Session Store 加内嵌 Runtime Broker，跑在 MySQL 上。Broker 会拉起打包后的 worker。
- 驱动脚本启动打包好的 `qwen serve --profile hosted-harness`，对接一个假 OpenAI 模型，模型发出真实的 `run_shell_command`。Store 与 Broker 前面挡着同一个记录代理。
- 两臂共用同一棵源码树：base 臂是同一个 bundle 重建，只把两个生产文件恢复到 `691a374d`。

### 真实拓扑结果

![真实拓扑 A/B](pr13304-e2e-ab.png)

| 注入的故障 | base `691a374d` | head `52baa3c1` |
| --- | --- | --- |
| **确认应答丢失。** Broker 应用了第一次 Shell 确认，随后代理销毁它的应答 | Broker 与 runtime 都已确认（`200`、`acknowledged: true`、runtime `settled`），harness 却记录 `recovery blocked: TypeError: fetch failed`。journal 中始终没有 `settleTurn`，下一个 prompt 返回 `409 hosted_turn_recovery_required` | 同一份 receipt 重放一次，真实 Broker 与 runtime 两次都回答 `settled`。回合正常结算，下一个 prompt 返回 `202`，Shell 每回合只执行一次 |
| **drain 无法结束，然后 DELETE。** 在确认时刻，代理在该回合的 Shell publisher 上开一个请求，且永远不发完 body | `turn.settled` 之后，`DELETE /session/:id` 在 75 s 内 300 次返回 `409 hosted_turn_active`；客户端放掉挂住的请求后 48 ms，DELETE 返回 `204` | `turn.settled` 之后 43 ms，DELETE 返回 `204`，此时 drain 仍被挂住 |
| **同样挂住 drain，然后提交下一个 prompt** | 75 s 内 300 次 `409 hosted_turn_active`；客户端放掉挂住的请求后 45 ms，prompt 返回 `202` | `turn.settled` 之后 21 ms 返回 `202`。回合 2 在自己的 publisher 上运行，并在回合 1 的 drain 仍被挂住时完成结算 |

- MySQL：两轮完整运行共 9 行 `qwen_tool_execution`，全部 `SETTLED/success`，`dispatch_generation = 1`。重放和重叠的 drain 都没有让 Shell 副作用重跑。
- 可重复性：确认应答丢失这一场景，head 单独跑了 3 次，全部通过；base 跑了 2 次，2 次都被阻塞。

这两条结果回答了 triage 评审留给 `/verify` 的两个问题：

- 重放的确认确实能在真实 Broker 下恢复会话可用性。
- Broker 之下的 runtime 那一跳（`ManagedRuntimeToolExecutor.acknowledgeV3`）会对同一份 receipt 去重：两次尝试都回答 `settled`。

### 单测、负对照与探针

![单测见证、负对照与探针](pr13304-unit-probes.png)

- **测试计划中的四个套件全部通过：381/381。**
- **负对照。** 我把每个生产文件分别恢复到 base、保留 PR 的测试，对应的见证测试都失败，报错与 PR 描述中引用的一致。
- **缺口：`/session/:id/managed-runtime/continue` 这一处改动没有任何测试钉住。** 只回退这一处，`hosted-harness-session.test.ts` 仍然 181/181 全绿。
  - 我为它补写了见证测试：在 continue 路由上让 tool-turn 的清理永不 settle，期望状态变为空闲、`DELETE` 返回 `204`。它在 head 上通过，在只回退该处和 base 上都失败。源码见 `harness/inject-tests.py`。
  - 建议在后续 PR 中补上它或等价测试。
- **fail-closed 得以保留。** 成功回合之后清理若 reject，head 仍然进入 `recoveryBlocked: true`，下一个 prompt 返回 `409`。`.catch` 保证准入仍是关闭的，变化的只是先后顺序：head 在清理结束前就已可用，base 则一直保持 active 直到清理结束。

### 关于 triage 评审中的两点

1. **"恢复之后 `session.blocked` 可能被乱序写入"。** 我认为这条路径不可达，代码阅读、探针和一轮独立的反向审计都支持这一点。
   - `HostedShellPublisher.drain()` 只可能因 `server.close()` 出错而 reject，而这只在 publisher 从未成功监听时发生。`Promise.allSettled(operations)` 与 `ResourceToolResultSegmentStore.close()` 都不会 reject。
   - 监听失败发生在 `HostedWorkspaceToolTurn.execute` 的 `try` 内，其 `catch` 一律抛出 `HostedToolRecoveryRequiredError`，所以该回合已经被 prompt 路由标记为 recovery-blocked。
   - 探针显示，这个 rejection 在 `setImmediate` 和 `setTimeout(0)` 之前就已 settle，与路由自身的 `catch`/`finally` 处在同一批 tick 里，而后两者内部没有 `await`。任何 HTTP handler（包括 hook 操作轮询）都无法插进来，因此不需要在"接受还是修改"之间做取舍。
2. **应答在 body 中途被截断。** 这种情况*会*重放：undici 以 `TypeError: terminated` 拒绝 body 读取，而不是评审所假设的 `SyntaxError`。这是安全的方向，因为 runtime 会去重。
   - 不会重放的情况：网关返回带 HTML body 的 `502`（`SyntaxError`）或带 JSON body 的 `503`（`HostedWorkspaceBrokerRejection`）。只有 Harness 与 Broker 之间还隔着其他组件时，这一点才有意义。
   - 非传输类的 `TypeError`（例如被拒绝的重定向）也会无害地重放一次。以上行为与 `prepare()` 完全一致。

### "无上限"的说法属实，另有一处残留

- **修复前的等待确实没有上限。** Node 的 `http.Server.close()` 会清除连接检查定时器，所以 drain 一开始，`requestTimeout` 就不再生效。
  - 用真实 publisher 做的探针：未进入关闭的 server 在 29.8 s 时以 `408` 回收挂住的请求；正在 drain 的 server 到 65 s 时该请求仍然打开。
  - 也就是说，只要对端在请求中途停住，修复前的会话就会无限期不可用、也删不掉。
- **head 上的残留（非阻塞，也不是回归）。** 挂住的 drain 现在在后台等待。在真实拓扑中，成功 `DELETE` 之后 65 s，被挂住的 publisher 连接仍然打开，即 publisher 的 server 与 socket 会比会话活得更久，直到对端断开。
  - 修复前同样持有这个 socket，变化的只是谁在等它。
  - 后续可以给 `server.close()` 这一步加上上限，例如宽限期过后调用 `closeAllConnections()`。在途的 publisher 操作不依赖该 socket，仍会执行完。
  - #13307 未覆盖这一项。

### 未验证

- Windows 与 macOS：只在 Linux 上验证。
- 以 Session Store 停滞作为卡住的根源：Store 请求自带 30 s 客户端超时，所以我改为在 publisher 连接上注入停滞。
- 一处小的、未在描述中披露、但据我判断无害的顺序变化：continue 路由现在先调用 `releaseRecoveredRuntime(session)` 再进入 drain，此前是在 drain 之后。publisher 的写入走的是 Store writer 授权，而不是 runtime lease。

其他检查：四个改动文件的 ESLint（`--max-warnings 0`）与 Prettier 均通过，`packages/cli` 的 `tsc --noEmit` 通过。`52baa3c1` 上的 CI 全绿。
