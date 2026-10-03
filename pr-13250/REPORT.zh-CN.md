## 维护者验证（第 3 轮）—— Linux 真实环境，相对 #8241 各轮的增量

**结论：代码行为与 PR 描述一致，从正确性看可以合并。合并前需要维护者先处理两件事：**

1. **分支与 `main` 再次冲突，只涉及文档。** 冲突在 `overview.md`，对方是 #12939 新加的 `email` 行。我已在本地解决，解决后测试仍全绿。
2. **`operators` 的默认行为需要明确拍板。** 我实测了一个从未配置过的 QQ 群在升级后的表现。问题比"没人能应答权限请求"更严重：一次工具调用会让整个群卡住 5 分钟。

其余各项在 Linux 上全部重测通过，包括 daemon 模式，以及第 2 轮之后才合入 `main` 的入站媒体路径。flush 链上有 4 个门禁没有任何测试固定，见证测试已附上（不阻塞）。

验证 head `45bebb73966c8d3a76a7e8931e846670ad31abcf`，对照 base `1a933f7b5e`（即 merge-base，也就是本 PR 合并进来的那个 `main`）。环境为 Linux 6.12、Node 22.22。#8241 上的前两轮是 [第 1 轮](https://github.com/QwenLM/qwen-code/pull/8241#issuecomment-5270862724) 和 [第 2 轮](https://github.com/QwenLM/qwen-code/pull/8241#issuecomment-5963800765)，都在 macOS 上运行。本评论只写这两轮没覆盖的内容，外加核心主张在 Linux 上的重测。

**合并 `main` 没有带来任何产品代码变化。** `git diff 05f4fd89 a7c79f5f`（第 2 轮验证的 PR 补丁）与 `git diff 1a933f7b 45bebb73`（本 PR 补丁）逐行一致，只有两处上下文行不同：一处是 `import` 的相邻行，一处是从 #12850 保留下来的 `events.test.ts` 测试替身。因此第 2 轮的结论可以直接沿用。新的验证面在于这份代码与 `main` 上较新代码的交互。

### 结果（两个 arm 使用同一 harness、同一假平台）

| | 场景 | base `1a933f7b` | head `45bebb73` |
|---|---|---|---|
| S1 | 在 Linux 上重测核心主张：`qwen channel start qq`，零配置 `groupAllPolicy:"all"` | 路由键 `qq:U1:GA qq:U2:GA qq:U2:U2 qq:U3:GB`；跨成员召回 `NONE`；DM `/clear` 被当成共享会话拒绝；启动时打出强制 `single` 告警 | 路由键 `qq:GA qq:GB qq:U2`；召回 `PP-ALPHA`；GB 和私聊保持隔离；DM `/clear` 直接清空。**7/7** |
| S2 | **新增**：thread scope 下的入站图片（#12850） | 图片只进发送人自己的会话（U2 的 turn 看到 `FILES=0`） | 图片成为 GA 的群上下文（U2 看到 `FILES=1`），不会进 GB 或私聊。流式输出中途到达的图片 turn 会排队，并保持自己的 `msg_id`。**11/11** |
| S3 | **新增**：operator 发图片 steer 掉其他成员正在流式输出的 turn。两边都设 `sessionScope:"thread"`，所以唯一的差异是 seal/cancel 机制 | 被取消的部分输出 `chunk-1 chunk-2 chunk-3` 被拼进图片回复，锚在图片消息上 | 部分输出单独 flush，锚回被取消 turn 的 `msg_id`（steer 后 215 ms，其中含 200 ms 下载），图片回复单独发送。**7/7** |
| S4 | **新增**：daemon worker `qwen serve --channel qq`（第 2 轮只做了同构推理） | 与 S1 相同的"两个真相"（`routes.json` 为 `qq:U1:GA …`；DM `/clear` 被拒） | 与 S1 一致：`routes.json` 为 `qq:GA qq:GB qq:U2`。**7/7** |
| S5 | **新增**：未配置的群（无 `operators`、无 `approvalMode`）里的工具审批 | 请求者回 `/approve` 得到 "Permission approved."，工具执行 | 见发现 1 |

