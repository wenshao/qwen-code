## 真实环境验证（第四轮）：`e4b7f0fc`

**验证对象：** `e4b7f0fc`，即修复提交 `27ba5c26` 加上合入 main `ac497aee`；这次合并的树与 git 自动合并结果逐字节相同。

**试合并：**
- **m4**：合入本轮开始时最新的 main `f3385785`。
- **最新 main `a764fb96`**（只验证 Java）：它包含 #13551，修好了第三轮那个 main 红用例。

**装置：** 与之前相同。Spring Session Store 跑在原生 MySQL 8.4.7 上，写入走真实 TS authority + HTTP，另有一个经原始 HTTP 提交的第二写入方，让 Java store 独立做判断。

### 结论

**代码层面可以合入。** 两份评审标为阻塞的问题全部修复：R1-1…R1-4，以及 yiliang114 的两个 P1；两个 P2 也已修复。
- 每项修复都在 TS 和 Java 两侧同步实现，拒绝文案一致，并在 head 与试合并上用真实栈验证过。
- 差分 122 万条，两侧零分歧。
- 每条新规则都有用例钉住：删掉它，PR 的测试就会变红。

**合入前**：
- **两份 CHANGES_REQUESTED 仍然有效**：bot 针对 `0a1b1d2e`，yiliang114 针对 `3261e4d4`，需要评审各自解除。
- **建议再合一次当前 main**：本 head 上两条红的 Java 车道来自 main，#13551 已在 main 上修复。我在本地合入 `a764fb96` 后，Java 全量 1047 个 0 失败 0 错误，IT 53/53。
- **留意与三个相关 PR 的合入顺序**（见文末）。

### 修复在真实栈上的表现

每条链都构造成只有新规则这一个拒绝理由。TS = 真实 authority，Java = 原始 HTTP 写入方。

- **派发时须 pin definition**（R1-3 / P2）：h4 与 m4 上 TS 拒绝、Java 返回 409。
- **已 attach 的子 Session 须有 Runtime 绑定**（R1-2 / P1）：同上。
- **`workingDirectory` 不得带盘符**（R1-4 / P1）：同上。
- **一级子任务的 `rootSessionId` 必须是本 Session**（新规则）：同上。

对照组与补充：
- 二级子任务带外部根时可以提交（TS 提交成功、Java 200）；一级子任务以本 Session 为根时也可以提交。所有 Session 都能重开，两侧拒绝文案一致。
- **runtime**（yiliang114 所说的"没有 Runtime 绑定也能 settle"）：head 采用的是窄守卫（有 Session id 就必须有绑定）。我逐一检查了派发时 `runtime: null` 的 run 还能走到哪些终态，两侧结果一致：
  - 能走到：只有"从未启动"（`creation_failed`、`not_started_proven` 下的停止）和 `recovery_blocked`。
  - 被拒：`running_attached`、`settled/completed`、`failed/child_failed`、启动后取消。
  - 所以这类 run 已经无法 settle。
- **`resultVersion: 1e400`**：Java 已加有限性守卫；经 HTTP 提交时 store 的读取器本来就会先拒绝（409），两条路径都能干净地拒绝。
- **R1-1 恢复**：PR 新增的测试在把解析器改回 `parseChildShellRun` 时会失败（`expected 409 to be 200`）。跳过 child_agent 的那一行只是防御性的：`parseChildRun` 已经能解析这条记录，而它本身没有 `outputRef`。

### 一致性、跨版本行为与变异

- **差分（TS ↔ Java）**：
  - 以本轮 fixture 为种子的 644,324 条，加上第一轮的 573,903 条。
  - head 与试合并上都是 **0 条分歧**；剩余的文案差异仍是第二轮那 108 种纯措辞差异。
- **跨版本（`3261e4d4` → `e4b7f0fc`，同一语料，TS 与 Java 结果一致）**：
  - 判定变化只有新增的拒绝：runtime 22 条、definition 5 条。
  - **shell 记录 0 条判定变化**：stop-reason 去重只改变了多处损坏的 shell 记录先报哪条，Java 也同步了这个顺序。
  - **后继对 0 条判定变化**：删掉 result/receipt 的 set-once 规则没有改变任何迁移的判定。
- **真实栈**：第一至三轮的 23 行探针与第三轮完全一致。
  - 结算修订的资源闭包：409 / 409 / 200。
  - delivery 与 acceptance 方向的行为不变，已为 H4b 记录在设计文档中。
- **变异（PR 套件，`e4b7f0fc`）**：32/33 被杀死，唯一存活的是既有的 J9。
  - 第四轮的每条新规则在两侧都被杀死：definition、runtime、盘符、rootSessionId 绑定，以及 Java 的两处有限性守卫。

### 回归套件

SUITES_ZH

### 与相关 PR 的合入顺序

- **#13550（H4b）叠在本分支上**：#13505 squash 合入后，需要把 #13550 的 base 改到 `main`，并预期两者都改过的文件会有冲突。
- **#13536（H6a）和 #13548（H5a，草稿）的 base 是 `main`，与本 PR 在记录体注册表上有文本冲突。** 另外，它们新增的契约测试调用了 `Body.taskKind()`，而本 PR 已把它换成 `taskKindOf`：
  - #13536 的 `ManagedAutomationRecordContractTest.java:49-50`。
  - #13548 的 `ManagedChannelRecordContractTest.java:27`。

  这些文件能自动合并，但编译不过，后合入的一方需要改用 `taskKindOf`。

### 仍未关闭（不阻塞）

- **Windows 设备名和末尾点/空格**（`CON`、`NUL.txt`、`childA.`）仍被接受。作者把它们推迟到 H4b 的 workspace 绑定步骤，按真实文件系统解析，这个理由成立。但要注意：`workingDirectory` 是冻结字段，"以后再收紧字符串规则"只在 H4b 启用 `child_run` 之前是零成本的；启用之后再收紧，已写入的记录会变得无法解析。
- **J9**（既有问题）和 **H4b 的 delivery 与 acceptance 方向问题**（已记入设计文档）保持不变。
