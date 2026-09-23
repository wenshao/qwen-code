## 维护者验证 — PR #12522 @ `525f223b`（本地构建、真实 worker、JDK 21/25）

**结论：目前不可合入。有一个阻塞项，已实测确认。** 响应体停滞时 `attest()` 会永远挂起。在当前 head 上，只要对端一直不关连接，每次停滞还会一直占住一个 `ForkJoinPool.commonPool` 线程。在这台 16 核机器上，271 次停滞就会饿死整个 JVM 的 common pool。我给出了已验证的补丁（生产代码 +75/−28）。其余部分对真实 worker 都成立。

停滞问题是 triage Stage 2/3 和 @chiga0 的 R1-1 读代码时提出的，两边都没有实测。本评论提供实测结果，并更正了其中两处：「回归」的说法，以及「任一修法单独就够」的想法。

### 运行了什么

| 项目 | 结果 |
|---|---|
| `runtime-broker` 下 `mvn test checkstyle:check`，JDK 21 | 73/73，Checkstyle 干净 |
| head 完整 `pnpm install` + `npm run build` + `npm run bundle` | exit 0 |
| 真实 `node dist/cli.js managed-runtime-worker` ← Java 客户端（head classes），JDK 21 和 25 | **15/15** 用例；keep-alive 边界调用 70/70 |
| 原始 socket 停滞探针：7 种场景 × {R1 `cf6a4454`、head、修复臂} × JDK {21, 25} | 见上方英文部分的图 |
| 对 `HttpRuntimeTransport.java` 做变异（30 个变异体） | PR 测试 **9/30** → 加上补测 **28/30** |

### B1 — 响应体停滞没有任何上限，且当前 head 会占住 common pool 线程（阻塞）

- **两个 JDK 上，所有响应体停滞都一直挂起。** 五种场景都是先发响应头再停：只发头、`Content-Length` 体发一部分、chunked 体发一部分、每 2 秒滴 1 字节、以及 503 加截断的 HTML 体。五种情况下返回的 stage 在 45 秒时仍未完成（`REQUEST_TIMEOUT` = 30 秒）。唯一能干净失败的是从不发响应头的对端：约 30.5 秒得到可重试的 503。`HttpRequest.timeout` 只管到收到响应头为止。
- **更正 triage：停滞不是回归。** R1 提交 `cf6a4454`（用 `ofByteArray()`）在五种场景下同样挂起。旧代码遇到停滞的响应体时，并不会「在 30 秒给出已分类、可重试的 503」。
- **当前 head 新增的是等待发生在哪里。** `whenComplete` 回调跑在 `ForkJoinPool.commonPool` 上，所以 `readAtMost` 会让一个 common pool worker 停在 `HttpResponseInputStream.read` 里（调用栈见上方英文部分的图）。调用方放弃等待也不会释放它，只有对端关闭 socket 才会释放。
- **停滞次数达到（CPU 数 − 1）+ 256 时，common pool 被饿死。** 线程池为被阻塞的 worker 做补偿，最多到 parallelism + 256 个备用线程。
  - 这台 16 核机器上是 271。270 次停滞时，正常 attest 仍可用。271 次及以上时，同一 transport 上的正常 attest 10 秒内没有完成，无关的 `CompletableFuture.supplyAsync(() -> 42)` 5 秒内也没有完成：JVM 的默认异步执行器被耗尽。
  - JDK 25 表现相同（300 次停滞 → 271 个被占住，饿死）。
  - 用 `-XX:ActiveProcessorCount=4` 时上限是 259。
  - 用 `-XX:ActiveProcessorCount=2` 时根本没有 common pool：`CompletableFuture` 退回到每个任务一个线程。不会饿死，但每次停滞都泄漏一个平台线程，没有上限（300 次 → 300 个被占住）。
  - R1 在 400 次停滞后不占任何线程，线程池大小保持 1。
  - 对 reconcile 这个调用方来说这很现实。它会反复重试一个接受 TCP 后就停住的恢复 worker；只要那个 worker 不关 socket，每次重试都会再占住一个线程。
- **连接一直不关。** 截止时间过后，head 和 R1 的 20 条停滞连接都保持 `ESTAB`。
- **两种建议的修法各自只解决一半。** triage 把「有界 subscriber 或在 stage 上加显式截止时间」作为二选一，R1-1 则把它们分为最小修法和完整修法。我分别单独实测了：
  - *只加截止时间：`result.orTimeout(...)`，即 R1-1 的最小修法那一行。* 为了让探针跑得快，我用 2 秒而不是 40 秒。stage 以原始 `java.util.concurrent.TimeoutException` 失败，没有 status、没有 `code`、没有 `retryable`，和这个类所有其他失败路径都不一样。超时之后线程仍被占住（`parked=1`），而不只是「在超时窗口内」；300 次停滞后线程池照样被饿死。
  - *只换有界 subscriber。* 相当于我的修复臂去掉截止时间，即变异体 F01。它不占线程，但 45 秒时**仍然挂起**。R1 臂已经表明，请求超时并不覆盖响应体，所以「请求超时仍覆盖整个交换」并不成立。
