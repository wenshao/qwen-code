## 维护者验证第 2 轮（增量）— PR #12522 @ `075de399`

**结论：B1 已修复，并已实测。从我这边看可以合入。** 有一个不阻塞的建议，合入前或合入后马上处理都可以：取消 exchange 的那几行，删掉任何一行都不会让测试失败；R1 提出的测试缺口也还在。下面的纯测试补丁把两者一起补上。

本轮只看[第 1 轮](https://github.com/QwenLM/qwen-code/pull/12522#issuecomment-5791002379)（`525f223b`）之后的变化。两个新提交只改了 `HttpRuntimeTransport.java` 和它的测试。worker、fixtures 和文档都没变，所以第 1 轮构建的 bundle 仍然可以直接作为测试用的 worker。

### B1（响应体停滞）— 已修复

- **所有停滞现在都以同一种方式结束。** 我在 JDK 21 和 25 上重跑了同一个原始 socket 探针。6 种停滞场景都在 30.3–30.5 秒以可重试的 `503 managed_runtime_unavailable` 结束：不发头、只发头、发一半、chunked 发一半、慢速滴、截断的 503。正常对照组仍在 0.5–0.6 秒内成功。在 `525f223b` 上，这 6 种里有 5 种到 45 秒时仍然挂起。
- **公共线程池不受影响。** 停滞 400 次后，公共线程池在 JDK 21 上保持 1 个线程、在 JDK 25 上保持 2 个；R1 时是 271 个。之后正常 attest 和无关的 `supplyAsync` 都能完成。用 `-XX:ActiveProcessorCount=2` 停滞 300 次，线程池为 0 个线程，两个后续调用都成功；R1 时这个设置下泄漏了 300 个线程。
- **连接确实被关闭。** 20 个停滞调用在截止之后，以及 20 个在 2 秒时被调用方取消的调用，最终都是客户端 `FIN-WAIT-2`、服务端 `CLOSE-WAIT`。所以 yiliang114 的 P3（调用方取消）也修好了。
- **真实 worker 端到端没有变化。** bundle 里的 worker 对接新 classes，JDK 21 和 25 都是 15/15；间隔 0–1500 毫秒的 keep-alive 复用 70/70 成功。
- **模块测试和 CI 通过。** `mvn test checkstyle:check` 在 JDK 21 和 JDK 25 上都是 74/74，Checkstyle 干净。已经跑完的 CI job 全部通过；我检查时 `review-pr` 还在等待中。

实现与我在 R1 建议的形态一致：非阻塞的有界 subscriber，截止时间映射为现有的可重试 503，再加上 `exchange.cancel(true)`。有一点比我的补丁更好：stage 完成后 `orTimeout` 会移除自己的计时器，不会留下延迟任务。

### 建议 — 取消 exchange 的那几行没有测试覆盖

有两个变异体在 PR 的测试下依然全绿：
- **N02** 删掉 `exchange.cancel(true)`，也就是两个修复提交都依赖的那次 exchange 取消。这时无论是截止之后还是调用方取消之后，20 条连接都一直 `ESTAB`。
- **N07** 恰好撤销了 `075de399` 新增的调用方取消传播。这时调用方取消之后，20 条连接都一直 `ESTAB`。

见上方英文部分第一张图的最后几行。PR 的停滞测试只断言了 `pending.cancel(true)` 和 `pending.isCancelled()`。不管取消有没有被传播下去，任何仍未完成的 `CompletableFuture` 都满足这两条。

**R1 的测试缺口也仍然存在。** 在当前 head 上，仍适用的 36 个变异体中，PR 测试只杀掉 13 个。存活的包括：
- M03/M04：去掉 lease 请求头后，真实 worker 对每次本应成功的调用都返回 409。
- M11/M12：去掉只有客户端能做的两项身份检查后，真实 worker 给出的属于另一个 runtime 或另一个 incarnation 的证明会被接受。
- 响应严格性检查，以及恰好 16 KiB 的边界（N29）。

**补丁：** [`followup-tests-075de399.patch`](patches/followup-tests-075de399.patch)。它只改测试，+245/−1，在 `075de399` 上 `git apply` 可以干净应用。
- 其中原样包含 R1 的 8 个补测，它们在当前 head 上不用改就能通过。
- 另外新增一个测试 `closesTheConnectionOnTheDeadlineAndOnCallerCancel`。服务端每 25 毫秒写 1 个字节，写失败时记录下来。测试断言：300 毫秒截止之后，以及调用方取消之后，客户端都会在 2 秒内关闭连接。
- 结果：83/83，Checkstyle 干净，连跑 5 次都通过；变异杀伤从 **13/36 提到 32/36**，N02 和 N07 都被杀掉。
- 剩下 4 个存活：
  - M23（epoch 0）是等价变异，因为 `RuntimeAttestation` 构造器同样会拒绝它。
  - N06 是等价变异：没有 `body.isDone()` 这个守卫，迟到的 `onNext` 也只会复制 0 字节，第二次 `complete` 什么都不做。
  - N08 是等价变异：`handle` 直接挂在 `result` 上，它拿到的错误不会是 `CompletionException`。
  - N09 只影响包级私有构造器里的参数校验。

### 小问题
- `BoundedBodySubscriber` 的 Javadoc 说完成 body future 是"so the request timeout still covers the exchange"。这会误导读者：`HttpRequest.timeout` 仍然只管到收到响应头为止，覆盖响应体的是 stage 上的 `orTimeout`。当前 head 上的证据：
  - 删掉 `orTimeout`（N01）会让 PR 自己的停滞测试失败。
  - 探针里所有响应体停滞的失败 cause 都是来自 `orTimeout` 的 `TimeoutException`；只有不发头那种情况是 `HttpTimeoutException`。
  - @chiga0 的 approve 里也有同样的说法（"REQUEST_TIMEOUT covers the full exchange including body reception"）。修复本身是对的，只是这句解释不准确。

  建议改成："…so the stage deadline (`orTimeout`), not the request timeout, bounds the body."

证据（探针日志、`ss` 输出、变异结果、补丁）：this directory
