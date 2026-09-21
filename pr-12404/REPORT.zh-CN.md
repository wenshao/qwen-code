## 本地运行时验证 — PR #12404 @ `f6d25c84ec`

**结论：建议合并。**

- PR 描述中的每一条主张，都在真实 daemon 和真实 Web Shell 上复现了，并与 merge base 做了干净的 A/B 对比。
- 两个构建发给模型的输入逐字节一致。
- 建议合并前顺手加一处一行的 null 防护。修复已验证（§6a），不阻断合并。
- 对 triage 机器人提出的三个疑问：
  - (a) `[null]` 元素：**确认存在**。本 PR 把原本只在实时视图出现的渲染失败变成了持久性的。
  - (b) 超大数组：历史**仍可读取**。
  - (c) 附件导致偏移错位：**Web Shell 无法触发**。

### 测试方式

- **同一 worktree 出两个构建：**
  - **PR** = `f6d25c84ec`。
  - **base** = 把 PR 的 5 个生产文件还原为 merge base `065dd351c8` 的版本（`git show 065dd351c8:<file>`），再完整执行 `npm run build && npm run bundle`。
  - 之后重建 head，改动涉及的 chunk 与 Web Shell 资源逐字节一致。所以两个构建只差这 5 个文件。
- **运行环境：** 真实 `qwen serve` → ACP 子进程 → 磁盘 JSONL，在 Chromium（Playwright）中打开 daemon 自带的 Web Shell。模拟的 OpenAI 兼容模型服务记录每一个请求体。
- **标签来自真实的 `@` 选择器**（Files / Extensions / MCP resources），不是手工构造的 metadata：
  - 一个 link 安装的探针扩展 `browser-kit`；
  - 一个 stdio MCP 服务器 `o2-docs`，0 个资源，生成 `@mcp:o2-docs`。
- 两个构建各用独立的 runtime 目录。每次"重启"都是真实的 daemon 进程重启。
- **环境：** Linux x64，Node 22.22.2。

### 1. 核心主张：标签在刷新和 daemon 重启后保留

![tags A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/01-tags-ab-light.png)

| | Base | PR |
| --- | --- | --- |
| 刚发送（实时） | 4 个标签。扩展和 MCP 标签高 22 px、右内边距 0 px、圆角 4 px、等宽字体、`--secondary` 背景 | 4 个标签。全部为 28 px / 8 px / 8 px、无衬线字体、`--background`，与文件标签相同 |
| 浏览器刷新（空闲会话） | **0 个标签**，显示 `@…` 原文 | 4 |
| daemon 重启后重新打开 | 0 | 4 |
| JSONL 用户记录 | 没有 `systemPayload` | `systemPayload.inputAnnotations` 保存了发送时的 4 条注解，原样一致 |

- 在 base 上，只要刷新空闲会话，标签就已丢失，与 PR 描述一致。
- 长名称会被截断（`src/very-long-module-name-for-tag-tr…`）。
- 重启后，点击恢复出来的 `README.md` 标签会发出 `GET /file?path=README.md&maxBytes=262144`，返回 200，预览显示测试文件内容。此时 base 上没有可点击的标签。

![file preview](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/02-file-preview-after-restart.png)

深色主题：[01-tags-ab-dark.png](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/01-tags-ab-dark.png)

### 2. 模型输入不变

- 对比两个构建主回合的请求，已归一化 runtime 路径、时间戳和 UUID。
- `messages` 完全一致，两边都是 39,781 字节。
- 两个请求中都不出现 `inputAnnotations` 字符串。

### 3. 偏移对齐

以下每个用例都用真实编辑器输入，并分别在实时、刷新后、daemon 重启后检查。PR 上全部通过：

- **标签 + 附加文本文件。** 客户端会追加 `\n\n@attachment:///notes.txt`，回放时作为后缀去掉。
- **标签 + 图片。**
- **行首空格。**
- **多行输入**（Shift+Enter），标签在第 2 行。
- **标签前有中文和 emoji**（UTF-16 偏移）。
- **同一个文件引用两次。**

triage 机器人担心的错位为什么在 Web Shell 中无法发生：
- 客户端只会在末尾追加附件 token。
- `stripGeneratedAttachmentTokens` 只去掉后缀。
- 所以基于编辑器文本计算的偏移始终有效。

### 4. 兼容性

- **旧历史在 PR daemon 上：** base 写入的会话显示为纯文本，无报错，也不会根据文本推测标签。
- **回滚：** PR 写入的会话在 base daemon 上显示为纯文本，无报错。多出的字段直接被忽略。

### 5. 其他因此受益的场景

![edit after restart](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/03-edit-after-restart.png)

- **编辑恢复后的消息。** 重启后把 "Review" 改成 "Recheck"：
  - PR：4 条注解全部重映射（偏移 +1），刷新后标签仍在。
  - Base：编辑后的提示发出时带 0 条注解。
