<!-- PR #10916 maintainer verification, head 965900af; posted as a PR comment -->

## 维护者验证：真实构建 + 真实 TUI / headless / ACP 会话 @ `965900af`

**结论：当前形态不建议合并。**
- **阻塞项：** R6-1 是本 PR 引入的回退。我已在真实 TUI 中复现，并附上已验证的补丁，改动很小。
- **需维护者裁定：** 正常工作的 headless 运行会被杀掉，exit 1 且没有答复（第 2 条）。
- **需维护者裁定：** R7-1（[5860841209](https://github.com/QwenLM/qwen-code/pull/10916#issuecomment-5860841209) 中的 Gate 2）。这一项我没有评估。

检测器对它针对的场景确实有效，遥测隐私问题已经解决，完整 `packages/core` 套件没有回归。下面其余各项都属于后续跟进。

**与之前几轮的关系：**
- 2026-09-04 的沙箱验证（[5540535668](https://github.com/QwenLM/qwen-code/pull/10916#issuecomment-5540535668)，`8a8240c4`）针对构建产物里的检测器跑了脚本化断言。
- 本轮是第一次在当前 head 上驱动**完整会话**：真实 TUI、headless `qwen -p`、真实 `qwen --acp` 会话，以及子代理。
- 凡是运行结果印证了已有评审线程的，直接引用线程编号（R6-1、R7-2、R5-1、R4-2、R3-2、R3-4），不另开新条目。

### 验证环境

| Arm | 提交 | 说明 |
|---|---|---|
| `main` | `origin/main` `51b80dadbc` | 对照组 |
| `pr` | `965900af` 合入 `51b80dadbc` → `cd4c24b129` | 合并无冲突；这就是实际会落地的代码 |
| `pr + 补丁 B` / `pr + 补丁 A` | `cd4c24b129` 各加一段 `client.ts` 改动 | R6-1 的两个候选修复 |

- 每个 arm 都跑了真实的 `pnpm install --frozen-lockfile` 和 `npm run build && npm run bundle`（exit 0，每个 arm 约 4 分钟）。
- 模型是脚本化的 OpenAI 兼容假服务器；其余全部真实：shell、`git`、文件工具、TUI（node-pty + xterm.js 截图）、`qwen -p`，以及走 stdio 的 `qwen --acp`。
- 两个 arm 回放的是同一份脚本。

### 已验证有效的部分

| 检查项 | 结果 |
|---|---|
| **Issue 中描述的场景。** 每一轮执行不同的 `git` 命令，前三次都以相同的 exit-128 `not a git repository` 失败，中间穿插成功的读文件。 | **`pr` 在第 5 次模型请求后终止；`main` 共发出 14 次请求。** headless 以 exit 1 退出，并输出 `Loop detection halted the run (repeated_tool_error: …)`；TUI 弹出 loop 对话框（图 1）。 |
| 遥测（`--telemetry-outfile`） | `loop_detected` 记录带有 `loop_type: repeated_tool_error` 和 `error_signature: f8a402…`。我独立重算了这个值：它等于 `sha256("<persisted-stub>sha256:" + 244ae6…)`，其中 `244ae6…` 是 `Output/Error/Exit Code/Signal` 核心的 `sha256`。记录中没有 `error_excerpt`，也没有命令文本。 |
| 子代理路径（`agent-core.ts:1323`） | general-purpose 子代理在同样的死路上，5 次工具调用后停止（`main` 为 10 次；token 5,250 对 11,550）。父代理收到 `<status>failed</status> … Agent terminated with mode: LOOP_DETECTED`。 |
| 合并后代码上的定向单测 | core 1784/1784（loopDetection 171、client 476、scheduler 473、shell 370、truncation 44、finalizer 28、loggers 97、log-to-span 55、agent-core 70）；cli `nonInteractiveCli` 180 通过 + 1 跳过（`main` 上有同样的跳过） |
| **两个 arm 的完整 `packages/core` 套件** | `main` 33,818 通过 / 6 失败；`pr` 33,848 通过 / 6 失败，**失败集合完全相同**（6 个 root 用户/时序相关的环境用例）。merge base 之后 `main` 新增了 91 个提交，在 core 内与它们没有冲突。cli 只跑了 `nonInteractiveCli`。 |
| `965900af` 上的 CI | 全绿。Windows/macOS 的 `Test` lane 和 `Integration Tests (CLI)` 被跳过。 |

![图 1：pr 在第 3 次相同 git 错误后终止](fig1a-tui-pr-halt.png)

<details><summary>图 1b/1c：<code>pr</code> 的对话框，以及同一脚本下 <code>main</code> 跑满 12 轮</summary>

![pr 对话框](fig1b-tui-pr-dialog.png)
![main 继续执行](fig1c-tui-main-continues.png)
</details>

### 发现（按严重程度排序）

**1. 【阻塞；由本 PR 自身的修复引起】R6-1 / Gate 1 已复现：轮中插话会被投递给模型两次。**

在真实 TUI 中，如果在触发终止那一轮的命令还在运行时输入一条消息，会依次发生：
1. CLI 把这条消息放进同一次 `ToolResult` 提交，并把载体作为 `steerInput` 传入。
2. 终止分支把 `requestToSend` 写入历史，其中包含插话部分（`client.ts:4632`）。
3. 此时 `pushInitiated` 仍为 false，所以外层 `finally` 会调用 `restore()`。这条消息被重新排队，在对话框关闭后再发送一次。

结果是：对话框之后的第一次请求里，插话文本出现了**两次**，并且在整个会话剩余部分一直是两次；`main` 上只出现一次。`client.ts:4626` 的注释（"requestToSend 此时只含工具结果部分"）在 TUI 下不成立。

![图 3：插话重复，以及两个补丁的效果](fig3-steer-duplicate.png)

我测试了两个补丁。每个都通过了真实 TUI 运行和一个新增单测，并做了负对照：只回退 `client.ts` 那段改动，对应测试就变红。两者还都通过了 client + loopDetection 648/648、`eslint --max-warnings 0`，以及 core 的 `tsc --noEmit`。

- **补丁 B（推荐）。** 保留写入，并把随发送附带的载体按"已接受"结算，与正常发送路径在写入历史之后的做法一致。这就是 Gate 1 所描述的"终止时 accept"方案。它对所有调用方都安全：没有载体的发送不受影响。
- **补丁 A（按现状不推荐）。** 只写入 `functionResponse` 部分，让载体恢复并重发一次。它能修好 ink TUI，但会让 OpenTUI **丢失**插话：`ui/opentui/live-session.ts:1031` 把取出的插话部分直接放进 `ToolResult` 请求且不带载体，并在收到第一个流事件时就视为已送达（`:756`）。终止时的 `LoopDetected` 事件会触发这一步，而补丁 A 随后把这些部分过滤掉了。这个结论来自读代码，我没有实际运行 OpenTUI。

补丁 B 的 `client.ts` 改动：
```diff
           this.getChat().addHistory(createUserContent(requestToSend));
+          // requestToSend also carries the parts of an attached steer /
+          // teammate carrier (the CLI appends them after the tool results),
+          // and they were just written to history above. Settle the carrier
+          // as accepted, as the normal send path does after its push —
+          // otherwise the outer finally restores it and the same user input
+          // is delivered to the model a second time.
+          if (
+            attachedSteerInput &&
+            !this.settledSteerInputs.has(attachedSteerInput)
+          ) {
+            this.settledSteerInputs.add(attachedSteerInput);
+            try {
+              attachedSteerInput.accept();
+            } catch (error) {
+              debugLogger.warn(`Failed to settle steer input: ${error}`);
+            }
+          }
```
含测试的完整补丁：[B](harness/fix-r6-1-steer-accept.patch) · [A](harness/fix2-r6-1-toolresults-only.patch)。

<details><summary>图 4：打上补丁 B 后的 TUI。插话在终止提示之前就地记录一次。</summary>

![补丁 B 的 TUI](fig4-tui-steer-patchB.png)
</details>

**2. 【合并前需裁定】正常工作的 headless 运行会被杀掉：exit 1、没有答复，也没有开关可以关闭这个守卫。**

作者在 [5853819880](https://github.com/QwenLM/qwen-code/pull/10916#issuecomment-5853819880) 中把 R5-1 判定为刻意的取舍，并请评审者在认为它构成合并阻塞时明确提出。下面的运行结果展示了这个取舍对正常 headless 运行的实际代价，因此我把它列为合并前需要裁定的事项，而不是后续跟进。以下是实测的 headless A/B（图 2）：

- **S3b：R7-2，也就是 Gate 3 中的 R7-7 重新登记的编号。**
  - 配置：shell 对模型可见，同时设置了用户 deny 规则 `permissions.deny: ["run_shell_command(npm *)"]`。
  - 每次拒绝都返回逐字节相同的 `This "run_shell_command" invocation was denied by permission rules. …`（`permissionFlow.ts:122`）。
  - 在一次运行中分散出现三次被拒的 `npm` 调用，中间穿插成功的读文件：`pr` 以 exit 1 退出且没有答复；`main` 正常输出总结。
- **S8：R5-1，[线程](https://github.com/QwenLM/qwen-code/pull/10916#discussion_r3944127930)。**
  - 在真实 git 仓库里做一次正常的审阅：`git diff --quiet -- src/a.js`、`git diff --quiet -- src/b.js`，然后是 `command -v yq`，中间穿插读文件。
  - 每一次都是有信息量的回答（"有改动"/"未安装"），但都会归约成同一个核心 `Output: (empty) / Exit Code: 1`。
  - `pr` 在第三次探测时终止；`main` 正常给出审阅结果。
- **S4：按设计工作，见 `loopDetectionService.ts:88` 的注释。**
  - 先修改再重跑检查的循环，前两次修改没有修好检查。
  - `pr` 在第三次相同失败时终止，尽管中间的修改都成功了。`main` 在第 3 次尝试时修好了问题。

在 TUI 里，用户可以关掉对话框并为本会话禁用检测。headless 下则没有任何退路：`model.skipLoopDetection` 对它无效，阈值也是硬编码的（issue 原本要求"可配置，默认 3"）。

我的建议是以下两者之一，或两者都做：
- (a) **不再把不是错误消息的内容计为证据。**
  - 策略拒绝：消费端只能看到 `response.error`，需要先把 `EXECUTION_DENIED` / `not_started` 传递给它。
  - 静默的 exit-1 回答：`shell.ts:398` 的 `EXIT_ONE_IS_NOT_ERROR_COMMANDS` 是阻止它们被当作错误的自然位置。
- (b) **提供一个设置项**（阈值，0 表示关闭），让 headless 使用者有补救手段。

![图 2：全部场景的 headless A/B](fig2-headless-ab.png)

**3. 【范围问题】`Fixes #10887` 对 ACP/daemon 会话是否成立？**

我把 S1 脚本放进真实的 `qwen --acp` stdio 会话中回放。`pr` 的表现与 `main` 完全相同：14 次模型请求、12 次工具调用、`end_turn`。而这期间有 7 次相同的 exit-128 结果，每条都带着新的 digest 行。

这与 PR 声明的范围一致：
- `recordToolErrorBatch` 只接入了 `client.ts` 和 `agent-core.ts`。
- ACP 专用的 `repeated-tool-failure-guard.ts`"保持独立、未改动"。它默认是 `shadow`（`Session.ts:2423`，环境变量 `QWEN_CODE_ACP_REPEATED_TOOL_FAILURE_GUARD`），按（工具，errorType）计数，阈值为 8。
- `model.skipLoopDetection` 的说明写明 daemon 会话与 ACP 走同一路径。

所以目前 IDE/ACP 的顶层会话（按上述说明，daemon/Web Shell 也一样）没有任何机制会强制终止。如果 #10887 中 `0.20.1-dataworks` 那些会话是经由 ACP 或 daemon 运行的，这个 issue 对它们而言仍未解决。

**4. 【覆盖面，后续跟进】"出现不同错误就重新计数"这条设计规则，让守卫很容易被绕过。** 这是刻意设计（写在 PR 正文里，变异 M7 打破的那个测试也钉住了它），但它有可测量的后果：
- **S2：** 两条死路逐轮交替，16 个报错轮次、一次成功都没有，守卫始终不触发。
- **S1x：** 连击中途调用一次默认禁用的 `list_directory`，终止点就从第 5 次请求推迟到第 8 次。
- **S5b：** 中途有一次 `sleep 6; git …` 被 shell 工具以自己的 `Blocked: sleep N …` 提示拒绝，守卫就完全不触发。

另外，我观察到本应有输出的快速失败命令会间歇性地返回 `Output: (empty)`：所有运行中 211 次里出现 12 次，**其中 `main` 上 104 次里有 6 次**。根因未定位；这不是本 PR 引入的，但它与本 PR 有两方面相互作用：
- 它会重置连击。负载下 S1 在 `pr` 上的 3 次重复运行，分别在第 5 次、第 8 次请求时终止，另一次完全没有终止。
- 它会把互不相关的失败归并到同一个 `(empty) / Exit Code: 1` 签名上，也就是 S8 撞上的那个签名。

可以考虑改变衰减设计：只有当某个签名在 K 个报错轮次中都没出现时才丢弃它。

**5. 【可能性低】R4-2 已复现（S7）。** 三个不同的失败（消息不同，exit code 分别为 1、2、3）各自输出了一行行首锚定的 `Full output sha256: 000…`。它们被算成同一个签名，`pr` 在第三次后终止。消费端取的是第一个锚定的 digest（`loopDetectionService.ts:289`），而被引用的那一行排在生产者自己那行之前。

**6. 【未披露的可见变化】现在每个失败的 shell 结果末尾都会多出一行 `Full output sha256: <64 位十六进制>`。** TUI（图 1）和发给模型的文本里都能看到。PR 描述写的是"没有用户可见的 UI 变化"。对 shell 来说这个标签本身也不准确：它是失败核心的摘要，不是完整输出的摘要。把这个标识改为带外传递（作者已在 R4-2 中把它列为正确修法），可以同时解决本条和第 5 条。

**7. 【测试见证缺口；变异测试印证了 R3-2 和 R3-4】** 在合并后的代码上施加变异，每次都重跑对应的测试套件：

| 变异 | 测试套件 | 结果 |
|---|---|---|
| M1：删除 `agent-core.ts` 中 `recordToolErrorBatch` 的接线 | `src/agents`（2774） | **全绿**；上面的子代理端到端运行是唯一的见证 |
| M4：删除 qwen-logger 里 `error_signature` 的展开 | `src/telemetry`（1068） | **全绿** |
| M5：修改新的 headless 标签文案 | `nonInteractiveCli`（180） | **全绿** |
| M2 终止分支 `addHistory` · M3 批量喂入 · M6 阈值 3→4 · M7 衰减 · M8 deferred 取消分支 · M9 shell digest 行 · M10 `error_excerpt` 清洗键 | 各自对应的套件 | 均被抓住（分别 1 / 2 / 16 / 1 / 1 / 1 / 1 个失败） |

文案方面的小问题：
- TUI 对话框的说明文字（`LoopDetectionConfirmation.tsx:89`）和 `settingsSchema.ts:1885` 在列举常驻守卫时都没有包含这一个。
- `agent-interactive.ts:543` 把 `repeated_tool_error` 导致的停止标成了 "duplicate tool-call loop"。

### 未验证

- R7-1（带排队消息的交互式代理，其 agent 运行时的历史配对）。
- Windows 和 macOS。
- MCP 错误归一化（R3-3）的端到端表现。
- `qwen serve` daemon 运行。ACP 是直接实测的，daemon 是根据代码和 schema 文字推断的。
- 完整的 `packages/cli` 套件。

### 证据

全部放在 本目录：
- 假模型服务器和场景脚本
- headless、TUI 和 ACP 驱动脚本
- 变异测试运行器
- 两份补丁
- 每次运行的结果和工具结果记录（`data/results.json`）

`harness/README.md` 列出了受空输出问题影响的运行。
