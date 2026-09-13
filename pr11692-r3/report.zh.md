## 第 3 轮验证 —— Linux、线上 Token Plan 端点，以及设置的写入路径

这是对[第 1 轮](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5650585151)和[第 2 轮](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5653625721)的限定范围增补。head 仍是 `2176e5a`，本轮不重复前两轮的矩阵，只补它们做不到的三块：**真实 DashScope 端点**（前两轮本机都没有 key，用的是假上游）、**Linux**（前两轮都在 macOS），以及**除手改 settings.json 以外写入 `timeoutMs` 的三种途径**。

**结论：仍然可以合入，没有阻塞项。** 在线上端点上，预算改动的效果与 PR 描述一致。有一条建议值得在本 PR 里顺手做，因为这个字段现在出现在 `/settings` 里：给它声明取值范围。目前任何超出约定的值都会被照单保存，运行时再悄悄换成默认值。两行改动即可修复，下面有验证。

### 环境

- **同一个 worktree 构建两条臂。** PR head `2176e5a` 与合并基线 `bc7a186` 之间只差本 PR 的 9 个文件。基线臂的做法是把这 9 个文件检出到 `bc7a186`、重建 core、打包，再还原。之后重新打包 PR，`cli.js` 逐字节一致。在打包产物里 grep 确认了两条臂的身份：PR 产物含抢救标注、`WEB_SEARCH_TIMEOUT_MS`、`12e4` 与 `6e5`；基线产物只有固定的 `6e4`。
- **运行环境。** 每次运行都是真实打包 CLI（`node dist/cli.js`），隔离的 `HOME`，Linux x86_64，Node 22.22.2。
- **线上运行**完全照 PR 自己的端到端计划：
  - `modelProviders` 里只有一个 ModelStudio Token Plan 条目（`token-plan.cn-beijing.maas.aliyuncs.com`，`BAILIAN_TOKEN_PLAN_API_KEY`）
  - `tools.webSearch` 下什么都不配
  - `qwen3.8-flash`，同一个提示词，`--approval-mode yolo --output-format stream-json`

  模型实际收到的内容从会话 transcript 的 `functionResponse` 读取。
- **确定性场景**使用假 DashScope：经 `--proxy` 传入的本地 CONNECT 代理，以真实 TLS 访问 `https://dashscope.aliyuncs.com/compatible-mode/v1`。假聊天模型会逐字记录它收到的工具结果。

### 测试计划（Linux）

| 步骤 | 结果 |
| --- | --- |
| `packages/core`：`web-search.test.ts` + `config.test.ts` | **869 通过** |
| `packages/cli`：`config.test.ts` + `settingsSchema.test.ts` + `settingsUtils.test.ts` | **564 通过** |
| `npm run generate:settings-schema` | **无 diff** |

### 线上 Token Plan —— 2026-09-13 15:40–15:53 UTC，基线与 PR 两条线同时跑

| 分支 | 预算 | 第 1 次 | 第 2 次 | 第 3 次 | 第 4 次 |
| --- | --- | --- | --- | --- | --- |
| 基线 `bc7a186` | 固定 60 秒 | `18.5s` | **`60.0s (partial result)`** | `10.2s` | `31.4s` |
| PR `2176e5a` | 默认 120 秒 | `48.7s`（2 次搜索） | **`69.7s`**（2 次搜索） | `10.7s` | `49.9s` |
| PR `2176e5a` | `WEB_SEARCH_TIMEOUT_MS=15000` | `15.0s (partial result)` | `15.0s (partial result)` | | |

- **两条臂各有一次超过 60 秒。** 基线那次被截断；PR 那次跑到 69.7 秒，返回了完整结果。每臂只有 4 次，样本小，但与作者测得的 13–107 秒一致。
- **基线那次截断就是 #11687 描述的缺陷，在线上复现了。** 模型收到 8,056 字符，其中 6,520 字符的"答案段"是没有任何标注的抽取器输出（见第二张图下半部分）。
- **两次 15 秒运行都在页面读取结果到达之前就被截断。** 它们走到了 partial 路径，但没有触发标注；标注由下面的确定性场景和第 1 轮覆盖。
- **页面列表：** 10 次无头线上运行共 130 条列表项，其中 129 条是裸 URL，例外见观察 3。

![PR 构建连接线上 Token Plan 端点，默认预算](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/01-live-token-plan-tui.png)

### 新增确定性场景

| # | 分支 | 上游 / 配置 | 显示行 | 交给模型的工具结果 |
| --- | --- | --- | --- | --- |
| N1 | 基线 | 流**正常结束**、没有旁白 item，页面 13,145 字符 | `Did 1 search in 0.0s` | 14,275 字符 —— 整页原文，无标注 |
| N2 | **PR** | 同样的上游字节 | `Did 1 search in 0.0s` | **7,330** —— 标注 + 正好 6,000，无 partial 标记 |
| N3 | 基线 | 搜索在 70 秒时完成 | `Did 1 search in 60.0s (partial result)` | 1,125 —— 旁白丢失；上游在 59,998 ms 被断开 |
| N4 | **PR** | 同上 | `Did 1 search in 70.0s` | 1,269 —— 带旁白的完整结果 |
| N5 | **PR** | 设置 `30000` + 环境变量 `700000` | `Did 1 search in 120.0s (partial result)` | 环境变量覆盖了一个合法设置，然后回退到默认值 |
| N6 | **PR** | settings.json 写成字符串 `"timeoutMs": "90000"` | `Did 1 search in 120.0s (partial result)` | 被忽略，启动时没有任何警告 |
| N7 | **PR** | 一个代理对跨在 6,000 截断点上 | `Did 1 search in 3.0s (partial result)` | 截断点退到 5,999；下一次请求里没有孤立代理项 |
| N8 | **PR** | `WEB_SEARCH_TIMEOUT_MS=40`，上游不回任何字节 | `Web search timed out after 0s.` | 见观察 1 |

