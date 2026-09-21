# PR #12421 — 维护者验证：`5f6ff4a`，Linux，真实 CLI + 真实 provider

**结论：可以合入。** 我从同一棵源码树构建了两个 bundle：一个是 PR head，另一个只把 `packages/core/src/tools/read-file.ts` 回退到 merge base `364032a`。因此下文所有差异都只来自这一个文件。本次在 Linux（Debian 13，Node 22.22.2）上验证，这是 PR 没有覆盖的平台。除了复现作者的测试矩阵，这次也回答了 triage 评审留下的两个问题：真实 provider 接受放宽后的声明；在 base 上读不了 notebook 的真实模型，在 PR 上一次调用就能读到。至少有一个真实端点能端到端复现 #12420。这个端点是经 OpenAI 兼容代理访问的 GPT-5.6 模型（`gpt-5.6-luna`），它会把声明的每个属性都填上值。在 base 上它永远无法省略 `offset`/`limit`，所以每次读取 notebook 都失败，直到循环检测终止运行。

![TUI 中真实 gpt-5.6-luna 的前后对比](./01-tui-real-gpt56-before-after.png)

### 1. 真实模型 + 真实 CLI：#12420 循环的修复前后

同一提示词（"Read the Jupyter notebook at … and tell me exactly what its code cell prints. Use only the read_file tool."），`gpt-5.6-luna`，headless `-p`，每个构建、每种协议各跑 3 次：

| 构建 | 协议 | 成功读到 notebook 的次数 | 每次运行失败的 `read_file` 调用数 | 结束方式 |
| --- | --- | :---: | :---: | --- |
| base | Chat Completions | 0/3 | 36 / 40 / 32 | 循环检测（`consecutive_identical_tool_calls`），exit 1 |
| base | Responses | 0/3 | 13 / 9 / 16 | 1 次循环检测；2 次模型放弃（"I couldn't read the notebook…"） |
| PR | Chat Completions | **3/3** | 0 | 首次调用 `{"offset":null,"limit":null,"pages":null}` → 回答 `42` |
| PR | Responses | **3/3** | 0 | 同上 |

base 上失败的调用与 #12420 描述的模式完全一致。146 次调用全部带齐三个字段，连 `pages: ""` 也不例外。`limit` 在 1、5、10、20、100、200、1000、2000 之间轮换，这些值都得到 "offset and limit are not supported…"；另有 8 次传 0，得到 "Limit must be a positive integer"。同一提示词的交互式 TUI 运行在约四分钟后停在循环检测对话框（见文末图 2）。

**原因。** 我把每个构建实际发出的工具 payload（取自 CLI 自己的请求）直接发给该端点，每格采样 5 次：

| 目标 | base 声明 | PR 声明 |
| --- | --- | --- |
| notebook，Chat Completions | `offset:0, limit:200, pages:""` ×5 | `offset:null, limit:null, pages:null` ×5 |
| notebook，Responses | `offset:0, limit:200, pages:""` ×5 | 全 null ×5 |
| 文本文件，Chat Completions | `offset:0, limit:2000` ×3 / `limit:200` ×2，`pages:""` | 全 null ×5 |
| 文本文件，Responses | `offset:0, limit:2000, pages:""` ×5 | 全 null ×5 |

**归因（2×2，每格 4 次）：** base schema 配 PR 的描述文案，仍然 4/4 填数字；PR schema 配 base 的描述文案，4/4 发 null。修好这个端点的是 schema 放宽，新增的描述句子单独起不了作用。

**借助新重试提示的恢复能力。** 我用提示词强制首次调用为 `offset: 0, limit: 0`：
- PR + gpt-5.6：3/3 在下一次调用中原样发送 `Retry with:` 示例并成功。
- PR + qwen3.8-max：3/3 重试一次即恢复（2 次发送 null，1 次省略字段）。它的首次调用传的是字符串 `"0"`，现在得到的是 notebook 提示，而不是数值范围错误。
- 作为对照：base + qwen3.8-max 也 3/3 重试一次即恢复。会省略可选字段的模型本来就不会卡住；这个修复真正起作用的场景，是会填满每个属性的端点。

### 2. 真实 provider 接受放宽后的声明

我把 PR 的工具 payload 原样发给手头能访问的每个端点，并以 base payload 作为对照：
- **两种 payload 都返回 HTTP 200 且给出合法 `read_file` 调用：** DashScope `qwen3.8-max`（Chat Completions 与 Responses）、`qwen3.7-max`、DeepSeek `deepseek-v4-flash`、GPT-5.6 代理（Chat Completions 与 Responses）、Kimi `kimi-k3`（Anthropic Messages），以及另一个 Anthropic 兼容网关。
- **无法判定：** 两个端点返回账户错误（403 未开通、402 余额不足），base payload 下的结果完全相同。

### 3. 经真实 CLI 的确定性 A/B（脚本化 mock，三种协议）

