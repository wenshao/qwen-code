## 真实环境验证（第三轮）：`3261e4d4`

**验证对象：** `3261e4d4`，在第二轮 head 之上多了两个提交：
- `0aa09f1c`：合入 main `ac81c07d`。我用 `git merge-tree` 重新计算过，它的树与 git 自动合并结果逐字节相同，没有手工解决的冲突。
- F3 修复提交。

**试合并：** 把 `3261e4d4` 合入当前 main `ac497aee`（main 又多了 2 个提交）。装置与前两轮相同：Spring Session Store 跑在原生 MySQL 8.4.7 上，写入走真实 TS authority + HTTP，另有一个经原始 HTTP 提交的第二写入方。

### 结论

**从本 PR 角度看可以合入。** F3、F4 按第二轮验证过的内容原样落地；第一、二轮的所有检查在 head 和试合并上仍然成立。`3261e4d4` 上的两条 CI 红腿，在不含本 PR 的 main 上同样复现，会随 main 修复而消失。

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