- **修复必须两者兼备。** 我用的是非阻塞的有界 `BodySubscriber`，读到 16 KiB + 1 时取消。再加一个显式截止时间：到时以现有的可重试 `503 managed_runtime_unavailable` 结束 stage（cause 为 `HttpTimeoutException`），**并**调用 `exchange.cancel(true)`。结果：
  - JDK 21/25 上所有停滞场景都在 30.3–30.4 秒失败。
  - 400 次停滞后没有线程被占住，线程池大小 15，正常调用照常可用。
  - 客户端确实关闭了连接：客户端 socket 进入 `FIN-WAIT-2`，服务端进入 `CLOSE-WAIT`。
  - 真实 worker 端到端仍是 15/15，模块测试 82/82，Checkstyle 干净。
  - 补丁新增 `failsAStalledBodyAsRetryableWithinTheDeadline`，使用新加的包级私有 `Duration` 构造器。去掉截止时间后这个测试会失败（变异体 F01：`awaitFailure` 抛 `TimeoutException`）。
  - 补丁：`fix-stall-deadline-525f223b.patch`，`git apply` 可干净应用，并已包含下面的补测。

### 真实 worker 端到端（跨语言，CI 尚未覆盖）

worker 进程由这个 head 构建的 bundle 启动，经 stdin 注入 boot，约 90 毫秒就绪。结果：
- 身份完全一致 → 证明被接受。
- token 错误 → `401`，不可重试。
- 旧 epoch、其他 lease、workspace、generation、tenant、cwd、digest、isolation class 或 provision request → `409`，不可重试。
- digest 格式错误 → `400`。
- SIGTERM 后 worker 不在了（exit 0）→ `503`，可重试。
- 只有客户端能做的两项检查对真实进程也有效：seed 的 `gatewayIncarnation` ≠ worker 的 incarnation（E12），以及 lease 的 `runtimeInstanceId` ≠ worker 的（E13）。
- worker 的 `keepAliveTimeout` 为 1000 毫秒。间隔 0–1500 毫秒（含 990–1010 毫秒）复用连接池里的连接，70/70 成功，Java 客户端没有踩到过期 keep-alive 的竞态。

### 测试缺口（不阻塞，但对下一个切片很重要）

PR 测试只杀掉 30 个变异体中的 9 个。存活的包括：
- **M03/M04：去掉 `X-Qwen-Managed-Lease-Id` 或 `-Epoch` 请求头，测试依然全绿。** 对真实 worker，这时本应成功的每次 attest 都以 `409` 失败。设计文档只检查路径、Authorization、`no-store` 和 body；fixture 里带有 lease id 和 epoch 的 `request.headers` 从未被比对。M05（请求 `Content-Type`）也因同样原因存活。
- **M11–M14 和 M16：6 项身份比较中有 5 项没被测试钉住。** 只有 scope 比较被钉住了。M11（`runtimeInstanceId`）和 M12（`gatewayIncarnation`）去掉的正是 worker 无法替客户端做的两项检查。对真实 worker，M11 会**接受**属于另一个 runtime 的 lease（E13 → `ok`），M12 会**接受**来自另一个 incarnation 的证明（E12 → `ok`）。
- **M17：上一轮的阻塞项 1 没被钉住。** 把 `readAtMost` 换成 `readAllBytes()`，所有测试照样通过，因为超大用例只发恰好 16 KiB + 1 字节就关闭连接。这与「每个修复都有一个没有它就会失败的测试」在有界读取这一点上不符。
- M06–M10 和 M24（响应的 `Cache-Control`、`Content-Type`/charset、封闭字段集、`protocolVersion`、非整数 epoch）、M21（连接失败可重试）、M22（seed 必须绑定 lease）、M25（不跟随重定向）、M29（恰好到上限的边界）同样存活。

补测只改测试，+179/−1：`followup-tests-525f223b.patch`。新增 8 个测试：逐一比对 fixture 的全部请求头、四个身份字段加 epoch、7 种格式不对的成功响应、恰好 16384 字节的响应体、声明 1 GiB 的响应体（必须在上限处停下）、重定向到本会成功的路径、不可达的 runtime、以及未绑定 lease 的 seed。加上后杀伤 **28/30**。存活的两个：
- M23 是等价变异，因为 `RuntimeAttestation` 构造器同样拒绝 epoch 0。
- M30（去掉 `REQUEST_TIMEOUT`）需要等 30 秒才能观察到，而修复后截止时间本身就覆盖了它。

修复臂上：30/33（M17 不适用）。F02（截止时不 cancel exchange）只有 socket 探针能看到。

### 次要说明（本切片无需处理）
- `requireProtocol` 接受 `2.0`，`requiredPositiveLong` 接受 `4.0`。worker 总是输出整数，实际上没有影响。
- `RuntimeLease` 只接受纯 origin（`endpoint must be an HTTP(S) origin`），所以不会出现 `resolve(PATH)` 丢掉路径前缀的情况。
- 修复后每次调用会留下一个延迟任务，在 30 秒内持有 `result` 和 `exchange`。这无害，如果你更喜欢，也可以用 `result.whenComplete` 去掉它。该任务经 `delayedExecutor` 跑在 common pool 上。

证据（harness 源码、含 `ss` socket 计数在内的原始运行日志、补丁、截图）：本目录
