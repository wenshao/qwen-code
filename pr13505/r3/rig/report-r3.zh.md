## 真实环境验证（第三轮）：`3261e4d4`

**验证对象：** `3261e4d4`，在第二轮 head 之上多了两个提交：
- `0aa09f1c`：合入 main `ac81c07d`。我用 `git merge-tree` 重新计算过，它的树与 git 自动合并结果逐字节相同，没有手工解决的冲突。
- F3 修复提交。

**试合并：** 把 `3261e4d4` 合入当前 main `ac497aee`（main 又多了 2 个提交）。装置与前两轮相同：Spring Session Store 跑在原生 MySQL 8.4.7 上，写入走真实 TS authority + HTTP，另有一个经原始 HTTP 提交的第二写入方。

> **修订说明**：我首次发布本评论后才发现，第三轮进行期间（17:43），`/review` bot 对 `0a1b1d2e` 提交了 CHANGES_REQUESTED，我发布前没有读到。其中 4 条 Critical 在 `3261e4d4` 上全部复现，下面的结论取代原来的"可以合入"。

### 结论

**暂不能合入：需先处理 `/review` 的 Critical R1-1…R1-4。** 四条在当前 head 上全部复现，TS 与 Java 表现一致。R1-1、R1-2、R1-4 的候选补丁已验证（见英文部分）；R1-3 需要作者做一个设计取舍。

第一、二轮的结论在 head 与试合并上仍成立：F1–F4 已关闭，与我验证过的内容一致。`3261e4d4` 上两条 CI 红腿在不含本 PR 的 main 上同样复现。

### `/review` 在 `0a1b1d2e` 上的 Critical，在 `3261e4d4` 上复核

每条都用当前 head 的真实校验器（h3 的 TS dist + h3 jar）实测；R1-1 另外走了 Hosted Harness 的 `/session/:id/load` 路由。

- **R1-1**：`verifyWorkspaceRestore` 对每一条 `child_run` 修订都调用 `parseChildShellRun`。
  - Session 日志里只要多一条 child_agent 记录，加载就返回 **409 `hosted_turn_recovery_required`**；没有这条记录时同一 Session 返回 200。
  - 改为按 kind 解析、跳过 child_agent（它没有输出 manifest）后返回 **200**，原有 4 个恢复用例照常通过。
- **R1-2**：`running_attached` 带 `childSessionId` 但 `runtime: null` 时，两侧都**接受**；之后补 runtime 的修订会被拒，这个 run 永远无法绑定。候选补丁后两侧都拒绝。
- **R1-3**：`dispatch_started` 时没有 `definition` 也会被**接受**，之后补 pin 会被拒。候选补丁未包含这一条。
- **R1-4**：`C:/evil`、`c:/evil`、`C:evil`、`D:/outside`、`C:/Windows/System32` 两侧都**接受**。候选补丁后全部拒绝；`.`、`worktrees/child-1`、`/tmp`、`a\b` 的结果不变。

**更正我第二轮的说法**：第二轮我把 cli 调用方列为已正确迁移。R1-1 是 F3 的镜像：这条恢复路径会遍历整个 domain，用 shell 专用解析器在这里会失败关闭。它和 F3 一样，在 H4b 启用 `child_run` 之前不会触发；启用后，所有跑过 child agent 的 Session 都会无法恢复。

**建议守卫在 PR 自身套件上的影响（TS）**：
- R1-4（正则 `/^[A-Za-z]:/`）：340/340，测试无需改动。
- R1-2：按 bot 建议的位置放，判定结果不变，但 8 个非法 fixture 的报错条款会变，导致这些用例失败；放到最后（遵循 TS 的条款顺序，与 F1 相同）则 340/340。
- R1-3（派发后必须有 definition）：13 个测试失败，因为 authority 套件的 `runBlock()` 派发时 `definition` 为 null。采纳的话，测试构造器要先 pin definition，这需要作者决定。

