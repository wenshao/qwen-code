# PR #10347 — round-3 maintainer verification at head `7c8feefb45`

Third local verification, after [2026-08-29](https://github.com/QwenLM/qwen-code/pull/10347#issuecomment-5460964245)
(head `ae5b9498`) and [2026-09-01](https://github.com/QwenLM/qwen-code/pull/10347#issuecomment-5487687824)
(head `17c02a97`). The PR-introduced patch is byte-identical across all three points — the digest of the
added/removed lines of `<merge-base>...<head>` for the four changed files is `9531f7ef7e30d508…` at both
`17c02a97` and `7c8feefb45` — so this round is about the two things the earlier rounds could not close:

1. **which 400 body shape the reporter's gateway actually returns** (the one open item gating `Fixes #10346`), and
2. whether anything about the fix changes on the transports and auth types the earlier rounds did not drive.

**Verdict: recommend merge.** The open question is now answered from the gateway's own source: the shape the
fix covers is the shape that gateway emits. Two PR-body corrections are still owed. One new scope gap found
(the Responses API auth type), non-blocking.

## Bench

| | |
|---|---|
| Tree under test | PR head `7c8feefb45` (merge-base `7340de4f37`) |
| Baseline | the same tree with only `retryErrorClassification.ts` and `llm-chat.ts` reverted to merge-base content (verified byte-identical to `git show 7340de4f37:<file>`) |
| Artifacts | `npm ci` (full build) in both → two real `dist/cli.js`; the `network error for request ` marker appears in the PR bundle only (1 hit vs 0) |
| Runner | Debian 13, kernel 6.12.63, Node v22.22.2, repo-pinned `openai@5.11.0` |
| Gateway | a mock that reproduces llumnix's `convertErrorResponse()` byte for byte, in all of its branches |

## 1. The gateway is llumnix, and both shapes it emits are covered

`network error for request to %s: %v` is not a generic phrase. The only public source of it is
[`llumnix-project/llumnix`](https://github.com/llumnix-project/llumnix) — the Go request gateway of Alibaba
Cloud PAI-EAS's LLM serving stack — in `pkg/consts/error.go`:

```go
func (e *NetworkError) Error() string {
    return fmt.Sprintf("network error for request to %s: %v", e.URL, e.Err)
}
```

and `pkg/gateway/service/gateway_service.go` decides the HTTP shape:

```go
switch msg.Err {
case consts.ErrorBackendBadRequest:   // engine's own 4xx -> JSON envelope
    ...
default:
    return http.StatusBadRequest, []byte(msg.Err.Error())   // 400 + RAW TEXT
}
```

A `NetworkError` — a peer that closed mid-request, i.e. Go's `Post "...": EOF` — falls to the `default`
branch: **HTTP 400 with the raw Go error text as the body, not a JSON error envelope.** For a streaming
request `writeStreamResponse()` wraps that same raw text as `data: <text>\n\ndata: [DONE]` and still answers
`400`. Both shapes carry no provider error body, which is exactly the guard this PR keys on.

Driving the real `openai@5.11.0` client against each candidate body and classifying the resulting SDK error
with each arm's built core:

| 400 body shape | provider body | base | this PR |
|---|---|---|---|
| llumnix non-stream: raw Go text | none | `http/fail-fast/client-error` | **`transport/retryable/network-error`** |
| llumnix stream: `data: <raw text>` | none | `http/fail-fast/client-error` | **`transport/retryable/network-error`** |
| another gateway JSON-wrapping the same text | present | `http/fail-fast/client-error` | `http/fail-fast/client-error` |
| same + `type`/`code` | present | `http/fail-fast/client-error` | `http/fail-fast/client-error` |
| genuine client 400 from the engine | present | `http/fail-fast/client-error` | `http/fail-fast/client-error` |

The JSON-wrapped gap I reported in round 1 is real and unchanged, but it does **not** apply to this
deployment: llumnix only produces a JSON envelope on `ErrorBackendBadRequest`, i.e. when the engine itself
returned a 4xx — a genuine client error that must stay fail-fast. So `Fixes #10346` holds.

## 2. A/B at the current head

Gateway fails the first two requests with llumnix's streaming 400, then serves a normal SSE stream.

| transport | base | this PR |
|---|---|---|
| headless `-p` | 1 request, `[API Error: 400 data: network error … EOF]`, exit 1 | 4 requests (2 failed, answer on #3, #4 is the usual follow-up side call), exit 0 |
| ACP stdio (`--acp`, the channel/daemon path) | 1 request, JSON-RPC `-32603 Internal error` with the incident string as `details` | 3 requests, `session/update` carries the reply, `stopReason: "end_turn"` |
| interactive TUI | turn dies with `(Press Ctrl+Y to retry)` | turn simply succeeds |

Retries land 1.5 s and 2.8 s after the failure. In the TUI the retry is invisible — the ordinary
"thinking" spinner keeps running, with no indication that the endpoint failed twice.

## 3. The bound is real; the PR body still names the wrong knob

Endpoint never recovers:

| configuration | attempts | wall time |
|---|---:|---|
| defaults | 7 | 71.1 s |
| `model.generationConfig.maxRetries: 1`, `retryInitialDelayMs: 100` | 7 | 73.9 s |
| `QWEN_CODE_UNATTENDED_RETRY=1` (what a channel host sets) | 7 | 84.0 s |

The real bound is `DEFAULT_RETRY_OPTIONS` in `packages/core/src/utils/retry.ts` (`maxAttempts: 7`,
`initialDelayMs: 1500`, exponential + jitter); `makeApiCallAndProcessStream` passes no overrides.
The unattended row also confirms the new class cannot enter the unbounded persistent loop
(`isTransientCapacityError` is 429/529 only).

New in this round — a positive control that the settings file really was loaded, so "the knob does nothing"
cannot be blamed on a mis-specified settings path. On the pre-existing raw-socket-EOF path, where
`maxRetries` reaches the OpenAI SDK client, the same settings file halves the traffic exactly:

| configuration | upstream requests | wall time |
|---|---:|---|
| defaults (SDK `maxRetries` 3) | 84 | 272 s |
| `model.generationConfig.maxRetries: 1` | 42 | 226 s |

## 4. New: the Responses API auth type is not covered

With `security.auth.selectedType: "openai-responses"`, the identical llumnix 400 is **not** retried by this
PR — 1 upstream request, `[API Error: Responses API error 400: …]`, in both arms. `shouldRetryOnError`
returns `error.shouldRetry()` for a `ResponsesHttpError` before the new 400 branch is reached, and
`ResponsesHttpError.shouldRetry()` covers 408/409/429/5xx only. Non-blocking (llumnix speaks
`/v1/chat/completions`), but worth a follow-up if any deployment fronts the Responses API.

## 5. Controls — nothing else moved

| case | base | this PR |
|---|---|---|
| genuine backend 400 (JSON envelope) | 1 request, fail-fast | 1 request, fail-fast |
| raw socket close, no HTTP response | 4 requests, recovers | 4 requests, recovers |
| EOF mid-SSE after a 200 header (llumnix's other branch: header already sent → close) | 4 requests, recovers, same text | 4 requests, recovers, same text |

Between §2 and the last row, llumnix's whole failure surface is covered: pre-header EOF by this PR,
post-header EOF by the pre-existing stream continuation path.

## 6. Suites and mutation at this head

`retryErrorClassification.test.ts` 47 passed · `retry.test.ts` 90 passed · `llm-chat.test.ts` 490 passed.
(The PR body still says 41 for the first file and predates the growth of the third.)

Six mutants against the PR's own tests:

| mutant | result |
|---|---|
| drop the whole provider-body guard | KILLED (2 tests) |
| widen the marker regex to `/EOF/i` | KILLED (1) |
| `kind: 'transport'` → `'http'` on the relabel | KILLED (4, incl. the llm-chat retry test) |
| populate `transportCode` on the relabel | KILLED (2, incl. "does not replay … mid-stream") |
| `llm-chat.ts` 400 gate → `return true` | KILLED (1) |
| drop only the `providerCode === undefined` conjunct | **SURVIVED** |

The survivor reproduces round 1's finding: whenever the marker is present a defined `providerCode` implies a
defined `providerMessage`, so that conjunct is redundant. Cosmetic.

## Still owed by the author

1. **PR body**: the retry bound is `DEFAULT_RETRY_OPTIONS` (7 attempts, 1.5 s initial, exponential), not
   `generationConfig.maxRetries` / `retryInitialDelayMs`. Also note the user-visible cost: against a
   permanently-down endpoint a channel turn now reports the error after ~70 s instead of ~1.5 s.
2. **PR body**: `hasNetworkFailureCause` is described as "transport code or `EOF`/`network error` marker";
   the code deliberately matches only `/network error for request /i` and deliberately excludes transport
   codes. Also the test count (41 → 47).
3. The template's Chinese `<details>` section is still missing.

Optional hardening, still my recommendation from round 1: let a provider body whose own message *is* the
network-failure marker qualify too, so gateways that JSON-wrap the same text are covered.
