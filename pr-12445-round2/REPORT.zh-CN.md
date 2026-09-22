## 验证第 2 轮 — PR #12445 @ `66d1aedb`

**结论：修掉一处小的编解码问题后即可合并。** 补丁附在下方，已在当前 head 上验证。

第 1 轮（[评论](https://github.com/QwenLM/qwen-code/pull/12445#issuecomment-5771498818)，基于 `30cfe50`）没有发现正确性缺陷，并在未覆盖项中列出了 "No fuzzing of nested/edge payloads"（未对嵌套/边界载荷做 fuzz）、"Real MySQL 8"（未跑真实 MySQL 8）和 "Higher concurrency … No soak or deadlock-detection run"（更高并发，未做长时间运行或死锁检测）。之后的 `/review` 提出了 R1-1，即同一编解码的类型保真问题，已在 `f724def` 修复。本轮在 `66d1aedb` 上完成了载荷 fuzz 和真实 MySQL 测试；并发一项只覆盖了一部分：6 个 JVM 共 48 个线程、开启死锁检测，但每次只跑 25 秒，不算长时间运行。缺陷正是在载荷 fuzz 中发现的。

Repository 逻辑本身是可靠的：
- `mysql-integration` 契约在 MySQL 8.4.11、MySQL 8.0.46、MariaDB 11.4.13 上都通过。
- 6 个 Broker JVM 竞争同一张表，三个引擎上都没有任何 execution 被派发两次。两台 MySQL 在全部运行期间 `ER_LOCK_DEADLOCK` 均为 0（`innodb_deadlock_detect` 开启）。
- 与已合并的内存实现做锁步差分 fuzz，没有出现分歧：H2 上 180,000 次操作，MySQL 8.4.11 上 24,000 次操作，两个数都包含租约过期步骤。
- `66d1aedb` 的大小写敏感 execution id 键解决了第 1 轮 `/review` 提出的排序规则问题：在 MySQL 8.4 和 MariaDB 11.4 上，`EXEC-A`、`exéc-a`、`exec-a ` 现在都与 `exec-a` 区分开。

缺陷在 JSON 编解码。读取那一行从第 1 轮至今没有变化；写入那一行只因 R1-1 加了 `WriteNulls`。
- **`$ref` 被解析。** fastjson2 读取 `reference_json`/`result_json` 时，会把 `$ref` 成员当作它自己的回引用来解析。在我的测试中，只要 `$ref` 是对象的第一个成员、值以 `$`、`@` 或 `.` 开头，就会触发：载荷要么读回时被改写，要么根本读不出来。以 `#/…` 开头的 JSON Schema 引用、绝对 URL、以及不在首位的 `$ref` 都能原样保留。
- **`@type` 的处理。** 带类型的读取器（`TypeReference<Map<String, Object>>`）也会特殊对待 `@type`：当一个对象是存储 map 的直接值（例如 `output`），且其首个成员是非字符串的 `@type` 时——
  - 数组、布尔、数字和对象会被读回成字符串（JSON-LD 的 `"@type":["Product","Thing"]` 读回为字符串 `["Product","Thing"]`）；
  - `null` 会让该行无法读取（`JSONException`）。

  字符串形式的 `@type`、以及嵌套更深或位于列表中的对象，都原样保留。
- **指数形式的数字。** fastjson2 会把以指数形式写出的数字读回成 `double`。

一处编解码改动即可修掉这三个问题：改用不带类型的读取器并关闭引用检测，写出时把 BigDecimal 写成普通文本。R1-1 修复还遗留了一个 float/double 比较问题，由另一处单个方法的改动修掉。

这也意味着 PR 摘要中 "JSON identity comparison preserves finite numeric values … across persistence"（JSON 身份比较在持久化前后保留有限数值）的说法需要限定。一个有限的 `BigDecimal("1E+400")` 能通过写入时的非有限检查，以 `1E+400` 存储；读回时变成 `Double` Infinity，此后每次读取都会被拒绝。

尽管模块还没接入，我仍建议合并前修复：
- 修复只是本 PR 新引入代码中的几行。
- 读取侧的改动可以事后挽回含 `$ref`/`@type` 的行，但写入侧的选项不能追溯：已经以指数形式写入的行会保持原样。在第一行数据写入之前修复，没有任何代价。

### 1. 读取时 `$ref` 和 `@type` 成员被改写

![fig1](fig1-service-over-jdbc.png)

测试方式：在 MySQL 8.4.11 上运行 `RuntimeBrokerService`，binding、session、execution 三个 Repository 都是真实的 JDBC 实现；Harness resolver、provisioner 和 transport 用桩代替。对照组使用已合并的内存 Repository。

| 载荷 | `66d1aedb` | 内存实现，以及打补丁后 |
| --- | --- | --- |
| Runtime 结果 `output = {"$ref":"@"}` | `createExecution` 和我做的那次重试都抛出原始的 `StackOverflowError`，而不是 `RuntimeBrokerException`。该行为 SETTLED，但读不出来。 | 正常 |
| Harness reference 含 `"schema":{"$ref":"$"}` | `createExecution` 返回 503 `runtime_execution_dispatch_failed`，该行停在 **PREPARED**。重试和 `cancelExecution` 都抛 `StackOverflowError`。两次 `release()` 都返回 **409 `runtime_session_busy`**。`hasActiveByRuntimeSession` 不解析 JSON，所以一直能看到这条未完成的行，而所有出路都要先读这一行。 | 正常 |
| 结果内嵌 OpenAPI `{"$ref":"./common.yaml#/components/schemas/Error"}` | 每次读取都抛 `JSONException`。 | 正常 |
| 结果 `output = {"$ref":"$.executionStatus"}` | output 读回来变成字符串 `"success"`。 | 正常 |
| 结果 `output = {"@type":["Product","Thing"], …}`（JSON-LD） | `@type` 读回来变成字符串 `["Product","Thing"]`。 | 正常 |
| 结果 `output = {"@type":null, …}` | 每次读取都抛 `JSONException`。 | 正常 |

存储的文本是完好的，变的只是读回的值。这张表一旦接入，一个 Tool 结果就可能触发这个问题，例如 MCP server 返回的结构化输出，或首个成员是相对外部 `$ref` 的 OpenAPI 文档。视成员不同，对应的行读回时要么被改写，要么读不出来；如果出现在 reference 中，Runtime Session 也将无法释放。

**修复（读取器）：** `JSON.parseObject(value, JSONReader.Feature.DisableReferenceDetect)`。不带类型的读取器返回 `JSONObject`（它本身就是 `Map<String, Object>`），会把 `@type` 当作普通成员保留；该选项则阻止 fastjson2 解析 `$ref`。如果保留 `TypeReference`、只加这个选项，只能修掉 `$ref`，修不了 `@type`。

### 2. 往返后变样的数字

![fig2](fig2-payload-fidelity.png)

图 1 的 S5–S8 把下列数值分别放进 Harness reference，经 Service 调用：
- **BigDecimal `1E+400`：** `createExecution` 返回 503。重试返回 409 `runtime_execution_conflict`：读取时的 `IllegalArgumentException` 在 `findOrCreate` 外层被捕获，报成 "execution identity is already in use"。`release()` 返回 409 `runtime_session_busy`，与 `$ref:$` 一样，会话被卡死。
- **BigDecimal `1.2345678901234567890123E+30`、Float `162544.13f`、Double `-1363683.0538119469`：** 一次正常的重试返回 409 `runtime_idempotency_conflict`。

原因有两个：
- **写出选项，针对正指数的 BigDecimal。** fastjson2 的写出器把正指数的 BigDecimal 写成指数形式，而读取器默认把指数形式解析为 `double`。`JSONReader.Feature.UseBigDecimalForDoubles` 在 2.0.60 里帮不上忙：它会把 `1.2345678901234567890123E+30` 读成 `…E+60`。修复方法是 `JSONWriter.Feature.WriteBigDecimalAsPlain`。默认写出器本来就会展开负指数，`1E-100000` 在 `66d1aedb` 上写出 100,008 个字符；该选项对正指数做同样处理，`1E+100000` 从 15 个字符变为 100,007 个。所以无论改不改，都值得在 `BrokerValues` 里给 BigDecimal 加一个大小上限。
- **比较方式的改动，针对 float 和 double。** R1-1 引入的规范化比较会把数字的文本转成 `BigDecimal`。fastjson2 为 float/double 写出的文本，读回后二进制值相同，但位数不一定与 `Float.toString`/`Double.toString` 一致：
  - `162544.13f`：`Float.toString` 给出 `162544.12`（精确值 162544.125）。
  - 上面那个 double：`Double.toString` 给出 `-1363683.053811947`。

  在各 100,000 个随机位模式中，有 418 个 float、1 个 double 往返后比较不相等。这处改动可以与编解码改动分开：没有它时，只有 Float/Double 值受影响（S7/S8）。它在任一操作数为 Float 或 Double 时按 float/double 精度比较，因此 `Long` 2^53+1 会与 `Double` 2^53 判为相等。它还依赖写出选项：如果没有 `WriteBigDecimalAsPlain`，它会掩盖指数形式 BigDecimal 的精度丢失。

我还在 MySQL 8.4 上用 3,000 个随机 JSON 载荷经真实 Repository 做了往返。生成器有意多放 `$ref` 成员和大数，且不含 `@type` 成员，所以下表的失败比例不代表真实世界的发生率。

| 版本 | 出问题的载荷 |
| --- | --- |
| `66d1aedb` | 3,000 个中 403 个：175 个被改写，90 个 `JSONException`，138 个 `StackOverflowError` |
| 只做编解码改动 | 3,000 个中 1 个 |
| 完整补丁 | 3,000 个中 0 个 |

### 3. 行锁和"拒绝他人有效租约"都没有被测试钉住（补丁附带测试）

![fig3](fig3-multi-jvm-race.png)

我在 `66d1aedb` 上做了单守卫变异测试：PR 自带测试杀死 58 个变异体中的 25 个。相对 #12458 的状态新增的测试（只差大小写的 id、更多非有限值用例）没有多杀死任何变异体，存活集合仍是同样的 33 个。最关键的两个存活者：
- **M50（去掉 `FOR UPDATE`）。** PR 测试仍然全绿，但在 MySQL 8.4 上的 6-JVM 竞争中：
  - 有 3 个 execution 被派发两次；
  - 有 431 个 execution 出现同一 dispatch generation 被授予两个及以上 owner 的情况（共 468 个 generation）。

  跨 Broker 的"至多派发一次"靠的就是这把行锁。
- **M22（去掉"他人有效租约 → 返回 null"的检查）。** 测试仍然全绿，因为契约在 `JdbcRepositoryContract.java:308` 处的有效租约断言通过一条回退分支依然成立：B 的 claim 把 CANCEL_REQUESTED 行翻成 UNKNOWN，照样返回 `null`。竞争中没有调用被派发两次，因为被抢的 owner 的下一次 CAS 会被 fence 拒绝。但此时其他 Broker 的 claim 会把正在执行的 `EXECUTING` 行变成 UNKNOWN：竞争中对账的 UNKNOWN 行有 261 个，同一服务器上用真实代码只有 13 个。

补丁新增三个测试块：覆盖第 1、2 节的载荷往返测试（包括首位的 `@type` 数组和 `null` 的 `@type`）；对有效 `DISPATCHING` 租约拒绝 claim，并断言该行不变；分 4 轮、每轮对一个新的 PREPARED 行并发 32 次 `claimDispatch`，每轮只允许一个胜者。
- **在未打修复的 `66d1aedb` 上：** 新测试以 `StackOverflowError` 失败。
- **打补丁后：** 新测试杀死 M22 为 10/10；杀死 M50 为顺序运行 10/10、9 套测试并行时 7/9——在重负载下，这个竞争测试是概率性的。针对补丁自身各行的变异体全部被杀，包括保留 `TypeReference` 读取器的变体。

除 M22 外，锁步 fuzz 还能再抓到 12 个存活者，例如：
- M18：CAS 不递增 version；
- M38：`resolveUnknown` 的版本 fencing；
- M09：CAS 中"已结算即终态"。

建议把它们移植到 `JdbcRepositoryContract`；证据目录里的 fuzz harness 可为每一个复现一条失败序列。M57 的 fuzz"分歧"不计入：它们来自 fuzz 判定器本身调用了被变异的比较函数。其余存活者要么是等价变异，要么需要伪造快照、篡改数据库行或只能用包内参数构造，要么位于载荷比较内部——而 `requestDigest` 仍是精确比较的。

![fig4](fig4-gates-and-test-strength.png)

### 其他说明
- **`databaseNow()` 仍依赖会话时区。** 这是 #12390 的 finding 1，也是本 PR 中 chiga0 的 M1，已按模块级问题推迟处理。它现在也决定 dispatch 租约。本轮没有重新测量。
- **IT 每次运行都需要新库。** 这个问题早于本 PR（来自 #12390）：在 `66d1aedb` 上对同一 schema 重跑，会在 `verifyBinding` 以 `expected: <[1]> but was: <[2]>` 失败，所以测试计划里的"一次性数据库"必须是每次运行一个。
- **我在 MySQL 8.4 上的第一次 6-JVM 竞争打满了 `max_connections`。** 原因是 harness 每个操作开一个不走连接池的连接。服务器记录 `Connection_errors_max_connections` 346 次、连接峰值 152，不变量 I1–I5 全为 0。重跑后正常，两份日志都在证据目录里。
- **#12458 是同一改动的较早版本（`4a84a9c`）。** 我在那里测到同样的缺陷，`suggested-fix-pr12458-4a84a9c.patch` 可以直接应用。我会在那边留一条指向本评论的说明。
- **其他门禁。** 我在 `66d1aedb` 和打补丁的版本上都跑了测试计划中的 `mvn clean checkstyle:check verify`：两者都是 63/63 通过、Checkstyle 0 违规。

**未覆盖：**
- Windows。
- 根目录的 `npm run build && npm run typecheck`：没有改动 TS/JS。作者报告已在当前 head 上跑过，同时跑过 MySQL 26.7.0（[评论](https://github.com/QwenLM/qwen-code/pull/12445#issuecomment-5774219602)）。
- 属于后续接入 PR 的内容，例如权威的 UNKNOWN 解决和数据库迁移。

补丁 diff 与英文部分相同（针对 `66d1aedb`：生产代码 +19/−6，测试 +74；`BrokerValues` 那一块是比较方式的改动，`JdbcToolExecutionRepository` 的几块是编解码改动）。

**证据**（图、探针源码、竞争/fuzz/变异脚本、全部日志、两份补丁）：本目录。

**环境：**
- Maven、探针与 fuzz：`eclipse-temurin:21-jdk`（Java 21.0.12），Maven 3.9.9 离线。
- 竞争测试 JVM：宿主机 Zulu OpenJDK 21.0.10。
- H2 2.3.232；Docker 中的 MySQL 8.4.11、MySQL 8.0.46、MariaDB 11.4.13；Connector/J 8.4.0；fastjson2 2.0.60。