**候选补丁（R1-1 + R1-2 + R1-4，基于 `3261e4d4`）**：TS + Java + 3 条共享 fixture + 1 个恢复测试，共 135 行。
- Java 契约 + store：36/36，checkstyle 通过。
- TS 聚焦 6 个文件：381/381；cli 3 个文件：232/232。
- core 与 cli 的 `tsc` 通过，eslint 与 prettier 通过。
- 差分（57.4 万条）：0 条分歧。
- 见证：
  - 去掉 Java 修复，Java 契约测试失败（`agent-attached-without-runtime`）。
  - 去掉 TS 修复，3 条新 fixture 失败。
  - 去掉 R1-1 修复，恢复测试失败（`expected 409 to be 200`）。

**候选补丁未覆盖的两个小缺口**：
- `dispatch_started` 且 `runtime: null` 仍被接受，这种 run 永远无法 attach。如果要求派发时必须有 runtime，需要放过 `not_started_proven`：有两个合法 fixture（`agent-creation-failed`、`agent-cancel-before-dispatch`）就处于这个状态。
- `workingDirectory` 仍接受 Windows 设备名（`CON`、`NUL.txt`）。

### 改动与核查

- **F3 修复与测试与第二轮一致**：
  - `local-shell-stream-result-session.ts` 的改动（`parseChildShellRun`）与第二轮候选逐字节相同。
  - 新增测试只差一个注释用词（"call id" 与 "key"）。
  - J7b 的 store 用例和 T7b 的 authority 用例与第二轮逐字节相同。
  - 在 `3261e4d4` 上，针对 child_agent 记录的后台 Shell 捕获**被拒**；PR 自带的用例通过（该文件 6/6）。
- **head 上的变异**：除既有的 J9 外全部被杀。包括 J1–J8、J7b、JF1–JF3、T1–T8、T7b，以及把 import 改回 `parseChildRun` 的 **TF3**。
- **差分（57.4 万条）**：head 与试合并都是 0 条分歧。main 把公共 helper `closed()`/`id()` 改成了惰性生成错误文案，但没有改变任何文案；措辞差异清单与第二轮完全相同。
- **真实栈（head 与试合并）**：
  - 23 行探针与第二轮完全一致：7 个非法身份全部 409；10 种交叉记录违规全部 409；2 个对照组 200。
  - 结算修订引用 Session 没有的结果或回执时，返回 409 `managed_session_resource_missing`；对照组 200。
  - 原始 HTTP 写入的对照行能通过 #13355 更严格的 event 行校验，说明装置本身没有被误拒。
- **回归套件**：
  - TS 聚焦 6 个文件：两臂都是 378/378。
  - PR 的 `ManagedExtensionRecordStoreTest` 跑在 MySQL 8.4.7 上：22/22。数量是 22，是因为 #13355 改动了 main 上的这个测试类，作者已说明。
  - 试合并上 Java MySQL IT：53/53。
  - 试合并上 TS cli-serve：233/233。
  - 试合并上 TS managed-runtime：只有一个 hook-scale 的 15 s 超时，与前两轮是同一类。

### 两条 CI 红腿来自 main

| CI 车道 | 失败内容 | 本 head（本地） | 纯 main `ac81c07d` |
| --- | --- | --- | --- |
| `Test (ubuntu-latest, Node 22.x)` | cli `acp-integration/session/Session.test.ts` 中 2 个用例（tool_call 桥接拒绝文案） | 同样 2 个失败 | 同样 2 个失败；已由 #13522 跟踪 |
| `Runtime Broker and Managed Agent MariaDB / Java 21` | 作业触到 15 分钟上限被取消 | — | main 自己在 `ac81c07d` 上的同一作业（37496091771）也是 15 分钟时被取消 |
| 同一车道的单元测试 | `ManagedSessionStoreIntegrationTest.holdsRestorePagesInsideThePerPageByteBudget` → 409 "Record line 1 is not an event line…" | head 与试合并上同样报错 | 同样报错 |

store 测试的失败是 main 上的合入顺序冲突：#13348 在 15:51 加了这个测试，#13355 在 16:29 加了更严格的 event 行校验。本 PR 没有改动其中任何文件，合并提交也与 git 自动合并结果一致。这个 store 测试我还没找到对应的 issue，main 的失败机器人可能会补建。

### 仍未关闭（不阻塞）

- **J9（本 PR 之前就存在）**：把非任务行的 `task_state` 置空的那个表达式，没有任何测试钉住。
- **H4b 的 delivery 与 acceptance 方向问题**：已记入设计文档的后续工作表，行为不变。
