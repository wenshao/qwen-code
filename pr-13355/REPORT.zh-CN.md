## 维护者验证：PR #13355 @ `4e6a855`

**结论：** 三项修复我都用实际执行验证过，新测试也能分别抓住它们。**但当前状态不能合入。** #13301 已于 05:45Z 合入 `main`（`32291910a5`），本 PR 的 `V35__managed_task_event.sql` 与 `main` 的 `V35__managed_session_tool_profile.sql` 撞了同一个 Flyway 版本号。因为文件名不同，GitHub 仍显示 MERGEABLE/CLEAN，而 `main` 没有必需检查。现在合入，服务会**直接起不来**。把迁移改名为 `V36`（再改每种语言各两行文档）即可修复，改号后的结果我已端到端验证。其余发现都不阻塞合入。

![合并安全](fig1-merge-v35.png)

### 合入前必须处理
1. **把 `V35__managed_task_event.sql` 改名为 `V36__managed_task_event.sql`**，并把 `docs/design/2026-09-27-managed-extension-authority.md` 第 102、146 行（`.zh-CN.md` 同样两行）里的 `V35` 改成 `V36`。没有测试钉住这个版本号。#13301 的迁移测试用的是 `target("34")`，不受影响。

   改号后的合并树（main `1fb5a71` + 本 head）我做了三项检查：
   - Flyway 门禁通过，36 个版本全部唯一。
   - 在 MariaDB 10.11.18 上跑 `mvn -Pmysql-integration clean verify checkstyle:check` 通过：单测 569/0/0，IT 52/0/0，checkstyle 违规 0，SpotBugs 0。
   - 从 `main` 的 schema 升级（先停在 `target=35`，再完整迁移），V36 正常应用。

   你在 Risk & Scope 的 (a) 条已预见到这次撞号，只是先合入的兄弟 PR 是 #13301，不是渠道 lane。之后 `main` 已前进到 `55b1faf`，本 head 仍可无文本冲突合并。`1fb5a71` 之后 `sdk-java` 唯一的改动是 #13365 的重放探针修复，与本 PR 的代码路径无交集。

### 不阻塞（可随 #13300 的 Suggestion 组处理）
2. **新 Javadoc 的承诺仍然过宽。** 原文是「authority 下次打开会拒绝的行，这里就拒绝，因此没有提交能让它写入的 Session 变砖」。triage 评审指出了一个反例，我**端到端执行确认了 7 种形态**：head 存储都回 `200`，之后 TypeScript authority 重开会话时变砖：
   - 非 genesis 事务的事件位上放一行外来 subtype（即 triage 评审指出的位置）；
   - payload 为空的 `input.accepted`；
   - 缺少 `payload.text` 的 `message.delta`；
   - payload 带未知键的 `message.delta`；
   - 畸形的 `subject`；
   - 缺少必需 activation subject 的 `message.delta`；
   - `eventsDigest` 与事件不符的提交 marker。这一条不是事件行，且在本 PR 之前就存在。

   根因是 TS 读取器会校验每种 kind 的 payload schema（`EVENT_SCHEMAS`、`assertPayloadRules`）和 subject 规则，而 Java 存储只镜像了信封和词汇表。每种形态都要求有写方在内部提交路由上绕过契约；真实的 `HttpManagedSessionStore` 发送前会逐行解析事件。这与本 PR 自身负例的前提相同。建议二选一：把那句话（以及 PR 正文对应表述）收窄到信封与词汇层，或者后续通过契约 fixture 镜像每种 kind 的 schema。
3. **保留事件 id 是 authority 的写入方拒绝的，不是重开读取器拒绝的。** 在 base 上，存入一行 `mcp_configuration:1` 后会话能正常重开。问题出在之后：该会话的第一条 MCP configuration 记录会被永久拒绝，报 `event id mcp_configuration:1 is already committed`。head 会拒绝这一行，同样的后续提交能成功。所以代码是对的，但就这一例而言，PR 正文（「重开读取器执行的保留 id 命名空间」）和测试注释（「下次打开时让读取器变砖」）的表述不准确。
4. **变异结果：** 23 个变异杀死 19 个。
   - `id(eventId)` 与 `id(operationId)` 是生效的检查：非 NFC 的 id 在 base 上会变砖，在 head 上被 409 拒绝。但没有测试钉住它们，禁用任一项所有测试仍然全绿。
   - 新增的两处事件行 1 MiB 上限是等价变异：`apply` 运行之前，`validateUtf8JsonLines` 已对每行做了 1 MiB 限制。只有 64 KiB 的 marker 上限是新增的行为。
