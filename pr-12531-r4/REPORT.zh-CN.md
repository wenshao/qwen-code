## 维护者验证第 4 轮（本地真实环境）— PR #12531 @ `7e489a5b33`

**结论：不能原样合入。相对 `main` 仍有一族 fail-open；一个只作用于限制型规则的小补丁（候选 E）能把它全部关掉，且不改变任何授权行为。** 本轮对这一族做了穷举测量，而不是逐个举例。

bot 另外两个未关闭的 Critical（R23-1、R26-1）都成立，但都**不是**相对 `main` 的回退：新的授权 guard 漏掉了这些情形，于是行为停留在 `main` 的样子。放到 #13412 跟踪是合理的。

| # | 项目 | 在 `7e489a5b33` 上的状态 | 相对 `main` | 阻塞合入？ |
| --- | --- | --- | --- | --- |
| 1 | 部分分隔符限制规则 `mcp__<key>_*`：**A**（bot R26-2）与 **B**（本轮新发现） | fail-open，16,502 个规则×工具组合中有 152 个 | **回退**：main 每一行都拦截 | **是**，候选 E 修复 |
| 2 | R23-1：注册了同拼写 server 时，legacy 精确 `allow` 仍授权 | 授权（E1） | 与 main 相同 | 否；文档与代码不一致 |
| 3 | R26-1：歧义池读的是会话注册表，不是子代理自己的注册表 | 看不到 agent 本地的竞争者（P3）；拒绝 agent 本地的真正属主（P4） | P3 与 main 相同；P4 是 fail-closed | 否 |
| 4 | 第 1–3 轮测过的全部内容，以及 PR 自己的嵌套 key 测试计划 | 成立 | — | — |

### 对第 3 轮结论的更正

第 3 轮我写过“合入候选 D 后我没有阻塞项”，这个结论是错的。

第 3 轮的扫描只取了“在 key 自身边界处、注册名的字面前缀”，从未生成停在分隔符内部的前缀，也没有生成粗粒度的 legacy 前缀。用本轮的差分重新测量，候选 D（落地为 `d62f5b79d2`）相对 `main` 仍丢失 **569** 条限制。作者 R23/R24 两轮修掉了其中 **417** 条，剩下的 **152** 条就是第 1 项。

另外，候选 E 翻转的那 3 行测试也出自我：它们是我第 2 轮候选 C 加的（“未截断的注册名不得进入兜底”），当时是为了保留 R17-2 的决定。R24 让同一个兜底开始限制普通工具之后，这 3 行只是在钉住这种不对称。

### 环境

- **实测臂。** 每个臂都从 git 构建：`pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`，全部 exit 0：
  - **base** `b3dda468f2`（merge-base）；
  - **prev** `d62f5b79d2`（我第 3 轮的候选 D，已落地）；
  - **head** `7e489a5b33`；
  - **merge**：head 合入当前 `main` `43a6e1e5e4`，无冲突；
  - **cand E**：head 加上 §1 的补丁。
- **装置。** 与第 2–3 轮相同：
  - 真实 stdio MCP server，其自身调用日志就是“是否执行”的判据；
  - 脚本化的 OpenAI 兼容模型，只调用目标工具；
  - 每次运行使用全新 `HOME`。
- **新增场景组：**
  - **N**：部分分隔符；
  - **E**：R23-1；
  - **P**：R26-1，使用 agent frontmatter 的 `mcpServers`；
  - **Q**：PR 自己的嵌套 key 测试计划。
- **运行：**
  - headless `qwen -p`：83 个场景 × 5 个臂 = 415 次；
  - `qwen --acp`：9 个场景 × 3 个臂；
  - 真实交互 TUI：N8、N2 各跑 3 个臂。