脚本化端点通过 Chat Completions、Responses、Anthropic Messages 三种协议，向两个构建发出相同的工具调用：共 31 个步骤、24 次 CLI 运行，全部 exit 0。每一步模型看到的输出在三种协议之间完全一致（62/62）。从 base 到 PR，**有 13 个步骤从报错变为成功，且每一个都涉及 `null`；没有任何步骤从成功变为报错。**
- **Notebook：** 省略字段、逐个字段设为 `null`、三个字段全设为 `null`、以及 `pages: "   "`，都返回相同的两单元格输出，stdout 为 `42`。`offset:0,limit:0`、`offset:-1`、`limit:10`、`pages:"1"`、`pages:3`（被强制转换为字符串）都得到同一条 notebook 提示。mock 从这条错误中解析出 `Retry with: {…}` 并原样重放，读取成功。
- **文本：**
  - 首次全 null 读取返回完整内容。第二次全 null 读取、以及之后省略字段的读取，都命中 "unchanged since last read" 缓存；在 base 上前两次都是校验错误。
  - `offset:1,limit:1,pages:null` → `second`；`offset:null,limit:1` → `first`；`offset:2,limit:null` → 第 3–4 行。
  - `limit:0` 仍被拒绝，数字字符串（`"1"`）仍会被强制转换。
- **使用真实 `pdftotext` 的 PDF**（作者机器上没有这个工具）：全 null 和 `pages:null` 都能抽取两页，与省略字段完全一致。`pages:"2"` 配 null 数值参数时只返回第 2 页，`pages:"0"` / `"2-"` 仍被拒绝。
- **`file_path: null`** 仍被拒绝（`params/file_path must be string`）。
- **下游消费方：** 全 null 读取 notebook 后，`notebook_edit` 被允许（`print(42)` → `print(43)`）；全 null 读取文本后，`edit` 被允许。在 base 上这两次写入都因"未读取"被拒。
- **`schemaCompliance: "openapi_30"`：** 线上发出的是 `{"type":"integer","nullable":true}`，没有 type 数组，null 读取仍然成功。

### 4. 进程内差分与测试强度

- **并排差分。** 我在同一进程中加载 base 与 PR 两版 `ReadFileTool`，跑了 3840 种参数组合：notebook / 文本 / 30 行文本 / PDF × 8 种 offset × 6 种 limit × 10 种 pages，原生 PDF 开关各一遍，使用真实 `pdftotext`。没有任何崩溃。
  - **含 `null` 的 1320 种组合：** 1320 种全部与"删掉 null 键后的同一调用"结果一致，包括校验、模型内容、`getDescription()` 和 `toolLocations()`。base 会拒绝全部 1320 种；在 PR 上有 626 种现在能通过，其余仍因其非 null 的取值被拒（例如 `limit: 0` 或 notebook 分页）。
  - **不含 `null` 的 2520 种组合：** 与 base 相比没有任何一种改变判定结果。894 种只有文案不同：534 种是 notebook 提示的统一，360 种是 `offset: 1.5` 时 Ajv 文案从 `must be integer` 变为 `must be integer,null`。
  - **缓存：** 我测了 49 对完整读取形式（省略字段、任意 null 组合、空白 `pages`）。49 对中第二次读取全部命中未修改文件缓存，与 base（去掉 null 字段后）一致。
- **单元测试：** PR 的 4 个相关测试文件 346/346 通过，与 PR 描述一致。只回退 `read-file.ts` 时，`read-file.test.ts` + `responses-converter.test.ts` 的 203 个测试中有 17 个变红。
- **变异测试：** 针对改动行的 16 个定向变异中有 12 个被杀死：每一行归一化、检查顺序、重试示例内容、空白 `pages` 的 trim 顺序，以及三处 schema 放宽。存活的 4 个：
  - `execute` / `getDescription` / `toolLocations` 里的三处 `?? undefined` 在运行时不可达。`build()` 会先执行 `validateToolParams` 完成归一化。唯一的其他入口是 PreToolUse hook 的 `updatedInput`，它会在 `setArgsInternal` 里经 `build()` 重新构建。
  - 工具描述中新增的 notebook 句子没有被任何测试钉住。上面的 2×2 结果也表明，起作用的不是这句话。
- **CI：** `5f6ff4a` 上全绿，包括 Test、Lint & Static、no-AK 集成测试、两个 Desktop Shell 任务和 web-shell E2E smoke。

### 非阻塞备注

1. **这是默认工具 payload 中第一次出现 JSON Schema 联合类型。** 在未配置 MCP server 和扩展的情况下，默认 headless 工具集（14 个工具）和默认交互工具集（20 个工具）中，base 不发送任何 `"type": [...]` 或 `anyOf`。本 PR 发送 3 处，全部在 `read_file` 里。由于每个请求都带着 `read_file`，任何把 `type` 当作单个字符串解析的 OpenAI 兼容后端或网关，都会开始拒绝*所有*请求，而不只是读取请求。所有正常应答的 provider 都接受新 payload。`schemaCompliance: "openapi_30"` 是可用的兜底方案（上文已验证）。建议在 PR 的 Risk 部分或文档里补一行，方便自建后端的用户知道这个开关。我没有测试 Ollama、llama.cpp 这类本地运行时。
2. `docs/developers/tools/file-system.md` 仍未提到 `null`（triage 中已提出），可以作为后续跟进。

图 2（base：交互式运行最终停在循环检测对话框）：

![base TUI 停在循环检测对话框](./02-base-ends-in-loop-detection.png)

harness 脚本见 `harness/`，逐步数据见 `data/`。