5. **triage 评审关于错误码的观察，我执行确认了。** 用 base 的校验时，`ManagedActionsTest.rejectsMalformedActionJournalWithoutProjectingIt` 得到 `managed_session_action_rejected`；用本 PR 时得到 `managed_session_extension_record_rejected`。建议在 Risk & Scope 里补一句。
6. **可达性。** 修复 1 目前 `executionOf` 还没有生产调用方。修复 3 现在同样是潜在缺陷：`announce` 只对带 `taskKind` 的 body（`monitor_run`）触发，而 `monitor_run` 不在 TS 的 `MANAGED_SESSION_ENABLED_DOMAINS` 里，也没有生产 TS 写方提交它。所以在 H3 开放该 domain 之前，劈 Part 只能经内部提交路由触达。修复 2 在 HTTP 信任边界上可达。任务事件 outbox 目前只写不读：既没有读取方也没有保留策略，PR 已说明。

### 证据
- **PR head 门禁（本地 JDK 21，命令与 CI 相同）：**
  - MariaDB 10.11.18：553/0/0 + 52/0/0（`ManagedAgentMySqlIT` 19/0/0），checkstyle 0，SpotBugs 0。
  - MySQL 8.4.11：结果相同。
  - TS 两个契约测试 170/170。
  - TS `src/managed-runtime` 全量 1932/1932。你本地遇到的那条 `hook-scale` 超时，本机没有复现。
- **合并 main 并改号 V36 后：**
  - MariaDB 车道：569/0/0 + 52/0/0。
  - Hosted 故障门禁车道（真实 `dist/cli.js` + Spring + MySQL 8.4.11）：surefire 569/0/0，Hosted IT 18/0/0（7 个类，`check-failsafe-reports.js hosted` 通过），checkstyle 0，SpotBugs 0。真实 authority 在库中留下 1,679 个日志事务（51 个会话、1,770 行事件），更严格的存储全部接受。这些事件覆盖 16 种 kind 中的 12 种，其中 1,256 行带 subject。
- **跨语言差分（22 例，见图 2）。** 环境：base 与 head 两份真实 Spring jar 跑在 MySQL 8.4.11 上，由真实 TS authority 驱动。每例都是在真实事务里注入单一缺陷，再由新的 writer 走生产读路径重开。结果：
  - **base** 存下全部 13 种拒绝形态，其中 11 种在重开时变砖；保留 id 那一种会卡死 MCP domain。
  - **head** 对 13 种全部回 409，所有会话都能正常重开。
  - **两臂**都接受 7 种残留形态，这些会话都会变砖。
  - **对照组**在两臂上都能提交并重开，其中包括一条真实 authority 写出的 MCP 记录（经过更严格的 head 存储）。
  - **合并 main 并改号后**的服务，22 例判定与 head 完全一致。
![跨语言差分](fig2-cross-language-differential.png)

- **修复 3（见图 3，数据从存储读回）：** head 上两段增量同属一个 Part，文本为 `"onetwo"`。把宣告改回事件流（即 main 的行为）后，`task.updated` 占了序号 3，第二段增量另起一个 Part，消息被存成 `"one"` 和 `"two"` 两段。
![劈 Part](fig3-part-split.png)

- **测试有效性（见图 4）：** 我在 head 上逐项回退：
  - 回退修复 1：只有 `settled-cancelled-unclaimed` 一行变红。
  - 回退修复 2：`refusesEventLinesTheAuthorityWouldRefuseAtReopen`、`no commit marker` 标签和 `ManagedActionsTest` 的错误码变红。
  - 回退修复 3：`keepsOneTextPartAcrossATaskAnnouncement` 及两处 outbox 断言变红。

  base 生产代码跑本 PR 的测试，120 个中红 6 个，正好是三者的并集。
![回退与变异矩阵](fig4-revert-and-mutation.png)

- **outbox 并发（MySQL 8.4.11）：** 16 线程 × 40 次 `appendLiveSessionTaskEvent` 写同一会话，得到 640/640 行，序号 1..640 连续，0 错误。负对照：去掉会话行的 `FOR UPDATE` 后，575/640 次报 `DuplicateKeyException`。说明这把锁是承重的，探针也确实能失败。
- **未验证：** MySQL 8.0，以及 Java 车道的 Windows/macOS（由 CI 覆盖）。我没有尝试在真实 Hosted 回合中途提交 `monitor_run`，因为目前没有任何东西会产生它。

工具：[`harness/`](harness/)；原始数据：[`data/`](data/)；English: [REPORT.md](REPORT.md)