- **模块级差分（本轮新增）。** 取 18 个 server key × 14 个工具名。对每个工具，生成所有在字面上等于它**自身**原始、注册或 legacy 拼写的精确名，以及这些拼写的每个 `<前缀>*`，再加上裸 server 写法，共 16,502 个规则×工具组合。每个臂都按生产代码的调用方式调用其构建产物：
  - L4 `PermissionManager.evaluate`（deny 与 ask 各一次），传入 invocation 的 alias 和 `mcpIdentity`；
  - L1 调度器的 `isToolEnabled`；
  - 该臂实际使用的子代理 `disallowedTools` 判定。

  “丢失”指 `main` 会限制而该臂不限制的组合。这里不涉及注册表竞争者，因为限制型匹配从不读注册表。
- Linux x86_64，Node 22.22.2。第 3 轮是在 macOS arm64 上跑的。

### 1. 未解决：部分分隔符限制规则 fail-open（bot R26-2 + 新发现的原始 key 拼写族）

剩下的 152 条丢失全部是同一种形态：限制型通配 `mcp__<key 的某种拼写>_*`，前缀恰好停在 key 自身分隔符的第一个下划线处。这正是 R24 为 `mcp__github_*` 恢复的“该 server 全部工具”的粗写法（N1 行）。`matchesRestrictiveMcpName`（`rule-parser.ts:1912`）只在两个条件同时满足时接受它：

- 规则是**注册名**的字面前缀；
- 工具段**不以** `_` 开头（`:1936-1937`）。

于是留下两个缺口：

| 族 | 规则形态 | 组合数 | 真实 CLI 见证（base → head） |
| --- | --- | --- | --- |
| **A**（bot R26-2） | 注册拼写，工具名以 `_` 开头：`mcp__foo_*` → `foo/_internal`，`mcp__github_*` → `github/_admin_reset`，`mcp__foo__*` → `foo_/_internal` | 64 | N2 deny、N3 ask、N4 子代理、N6、N7（YOLO）、N14：拦截 / ask / 过滤 → **执行** |
| **B**（新） | key 含 `[A-Za-z0-9_-]` 以外字符时，用原始或 legacy 拼写，影响该 key 的**全部**工具：`mcp__zybio.db_*`、`mcp__foo:bar_*`、`mcp__com.example.enterprise-search_*`、URL key | 88 | N8 deny、N9（YOLO）、N10 ask、N11 子代理：拦截 / ask / 过滤 → **执行** |

- **ACP 上相同。** N2、N3、N7、N8、N9、N10、N14 在 head 上都执行了；base 和 cand E 报 `Tool "…" is disabled.`，或发出 `session/request_permission`。
- **head 上契约自相矛盾。** 注册拼写 `mcp__zybio_db_*` 能拦截（N12），`mcp__zybio.db__*`（N13）和 `mcp__zybio.db`（D4）也能，唯独单下划线的原始拼写不行。同样，`deny mcp__foo__*` 拦得住 `foo_/deploy`（N15），却拦不住 `foo_/_internal`（N14）。
- **A 族是有文档记载的**（设计文档 `:38`：“以下划线开头的注册工具段保留边界拒绝”）。但在限制方向上，这种“拒绝”唯一的效果就是 deny 不生效，而文档自己的 Asymmetry 一条写的正是这种失效。授权方向的 R17-2 拒绝是另一回事，候选 E 保留它。
- **暴露条件。** 需要有一条写成 `mcp__<key>_*` 的限制条目。A 族还要求工具名以 `_` 开头；B 族要求 key 含 `.`、`:` 或 `/`，这在 `zybio.db` 这类 key 和 URL key 中很常见。满足条件时，可信 server 上或 YOLO 下工具会无提示执行，而 `main` 会拦截。

**候选 E。** 补丁只影响限制型规则：`matchesRestrictiveMcpName` 只从 deny、ask、`disallowedTools` 进入，或经 `matchesToolPattern` 进入，而后者的生产调用方全部是限制型。它采用的规则是：前缀以 key 的三种拼写之一停在 key 自身分隔符处或分隔符内时，就指向这个 key。

