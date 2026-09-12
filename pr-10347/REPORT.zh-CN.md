# PR #10347 —— 第三轮维护者本地验证（head `7c8feefb45`）

接续 [2026-08-29](https://github.com/QwenLM/qwen-code/pull/10347#issuecomment-5460964245)（head `ae5b9498`）
与 [2026-09-01](https://github.com/QwenLM/qwen-code/pull/10347#issuecomment-5487687824)（head `17c02a97`）两轮验证。
本 PR 自身引入的补丁在三个时点**逐字节一致**——四个改动文件 `<merge-base>...<head>` 的增删行摘要在 `17c02a97`
与 `7c8feefb45` 上同为 `9531f7ef7e30d508…`——所以这一轮只解决前两轮无法收口的两件事：

1. **报告者网关返回的 400 body 究竟是哪种形态**（这是 `Fixes #10346` 成立与否的唯一未决门槛）；
2. 在前两轮没有驱动过的传输方式与鉴权类型上，行为是否有变化。

**结论：建议合并。** 未决问题现在可以从网关自己的源码回答：修复覆盖的形态，正是该网关实际发出的形态。
PR 描述仍欠两处更正。新发现一个作用域缺口（Responses API 鉴权类型），不阻塞合并。

## 验证台

| | |
|---|---|
| 被测树 | PR head `7c8feefb45`（merge-base `7340de4f37`） |
| 基线臂 | 同一棵树，仅把 `retryErrorClassification.ts` 与 `llm-chat.ts` 回退到 merge-base 内容（已校验与 `git show 7340de4f37:<file>` 逐字节相同） |
| 产物 | 两侧 `npm ci`（含完整构建）→ 两个真实 `dist/cli.js`；`network error for request ` 这个 marker 只出现在 PR 侧 bundle（1 处 vs 0 处） |
| 运行环境 | Debian 13、内核 6.12.63、Node v22.22.2、仓库锁定的 `openai@5.11.0` |
| 网关 | 按 llumnix `convertErrorResponse()` 逐分支复刻的 mock |

## 1. 网关就是 llumnix，它发出的两种形态都被覆盖

`network error for request to %s: %v` 不是一句通用文案。公开代码里唯一的来源是
[`llumnix-project/llumnix`](https://github.com/llumnix-project/llumnix)——阿里云 PAI-EAS LLM 推理服务栈的 Go 请求网关——
见 `pkg/consts/error.go`：

```go
func (e *NetworkError) Error() string {
    return fmt.Sprintf("network error for request to %s: %v", e.URL, e.Err)
}
```

HTTP 形态由 `pkg/gateway/service/gateway_service.go` 决定：

```go
switch msg.Err {
case consts.ErrorBackendBadRequest:   // 引擎自己的 4xx -> JSON 信封
    ...
default:
    return http.StatusBadRequest, []byte(msg.Err.Error())   // 400 + 纯文本
}
```

`NetworkError`（对端在请求中途关闭连接，即 Go 的 `Post "...": EOF`）落在 `default` 分支：
**HTTP 400，body 是 Go 的原始错误文本，不是 JSON 错误信封。** 对流式请求，`writeStreamResponse()`
把同一段原始文本包成 `data: <text>\n\ndata: [DONE]`，状态码仍是 `400`。两种形态都没有 provider 错误体，
正是本 PR 所依赖的判据。

用真实 `openai@5.11.0` 客户端打这些 body，再用两臂各自**已构建**的 core 对拿到的 SDK 错误做分类：

| 400 body 形态 | provider 错误体 | base | 本 PR |
|---|---|---|---|
| llumnix 非流式：原始 Go 文本 | 无 | `http/fail-fast/client-error` | **`transport/retryable/network-error`** |
| llumnix 流式：`data: <原始文本>` | 无 | `http/fail-fast/client-error` | **`transport/retryable/network-error`** |
| 另一类网关把同样文本包进 JSON | 有 | `http/fail-fast/client-error` | `http/fail-fast/client-error` |
| 同上 + `type`/`code` | 有 | `http/fail-fast/client-error` | `http/fail-fast/client-error` |
| 引擎返回的真客户端 400 | 有 | `http/fail-fast/client-error` | `http/fail-fast/client-error` |

我在第一轮报告的 JSON body 缺口确实存在、也未改变，但它**不适用于**这个部署：llumnix 只在
`ErrorBackendBadRequest`（即引擎自己返回 4xx）时才产出 JSON 信封，而那本就是必须 fail-fast 的真客户端错误。
所以 `Fixes #10346` 成立。

## 2. 当前 head 上的 A/B

网关让前两个请求以 llumnix 的流式 400 失败，之后正常返回 SSE 流。

| 传输方式 | base | 本 PR |
|---|---|---|
| headless `-p` | 1 个请求，`[API Error: 400 data: network error … EOF]`，exit 1 | 4 个请求（2 次失败、第 3 次拿到回答、第 4 次是本来就有的后续侧调用），exit 0 |
| ACP stdio（`--acp`，channel/daemon 路径） | 1 个请求，JSON-RPC `-32603 Internal error`，`details` 就是事故文案 | 3 个请求，`session/update` 带回回复，`stopReason: "end_turn"` |
| 交互式 TUI | 回合失败，提示 `(Press Ctrl+Y to retry)` | 回合直接成功 |

两次重试分别发生在失败后 1.5 s 和 2.8 s。在 TUI 里重试是**不可见的**——依旧是普通的"思考中"转圈，
没有任何迹象表明端点已经失败了两次。

## 3. 上界是真的；但 PR 描述里点名的旋钮是错的

端点持续不可用时：

| 配置 | 尝试次数 | 墙钟时间 |
|---|---:|---|
| 默认 | 7 | 71.1 s |
| `model.generationConfig.maxRetries: 1`、`retryInitialDelayMs: 100` | 7 | 73.9 s |
| `QWEN_CODE_UNATTENDED_RETRY=1`（channel 宿主会设的那个） | 7 | 84.0 s |

真正的上界是 `packages/core/src/utils/retry.ts` 里的 `DEFAULT_RETRY_OPTIONS`（`maxAttempts: 7`、
`initialDelayMs: 1500`、指数退避 + 抖动）；`makeApiCallAndProcessStream` 没有传任何覆盖值。
第三行同时证明新类别不会进入无界的 persistent 循环（`isTransientCapacityError` 只认 429/529）。

本轮新增——一个正向对照，用来排除"旋钮没效果其实是我 settings 路径写错了"这种解释。在既有的
raw socket EOF 路径上（`maxRetries` 会传给 OpenAI SDK 客户端），同一份 settings 文件把流量精确减半：

| 配置 | 上游请求数 | 墙钟时间 |
|---|---:|---|
| 默认（SDK `maxRetries` 3） | 84 | 272 s |
| `model.generationConfig.maxRetries: 1` | 42 | 226 s |

## 4. 新发现：Responses API 鉴权类型未被覆盖

当 `security.auth.selectedType: "openai-responses"` 时，同样的 llumnix 400 **不会**被本 PR 重试——
两臂都是 1 个上游请求、`[API Error: Responses API error 400: …]`。原因是 `shouldRetryOnError` 对
`ResponsesHttpError` 会先行返回 `error.shouldRetry()`，走不到新的 400 分支，而
`ResponsesHttpError.shouldRetry()` 只覆盖 408/409/429/5xx。不阻塞（llumnix 走的是
`/v1/chat/completions`），但如果有部署前置了 Responses API，值得后续跟进。

## 5. 对照组——其它行为均未变动

| 场景 | base | 本 PR |
|---|---|---|
| 引擎的真客户端 400（JSON 信封） | 1 个请求，fail-fast | 1 个请求，fail-fast |
| 直接关 socket、完全没有 HTTP 响应 | 4 个请求，恢复 | 4 个请求，恢复 |
| 200 响应头之后在 SSE 中途 EOF（llumnix 的另一分支：头已发出只能关连接） | 4 个请求，恢复，文本一致 | 4 个请求，恢复，文本一致 |

结合 §2 与上表最后一行：llumnix 的整个失败面都被覆盖了——响应头之前的 EOF 由本 PR 处理，
响应头之后的 EOF 由既有的流续传路径处理。

## 6. 当前 head 的测试与变异

`retryErrorClassification.test.ts` 47 通过 · `retry.test.ts` 90 通过 · `llm-chat.test.ts` 490 通过。
（PR 描述里第一个文件仍写作 41，第三个文件的数字也早于 main 的增长。）

针对 PR 自带测试跑的 6 个变异体：

| 变异体 | 结果 |
|---|---|
| 去掉整个 provider 错误体判据 | KILLED（2 条） |
| 把 marker 正则放宽为 `/EOF/i` | KILLED（1 条） |
| relabel 的 `kind: 'transport'` 改为 `'http'` | KILLED（4 条，含 llm-chat 的重试用例） |
| 在 relabel 里填上 `transportCode` | KILLED（2 条，含 "does not replay … mid-stream"） |
| `llm-chat.ts` 的 400 闸门改成 `return true` | KILLED（1 条） |
| 只去掉 `providerCode === undefined` 这一个合取项 | **存活** |

这个存活体复现了第一轮的结论：只要 marker 存在，`providerCode` 有值就蕴含 `providerMessage` 有值，
因此该合取项是冗余的。属于观感问题。

## 作者仍欠的事项

1. **PR 描述**：重试上界是 `DEFAULT_RETRY_OPTIONS`（7 次、初始 1.5 s、指数退避），不是
   `generationConfig.maxRetries` / `retryInitialDelayMs`。同时请写明用户可见的代价：端点长时间不可用时，
   channel 回合现在要约 70 s 才报错，而不是 1.5 s。
2. **PR 描述**：`hasNetworkFailureCause` 被描述为"传输错误码或 `EOF`/`network error` 标记"；
   实际代码只匹配 `/network error for request /i`，并刻意排除传输错误码。测试条数也需更新（41 → 47）。
3. 模板里的中文 `<details>` 小节仍然缺失。

可选的加固（仍是我第一轮的建议）：让"provider 错误体本身就是该网络失败标记"的情况也算数，
这样把同样文本包进 JSON 的网关也能覆盖到。
