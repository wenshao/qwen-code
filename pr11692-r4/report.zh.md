## 第 4 轮验证 —— `6645d55`：取值范围、限定后的部分结果措辞，以及新增测试

本轮只覆盖[第 3 轮](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5654368701)（`2176e5a`）之后的变化：三个提交、9 个文件、+125/−12。没有再合入 `main`（合并基线仍是 `bc7a186`），依赖锁文件也没变。

**结论：可以合入，没有新的问题需要修。**
- **取值范围。** 第 3 轮的建议已正确落地，所有写入路径现在都会校验范围。
- **措辞。** 限定后的 R1-1 措辞，在我能构造出的每个分支上都与运行时行为一致。
- **测试。** 五个新测试在各自保护的代码被破坏时都会变红。

### 改了什么

| 提交 | 改动 |
| --- | --- |
| `01ec3e4d25` | 给 `tools.webSearch.timeoutMs` 加上 `minimum: 1, maximum: 600000`，并加一条见证测试 |
| `cecf8ced39` | 四处"部分结果"承诺都加了限定（R1-1）；core 导出 `MAX_WEB_SEARCH_TIMEOUT_MS`，schema 直接引用它（R1-2）；新增三条 core 测试（R1-3/4/5） |
| `6645d558ad` | 把这两个常量补进两个完整手写的 core mock |

**第 3 轮的线上数据仍然适用。** 运行时搜索路径没动：`web-search-dashscope.ts` 零改动，`web-search.ts` 里唯一改动的非测试代码是把上限常量改成导出。所以第 3 轮的线上 Token Plan 矩阵依然反映这个 head，我没有再花 key 重跑，而是用假上游在两个 head 上重跑了超时的各种形态，结果见下文，两边完全一致。

### 构建与测试 —— Linux，head `6645d55`

| 步骤 | 结果 |
| --- | --- |
| `packages/core`：`web-search.test.ts` + `config.test.ts` | **873 通过**（第 3 轮 869，加上 4 条新测试） |
| `packages/cli`：`config` + `settingsSchema` + `settingsUtils` + `acpAgent.worktree` + `facade` | **700 通过**（5 个文件） |
| `npm run generate:settings-schema` | **无 diff** |
| 打包后的 CLI | 运行时描述显示 `default 120000, max 600000`（从 daemon 的 `GET /workspace/settings` 读回）。说明在模块顶层导入的 core 常量在打包产物里能正确解析，没有渲染出 `undefined`。 |

### 各写入路径上的取值范围

**用真实打包 CLI 的 `/config` 扫一遍边界：**

| 值 | `6645d55` |
| --- | --- |
| `700000` | 拒绝 —— `Value must be <= 600000` |
| `600001` | 拒绝 —— `Value must be <= 600000` |
| `600000` | 保存 |
| `1` | 保存 |
| `0` | 拒绝 —— `Value must be >= 1` |
| `-5` | 拒绝 —— `Value must be >= 1` |
| `1.5` | 保存（第 3 轮就有意没用 `integer`） |
| `90000` | 保存 |

**其他写入路径，两个 head 对比：**

| 写入路径 | `6645d55` | `2176e5a` |
| --- | --- | --- |
| `/settings` 对话框 | `700000` 未保存；`90000` 保存 | `700000` 被保存 |
| daemon `POST /workspace/settings`（scope `user`） | `700000`、`600001`、`0` → **400 `invalid_value`**；`600000`、`1.5`、`90000` → 200 | 所有值 → 200 |
| daemon `POST /workspaces/:workspace/settings`（scope `workspace`） | `700000`、`0` → **400 `invalid_value`**；`90000` → 200 | 所有值 → 200 |

第 3 轮对 daemon 路由只读了代码；这一轮在两条臂上都用真实 `qwen serve` 实际调用了。

![第 3 轮 head 与 6645d55 的 /settings 对比](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r4/01-settings-bounds-before-after.png)

### R1-1 —— 限定后的措辞与运行时对照

预算 3 秒，假上游发完表中列出的事件后就不再回任何字节，两个 head 收到的字节完全相同。

| 上游停止前已到达的内容 | 6645d55 | 2176e5a |
| --- | --- | --- |
| 只有旁白增量，搜索调用仍在进行 | `Web search timed out after 3s.` —— 旁白被丢弃 | 相同 |
| 一个状态为 `failed` 的 `web_search_call`，外加旁白 | `Web search timed out after 3s.` | 相同 |
| 抽取器页面正文（13,145 字符）已完成，搜索调用仍在进行 | `Web search timed out after 3s.` —— 页面正文被丢弃 | 相同 |
| 对照：搜索调用已完成，外加一次页面读取 | `Did 1 search in 3.0s (partial result)` —— 7,438 字符，带标注 | 相同 |

- **第 1、3 行正是新措辞描述的情形：** "if the budget expires before the first search call finishes, the tool reports a timeout error instead"。
- **对照行对应 "once at least one search call has completed"。**
- **措辞小瑕疵，不值得再推一轮。** 状态为 `failed` 的搜索调用其实已经"结束"了，但运行时把它当作没有搜索（第 2 行）。写成"成功完成"会更准确。

### 变异检验 —— 五条新测试都有辨别力

每个变异单独施加到 `6645d55` 的树上，重跑它所属的测试集，之后用 `git checkout` 还原并确认树是干净的。不做变异时两个测试集分别是 118/118（core）和 59/59（cli）全过。

| 变异 | 被哪条测试杀死 |
| --- | --- |
| R1-3：把超时分支挪到部分抢救之前 | *salvages the partial result when the budget expires after a search ran* |
| R1-4：用普通 `slice` 代替 `sliceAtCharBoundary` | *does not split a surrogate pair when salvaged page text is truncated* |
| R1-5：自动路径跳过 `resolveWebSearchTimeoutMs` | *normalizes an out-of-range budget on the automatic path* |
| R1-5：env 声明路径跳过它 | *normalizes an out-of-range budget on the explicit and env-declared paths* |
| R1-5：显式路径跳过它 | 同上 |
| schema 的 `maximum` 手写成 `500000` | *should bound tools.webSearch.timeoutMs to the runtime contract* |
| 去掉 schema 的 `minimum` | 同上 |

每个变异都恰好让一条测试失败，而且正是声称守护该性质的那一条。

### 观察 —— 无需处理

1. **`/settings` 拒绝时不给提示。** 按 Enter 后该行只是不显示值：校验失败的分支直接清空编辑内容，不说明原因。所有带取值范围的字段都这样，并非本 PR 引入；`/config` 和 daemon 都会给出原因。
2. **daemon 的字段描述里没有 `minimum`/`maximum`。** `GET /workspace/settings` 只返回 `category`、`description`、`key`、`label`、`requiresRestart`、`type`、`values`，所以 Web Shell 表单无法在提交前校验范围，只能依赖服务端的 400。所有带范围的设置都一样，属既有情况。

### 本轮未验证

- 线上 Token Plan 重跑：运行时路径自第 3 轮以来没有变化。
- Windows。
- Web Shell 设置表单的界面；daemon 路由是直接调用的。

撰写时 `6645d55` 的 CI：24 项通过、24 项跳过，`review-pr` 仍在运行。自动评审的 CHANGES_REQUESTED 是针对 `01ec3e4d25` 提的，它的五条发现都已在 `cecf8ced39` 中处理，并在上文逐条验证过。