补丁 diff 见英文部分的折叠块。内容如下：

- `rule-parser.ts` +8/−5。
- 测试：`mcp-server-rule-collision.test.ts:1494-1516` 原来 3 行的块扩成 8 行：
  - 原有 3 种形态，改为断言受限；
  - `github/_admin_reset`；
  - 原始 key 拼写的 `zybio.db`、`foo:bar`、`foo.bar`；
  - `mcp__foo__*` 下的 `foo_`。
- 每行都检查 `matchesToolPattern`、deny `evaluate`、`isToolEnabled`、ask `evaluate` 和 `matchesAgentToolBlocklist`，并断言 **`allow` 仍为 `default`**，即保留 R17-2 的授权钉子。
- 新增一个对照：`mcp__foo_*` 不会限制 key `foobar`。
- 两份设计文档 `:38` 的那句话同步修改。
- 共 4 个文件，+55/−13。

| 检查 | 结果 |
| --- | --- |
| 真实 CLI，83 个场景 | 恰好 10 个 fail-open 行（N2–N4、N6–N11、N14）回到 base 行为。其余 **73 行与 head 完全一致**，包括所有 allow、ask 和授权 guard 行（S、U6/U7、F7/F8、K5、E、P、Q）。 |
| ACP（7 个 fail-open 行） | 全部重新被拦截或请求确认。 |
| 差分，16,502 个组合 | 相对 main 的丢失：head **152** → cand E **0**，四个闸门都是如此。cand E 还新增 17 条 main 没有的、只针对自身 key 的限制：52 字符 URL key 的原始 / legacy 部分分隔符规则。main 漏掉它们，是因为截断后的 legacy alias 丢了分隔符。这些都是 fail-closed，不涉及其它 key。head 与 cand E 相差 169 个组合 = 152 + 17。 |
| 先红后绿 | 8 个新测试行在 head 上**全部失败**；cand E 上 collision 套件 101/101 通过。 |
| 变异体，**5/5 被杀** | 每个变异都会让 PR 的 4 个权限套件（708 个测试）中至少一个失败：删除新析取项（10 个失败）；恢复 `_` 豁免（6）；只用注册拼写、去掉原始与 legacy（3）；接受任意 key 头前缀、不要求分隔符（1）；让兜底参与授权（14）。 |
| 门禁 | core 定向套件（35 个文件，7 个跳过）：cand E **2854/2854**，head 2848/2848。CLI `Session.test.ts` 1114/1114。core 全量 34076 通过、6 失败；同样 6 个在 base 和 head 上以相同方式失败（root 用户与本地 git 环境相关，均不涉及权限）。eslint `--max-warnings 0`、`tsc --noEmit`、prettier 均干净。补丁可干净应用到 head，也可应用到 head 与 main 的合并结果。 |

### 2. R23-1：注册了同拼写 server 时，legacy 精确 allow 仍授权（不是回退）

| id | server | 规则 | base | head |
| --- | --- | --- | --- | --- |
| E0 | 只有 `foo:bar/a.b` | `allow mcp__foo_bar__a.b` | 执行 | 执行（唯一归属，兼容行为） |
| **E1** | 再加 `foo_bar/unrelated` | `allow mcp__foo_bar__a.b` | 执行 | **执行**，ACP 上相同 |
| E2 / E3 | 同上 | `mcp__foo_bar__*` / `mcp__foo_bar` | 执行 | ask |

E1 与 `main` 的行为相同，所以不是回退。但设计文档 `:36` 写的是“同时注册了 `foo_bar` 时，……历史精确条目不能授权 `foo:bar`”，代码并没有做到。可以现在收窄那句话，也可以留在 #13412 里处理。我不认为它应该阻塞合入。

### 3. R26-1：歧义池读的是会话注册表（两个方向都已复现）

`isMcpAllowAmbiguous` 读的是 `this.config.getToolRegistry()`（`permission-manager.ts:452`）。带 frontmatter `mcpServers` 的子代理运行在自己重建的注册表上，但沿用会话的 PermissionManager。