- **N3/N4 是测试计划第 1 步的正向形式。** 一次需要 70 秒的搜索，在 `main` 上丢了旁白，在 PR 上能完成。
- **N1/N2 用实测回答了 triage 建议 2。** 界限和标注同样作用于"正常完成但没有旁白"的搜索。文档的那句话本身是准确的，只有 PR 正文里"cut off"的说法比代码实际范围窄。

![旁白没到时模型实际收到什么](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/02-model-payload-without-narration.png)

### 建议 —— 声明取值范围（triage 建议 3，仍未处理）

`tools.webSearch.timeoutMs` 是 `showInDialog: true`、`type: 'number'`，没有声明 `minimum`/`maximum`。运行时约定只写在 `resolveWebSearchTimeoutMs` 里：600000 以内的正整数，否则用默认值。`validateSettingValue` 看不到这条约定，而三条写入路径调用的正是它：`/settings`、`/config key=value`，以及 daemon 的 workspace-settings 路由。

| 值 | PR head 上的 `/settings` 或 `/config` | 同一棵树 + `minimum: 1, maximum: 600000` |
| --- | --- | --- |
| `700000` | 保存 | **拒绝** —— `Value must be <= 600000` |
| `-5` | 保存 | **拒绝** |
| `0` | 保存 | **拒绝** |
| `1.5` | 保存 | 仍会保存（类型是 `number`） |
| `90000` | 保存 | 保存 |

- **用户看到的情况。** 前四行的值在运行时全部作废。在对话框里保存 `700000` 并重启后，下一次搜索在 `120.0s (partial result)` 结束，上游在 119,981 ms 被断开。用户想要更长的预算，拿到的却是默认值，而且没有任何提示。
- **修复。** 这两行改动已实际构建，并通过真实 `/settings` 对话框和无头 `/config` 验证：写入时就会拒绝 `700000`、`-5`、`0`。
- **不建议的做法。** `1.5` 仍能通过。`type: 'integer'` 可以覆盖它，但 `SettingsDialog` 只有 `number` 的编辑分支，未经验证我不建议这样改。
- **daemon 路由**（`serve/routes/workspace-settings.ts` 里两处 `validateSettingValue` 调用）只通过读代码确认，没有实际驱动。

![超出约定的值被保存，然后被悄悄替换](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r3/03-settings-bounds.png)

### 观察 —— 本 PR 无需处理

1. **`formatBudget` 在 50 ms 以下会显示 `0s`。** 它的注释写着"never rounded to zero"，但 N8 显示 `Web search timed out after 0s.`。纯外观问题，没人会故意设 40 ms。
2. **超出范围的环境变量会盖掉合法设置（N5）。** CLI 只检查 `WEB_SEARCH_TIMEOUT_MS` 是否为正数，所以环境变量里的 `700000` 会覆盖合法的 `tools.webSearch.timeoutMs: 30000`，core 随后使用 120 秒默认值，而不是用户写的 30 秒。这与"其他值回退到默认值"的说法一致。
3. **上游返回的畸形候选 URL，既有问题。** 线上有一条候选列表项是 `- https://<b>github</b>.com/<b>Qwe`：带搜索高亮标签，而且被截断。它能通过新增的裸 URL 测试（`^- https?://\S+$`），引用策略也允许模型引用它。本 PR 没有改动候选列表代码；列出前先校验主机名可以作为后续项。
4. **对话框在按键成批到达时会把数字倒序，既有问题。** 它影响 `/settings` 里所有可编辑字段：当多个按键在一次读取中到达（非 bracketed paste、自动化输入），每个键都插在同一个过期的光标位置。在基线上往 `Cleanup Period (days)` 输入 `123`，保存成了 `321`；在本 PR 上 `45000` 保存成了 `54`。bracketed paste 和正常逐键输入都没问题。对这个字段来说，倒序的 `120000` 会被存成 `21`，而 21 ms 是合法预算。值得单独开 issue。
5. **"Raw page content"的说法稍微夸大了（措辞）。** 线上 `web_extractor` 的输出是按目标抽取的内容（"The useful information in <url> for user goal … Evidence in page: … Summary: …"），并不是页面本身。标注里真正要紧的那半句——旁白没有到达——是准确的。

### 本轮未验证

- Windows。本轮在 Linux 上跑，第 1–2 轮在 macOS 上跑。
- daemon 的 workspace-settings 写入路径：只读了代码，没有实际驱动。
- 线上时延每臂只有 4 次。