base 一侧 S1 通过 3 项、S2 通过 9 项、S3 通过 5 项、S4 通过 3 项；其预期失败（S1 4 项、S2 2 项、S3 2 项、S4 4 项）就是 base 上已知的缺陷，按预期失败记录。两边都没有意外失败。S2 和 S3 各跑了两次，结果完全一致。

![01-isolation-linux.png](./01-isolation-linux.png)

![02-media-shared-context.png](./02-media-shared-context.png)

![03-media-steer-boundary.png](./03-media-steer-boundary.png)

![04-daemon-mode.png](./04-daemon-mode.png)

![05-operators-gating.png](./05-operators-gating.png)

![06-mutation-matrix.png](./06-mutation-matrix.png)

### 发现 1 —— 新默认下，一次工具调用会让未配置的群卡住 5 分钟（需要拍板，不是代码缺陷）

测试部署是普通的 @ 机器人部署，没有设置 `sessionScope`、`operators` 和 `approvalMode`，也就是现有零配置部署升级后的状态。

1. 模型请求执行 `touch wedge.txt`，权限提示发到群里。
2. 请求者回 `/approve`，得到 "Only authorized members can answer permission requests in this shared session."。其他成员回复也是同样结果。
3. 工具没有执行，请求者的这个 turn 也始终没有收尾消息。**所有其他成员的消息都排在它后面。** U2 的提问在 **300.0 秒**后才得到回复，正好是 `AcpBridge` 权限请求超时（`ACP_PERMISSION_RESPONSE_TIMEOUT_MS`）的时刻。`/cancel` 也没用，它同样被排进队列（`steer denied … queuing instead`）。
4. 配上 `operators: ["U1"]` 后，U1 可以审批，群恢复正常。U2 仍被拒，这与文档一致。

base 上请求者可以审批自己的请求，工具会执行。启动 WARNING 确实会触发，但只输出到 stderr。所以 triage 提出的担忧是真实的，而且比它描述的更严重：一次需要审批的工具调用会让整个群静默 5 分钟，聊天里也没有任何人被告知原因。我看到的选项有：

- (a) 接受这个行为，在发布说明里写明群聊必须配置 `operators`。
- (b) `operators` 为空时，允许请求者应答自己的权限请求。这等同于 base 的实际行为，而且不授予群级控制权。这需要改 `ChannelBase`。
- (c) 保留本 PR 的路由修复，但在 (b) 或等价方案落地前先不把插件默认值改成 `thread`。

### 发现 2 —— flush 链上有 4 个门禁没有任何测试固定（不阻塞）

triage 问过 flush 链的归属门禁到底有没有被覆盖，540 个测试全绿回答不了这个问题。我对路由、锚点、代数、完成记录、边界、取消和 purge 各门禁做了 26 个单点变异，每个变异体放在 `src/__mut__/<id>/`，旁边有一份未变异的对照，一次 vitest 跑完。**其中 22 个被杀死**，对照 0 失败。

4 个幸存者都不是等价变异。每个都配了一个见证测试，在 head 上通过，只在对应的变异体上失败：

| 被变异移除的门禁 | 去掉后见证测试显示的问题 |
|---|---|
| `onPromptStart` 丢弃过期的孤儿 stash | 在 turn 计数器重置后残留的 stash 会被拼到下一个 turn 的回复前面：`"STALE-HEAD fresh answer"`。 |
| `isMsgSeqStillInUse` 把在途的锚定发送算作持有者 | 被取消 turn 的 stash 发送卡在 token 刷新时，后继 turn 一开始它的计数器就被回收，结果再次以 `msg_seq 1` 发出。QQ 按 `msg_id` + `msg_seq` 去重，这条消息会被静默丢弃。 |
| flush 链的 `.finally` 只释放属于自己 state 的 `flushingSessions` 标记 | `onSessionDied` 之后，被取代的旧链收尾时会清掉后继 turn 正在使用的 flush 标记。 |
| `onPromptStart` 清空 `completedTurns` | 跨 teardown 保留的完成记录会错配到重启后的 turn 上，导致该 turn 的 sealed head 提前作为单独消息发出，而不是等着拼进回复。 |

