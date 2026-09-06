# 复验（2026-09-06 晚）—— 代码没变，但它脚下的地基变了

针对 head `46208f5117` 复验，对比 main `1a86cd6c59`。

**修正后的结论：拆分这个 PR。** qwen-live 那一半现在应当尽快合入 —— 它没有被取代，能干净地应用到今天的 main，并且全绿。/compress 那一半的大部分前提已经消失。

## 1. PR 这边什么都没改

`4fa8cdf0d8..46208f5117` 之间只有一个 **merge main** 提交。内容 diff 与我上午验证的那份**逐字节相同**（5 个文件、+185 −29）。因此我上一条评论里的所有测量结果原样成立，无需重跑。

另外注意：autofix 在这期间尝试过一轮针对 R5-1 的修改（`28877a5e12`，把 ACP 腿的 `bootTimeoutMs` 从 30s 提到 60s），但**未通过 bite check、未推送**。这是好事 —— 我上午已经用故障注入实证推翻了 R5-1 的前提。

## 2. 但 main 这边变了：#11175 已合入

[#11175](https://github.com/QwenLM/qwen-code/pull/11175) *"make compress E2E deterministic"* 于 2026-09-06 10:53Z 合入 main，把**同一个套件**改成了驱动本地假 OpenAI 服务，不再调用真实模型。

我在今天的 main 上连跑三次：

| 配置 | 文件 | test 1 | test 3 | 重试 |
| --- | --- | --- | --- | --- |
| merge-base 套件（真实模型） | 83974 ms | 29525 ms | 54448 ms | 无 |
| #11094 套件（真实模型） | 122836 ms | 26336 ms | 96499 ms | 1 |
| **今天的 main**（假服务器）run 1 | **8200 ms** | 4118 ms | 4081 ms | 无 |
| **今天的 main** run 2 | **8195 ms** | 4118 ms | 4076 ms | 无 |
| **今天的 main** run 3 | **8200 ms** | 4123 ms | 4076 ms | 无 |

三次运行相差**不到 10 毫秒**。这个套件里已经没有真实模型延迟了，所以 #11094 放宽预算所针对的那个前提，在今天的 main 上**不复存在**：两个超时常量都成了空转。

`chat_compression` 在 main 上稳定为 `tokens_before=3607 → tokens_after=71`（缩减 98%）。这也意味着我上午测出来会成为**新抖动源**的那条 token 断言，现在变成**确定性**的了。

## 3. /compress 那一半唯一还该保留的东西

#11175 的假服务器是按 `requestIndex` 分发的：index 0 返回含 Einstein 的段落，其余 index 返回 `<state_snapshot>`。今天 main 上一次真实运行的有序遥测：

```
14:00:14.202  memory.recall            (没有发起模型请求)
14:00:14.221  api_request  index 0  <- 种子回合，拿到 'Einstein'
14:00:14.539  api_request  index 1  <- 托管自动记忆抽取器
14:00:14.631  memory.extract
14:00:14.741  api_request  index 2  <- /compress 侧查询
14:00:14.752  chat_compression 3607->71
```

也就是说，**压缩侧查询在 main 上实际是 index 2，而不是 fixture 写法所预期的 1**。把 #11094 的 `memory.enableManagedAutoMemory: false` 单独应用到今天的 main 上：`api_request` 从 3 降到 2，`memory.*` / `subagent_execution` 事件全部消失，耗时（8204 ms）与 token 值（3607→71）不变，索引映射变成"种子=0、侧查询=1"的结构性对应。

这个 fixture 目前能工作，只是因为它的 handler 对 index 不敏感。而 `globalSetup.ts` 里已经白纸黑字记着这一类 bug：多出来的一次请求"shifted every index … 42 reds across permission-control and tool-control"。

**所以：这个设置项要保留，但它的理由现在是"确定性"，不再是"省掉 40–52 秒延迟"。**

## 4. qwen-live 那一半完全没受影响

main 上 `packages/qwen-live/src/adaptor/acp-adaptor.ts` 仍然是 `INIT_TIMEOUT_MS = 10_000`。#11094 的这一半可以**干净地**应用到今天的 main，并且全绿：

- `packages/qwen-live` `acp-adaptor.test.ts` —— **14/14**
- `qwen-live-m4-acp-steering` + `-call` E2E —— **4/4**

我上午的故障注入证据（`10_000` + 12 秒握手延迟 → 逐字复现 macOS CI 失败；`30_000` 在 12 秒和 29 秒下都通过；失败发生在 `beforeAll` 因而 `retry: 2` 救不回来）原样成立。

## 5. 我上午三条发现的现状

| 发现 | 现状 |
| --- | --- |
| 1 · PR 描述实质失真 | **仍然成立，而且更严重** —— 描述现在既不符合 diff，也不符合它脚下的 main |
| 2 · 60 秒种子预算过紧 | **已失效** —— #11175 已经断言了种子完成，且假服务器让它在毫秒级返回 |
| 3 · token 断言是抖动源 | **已化解** —— 3607→71 稳定复现，不再依赖模型 |

## 建议

1. **把 qwen-live 那一半单独拆成一个 PR 立即合入。** 它有实证支撑、能干净应用、全绿，而且修的是 CI 重试救不回来的那种失败。它不该被 /compress 那边的冲突卡住。
2. **/compress 那一半在 #11175 之上重做**，只保留：`memory.enableManagedAutoMemory: false`（理由改为 requestIndex 确定性）、`readTelemetryEvent` + token 缩减断言（现在是确定性的真实成功闸门，而 main 只断言事件存在）、以及共享的 settings 常量。两个超时常量都应丢弃。
3. **重写 PR 描述**（无论怎么拆）。