- **服务端排队的提示。**
  - 排队面板复用 `ReadonlyComposerTag`，所以也采用了统一样式。
  - 排队提示执行后，刷新时标签仍在：PR 3 → 3，base 3 → 0。

![queued chips](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/05-queued-chips.png)

### 6. 加固建议（不阻断）

**(a) `[null]` 元素变成持久性的渲染失败。**

我直接发送 `POST /session/:id/prompt`，其中 `_meta.inputAnnotations: [null, valid]`。这需要 daemon token，Web Shell 自己不会发出这种请求。

- **实时视图：** 两个构建都显示 "This message could not be displayed."。报错为 `splitComposerTagContentByAnnotations` 中的 `TypeError: Cannot read properties of null (reading 'type')`。这条实时路径在 base 上本来就会失败。
- **刷新之后：**
  - Base 恢复正常，显示纯文本。
  - PR 每次加载都以同样方式失败，因为 `[null]` 已经写入磁盘。
- 失败被单条消息的错误边界拦住，会话其余部分正常显示。

![null annotation](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/04-null-annotation-durable.png)

**建议修复，已验证：** 在 `packages/web-shell/client/utils/composerTag.ts:209`，给现有的 `annotation.type` 判断加上空值检查。

```ts
if (!annotation || annotation.type !== 'reference') continue;
```

- 只改这一行，两个已持久化的会话都能正常显示，有效的 `README.md` 标签也保留下来。
- 它同时修复了实时路径。
- 在现有 `composerTag` 测试旁加一个用例即可钉住。

**(b) 超大数组。** 写入路径没有数量或体积上限。同级字段 `attachmentReferences` 的上限是 256。

- **4,501 条注解（5 MB）：** 已持久化，`/load` 返回 200，消息正常显示。
- **9,301 条注解（10.3 MB，刚好在请求体上限）：** 被接受并持久化。重启后首屏只显示助手回复：
  - `/load` 把这条超大记录放到了第一页之外。
  - 接下来向前翻的 `/transcript` 页返回 0 条事件，且 `hasMore: true`。
  - 向上滚动后客户端跟随游标，用户消息出现。
- 所以历史仍可读取，triage 机器人担心的"历史无法加载"没有发生。在 base 上，同样的请求根本不会持久化注解。
- 在写入端加数量上限（例如 256）可以消除这个现象。锦上添花。

### 7. 测试

- **head 上的单元测试：**
  - acp-bridge：116/116
  - core：144/144
  - cli `Session.test.ts`：1,041/1,041
  - web-shell（UserMessage、QueuedPromptDisplay、transcriptToMessages、composerTag）：328/328
- **变异测试：6 个变异全部被杀死。**
  - 去掉普通路径上的 `|| inputAnnotations` 条件；
  - 去掉延迟 `/advisor` 路径上的同一条件；
  - 去掉 `inputAnnotations` 字段；
  - 去掉 `structuredClone`；
  - 回放时不转发注解；
  - 回放时转发非数组值。
- CSS 改动没有单元测试覆盖，由上面的端到端测量覆盖。

### 合并检查清单

- **`f6d25c84ec` 上的 CI：** 24 通过、32 跳过、0 失败。Test (ubuntu)、Lint & Static、Integration no-AK、Real daemon E2E 和 web-shell visuals 截图均为绿色。
- **合并：** 可以干净合入当前 main（`97b1b252e3`，比 merge base 新 11 个提交）。唯一重叠的是 #12311 对 `Session.ts` 的改动，位于不同代码块。
- **评审：** 已有 1 个批准（chiga0）。
- **建议：** 合并。最好先把 §6a 的一行防护一并加上。

### 本次未覆盖

- macOS 和 Windows。
- 真正执行外部 MCP 服务器或扩展。探针只需要能被列出和引用。
- 传入 `parseUserMessageContent` 或 `onComposerTagClick` 的嵌入式宿主。
- 两点说明，不阻断：
  - 非文件类可点击标签悬停时，边框从强调色改成了中性色；键盘聚焦（focus-visible）时仍是强调色。这只发生在传入 `onComposerTagClick` 的宿主中，看起来是有意为之。
  - 发送前编辑器里的标签，扩展和 MCP 仍是等宽字体。这不在本 PR 范围内。

### 无关发现

驱动编辑器时，我遇到一个 base 上同样存在的崩溃，与本 PR 无关：
- 步骤：在会话的第 3 条消息里，选一个标签、输入文字、再用 `@` 选一个标签，然后发送。
- 结果：`Calls to EditorView.update are not allowed while an update is in progress`，整个 Web Shell 显示 "Something went wrong"。
- 我是用 Playwright 键盘输入复现的，可能值得单独开 issue。

图表、各场景的原始 JSON、数值摘要和测试工具：https://github.com/wenshao/qwen-code/tree/asserts/pr-12404