| id | 设置（`allow: ["agent", "mcp__foo_bar__*"]`） | base | head |
| --- | --- | --- | --- |
| P1 | 主线程，`foo.bar` 与 `foo_bar` 都在会话级 → `foo.bar/evil` | 执行 | ask（已修复） |
| P2 | 同上，由子代理调用 | 执行 | ask（已修复） |
| **P3** | `foo_bar` 只在 agent 的 `mcpServers` 里 → `foo.bar/evil` | 执行 | **执行**：外来工具仍被自动批准，与 main 相同 |
| **P4** | 同上 → agent 本地的**属主** `foo_bar/evil` | 执行 | **ask**：真正的属主失去授权（fail-closed，新行为） |

P3 与 `main` 一致。P4 是 fail-closed 的体验回退，只在 agent 本地 MCP server 的拼写与会话级 server 碰撞时出现。两者都不应阻塞合入，都属于 #13412 要定的“歧义判定归哪个注册表”的问题。

### 4. head 上仍然成立的内容

- **既有各行。** 第 3 轮候选 D 那次运行的 48 行在 head 上判定全部相同；prev 在 Linux 上也逐格复现了第 3 轮 macOS 上的结果（图 3 中的 R、T、U、F、K、A 组）。只有一个授权行是有意改变的：K5 从 prev 的 ask 变成 head 的执行，因为 R24 现在会授权唯一的 `__` key 归属方。此外，R24 自 prev 以来还修复了 N1、N5、N12、N15。
- **PR 自己的嵌套 key 测试计划**（Q1–Q5）与描述一致：在 `mcp__foo__*` 下，外来的 `foo__bar` 需要确认；两个边界归属方都需要确认；裸 `mcp__foo__bar` 两边都限制。
- **pomelo-nwu 的 R4-1**（限制型前缀保留 legacy 拼写）：
  - head 上所有 legacy 前缀形态都已满足，包括 prev 时仍丢失的 252 条长 URL key 粗粒度 legacy 前缀；
  - 仍丢失的 legacy 行只剩 4 条 B 族部分分隔符，候选 E 会把它们关掉。
- **head 合入当前 main 的结果** 在 83 个真实 CLI 场景和 16,502 个差分组合上都与 head 完全一致。

### 5. 门禁与覆盖

| 门禁 | 结果 |
| --- | --- |
| `7e489a5b33` 的 CI | 25 个成功、22 个跳过。被取消的只有被后续调度取代的 `route` 任务。`review-pr` 已完成（R26-1、R26-2 就出自这一轮）。 |
| head 单测 | core 定向套件（35 个文件，7 个跳过）2848/2848；CLI `Session.test.ts` 1114/1114。 |
| 评审状态 | `chiga0` 已在当前 head 上 APPROVED。`pomelo-nwu` 在 `952e3ef668` 上的 `CHANGES_REQUESTED` 仍在，所以 `reviewDecision` 是 `CHANGES_REQUESTED`。 |

**未覆盖：**

- Windows 与 macOS（本轮只在 Linux x86_64 上跑）。
- App-only 的 RPC/UI。
- 外部模型提供方（模型是本地回环 fixture）。
- `tool_search` 桥接。
- 除 N2、N8 以外场景的交互 TUI。

### 建议

1. 合入候选 E，或任何对两族都生效、且只作用于限制型规则的等价修复。之后我这边没有阻塞项。
2. R23-1（文档与代码不一致）和 R26-1（P3/P4）不阻塞合入：可以收窄文档那句话，也可以都放到 #13412 跟踪。
3. 仍需 pomelo-nwu 重新评审，才能清除那条 standing CR。

证据在 [wenshao/qwen-code `asserts`/pr-12531-r4](.)：装置、每次运行的原始数据（headless、ACP、cand E）、差分 JSON、单测日志和候选 E 补丁。