`msg_seq` 和 `flushingSessions` 两个见证完全由真实方法调用构造。另外两个各注入一条 Map 记录，注入的状态是代码注释自己说明可达的：teardown 在 flush 标记存活时会保留 `completedTurns`；`deleteTurnGenerationIfOwned` 会重置计数器，但不清 stash。见证测试放在 assets 目录（`harness/witness/`），加进 `stream.test.ts` 即可固定这 4 个门禁。这不阻塞合并：代码本身是对的，只是测试套件没有证明这 4 处。

### 发现 3 —— 需要再合并一次 `main`（仅文档）

`main` 已前进到 `612a5529`（#12939，email channel）。`git merge-tree` 报告一处冲突，在 `docs/users/features/channels/overview.md`：本 PR 重排了选项表，`main` 在 `type` 行加了 `email`。解决办法是保留本 PR 的表格，再补上 `email`。合并后的树上 qqbot 540/540、channel-base 1463/1463。同一个 `main` 提交还给 `ChannelBase` 加了 `canStartInboundTurn()` 钩子（默认返回 `true`），QQ 没有覆盖它。

作者推这次合并时，正好可以把 triage 要求的注释轮次标签清理（`R9-1`、`R12-*`、`R21 acceptance`）一起做掉。下面的 harness 能让新 head 的复测成本很低。

### 门禁（head）

| 门禁 | 结果 |
|---|---|
| `packages/channels/qqbot` 下 `npx vitest run` | 8 个文件，**540 通过** |
| `packages/cli` 下 `config-utils.test.ts` | **120 通过** |
| `tsc --noEmit`（qqbot） | 无错误 |
| 对改动的 `.ts` 文件跑 `eslint --max-warnings 0` | 无问题 |
| 对全部 9 个改动文件跑 `prettier --check` | 无问题 |
| 与 `main` `612a5529` 合并并解决冲突后的树 | qqbot 540、channel-base 1463 |

### 未覆盖

- 真实 QQ 凭据和生产平台。本轮没有在 macOS 或 Windows 上运行（第 2 轮是 macOS）。
- Gateway RESUME/重连、cron 流程、视频附件（只测了图片）。purge 升级路径：第 2 轮已端到端实测，本轮只用变异覆盖了它的 4 个门禁。
- 图片作为图像内容传给模型。假模型是纯文本模型，附件以文件路径（`FILES=`）的形式到达，而不是图像内容。文件引用已足以说明媒体进了哪个会话。
- 构造两个注入型见证前置状态的自然时序。

### 方法

我建了 head 和 base 两个 worktree，各自用 pnpm 安装并全量构建；每个 arm 运行自己的 `packages/cli/dist/index.js`。

假 QQ 开放平台提供 token 端点、`/gateway`，以及 WSS gateway（HELLO/IDENTIFY/READY/HEARTBEAT/DISPATCH）。它还记录 `/v2/{groups,users}/:id/messages` 的出站消息，并通过 `multimedia.nt.qq.com.cn` 提供附件下载。全部跑在真实 TLS 上，使用 harness CA（`NODE_EXTRA_CA_CERTS`），SNI 和主机名校验都是真实的。

`qwen channel start` 通过 `--require` DNS 预加载连到假平台。`qwen serve` 会把 `NODE_OPTIONS` 从 worker 环境中清除，所以 daemon 那几轮改用临时的 `/etc/hosts` 条目，跑完已删除。

模型是一个录制型的 OpenAI 兼容服务，回答只取决于它收到的历史（`RECALL=`、`FILES=`、`SLOW:n`，以及一次 `touch` 工具调用）。harness、见证测试、ledger、channel 日志和每次运行的结果见 [`pr-13250/`](./)。
