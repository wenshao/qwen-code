## 维护者验证：真实 daemon + 真实浏览器，head `1994f1c4ab`

**结论：可以合入。** 没有发现阻塞问题。拆分在真实 daemon、真实磁盘扩展上端到端可用；legacy 路由行为不变；daemon 与客户端的各种新旧版本组合都能正确回退。装有 103 个扩展时，浏览器中打开列表快约 6 倍，接口层快约 110 倍。另有两条非阻塞的后续建议（见下），较大的一条是 UX 变化：列表重载会把已打开的详情页 tab 重置。

### 环境

- **两个臂均从源码构建**，Linux x86_64，Node 22.22.2：PR head `1994f1c4ab`，以及 base `6a2b3a38ac`。base 就是合入该分支的那个 `main` 提交，所以两臂之间的差异恰好是 PR 的 21 个文件。每个臂都执行了 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`，全部 exit 0。head 与今天的 `main`（`5130c1a734`）也能无冲突合并。
- **真实 `qwen serve` daemon**，使用隔离的 `QWEN_HOME`，**磁盘上有 103 个真实扩展**：
  - 100 个批量扩展，形状与作者的基准一致（每个含 40 个 skill、10 个命令、5 个 agent 和一个 `QWEN.md`）
  - 一个"丰富"的 Qwen 扩展：2 个 MCP server、settings、hooks、嵌套的 `ops:*` 命令、一个 context 文件，以及 git 安装元数据（source URL 中带凭据、query 和 fragment）
  - 一个 Agent Plugins v1 包（`plugin.json` + `mcp.json`，含 stdio 与 streamable-http 两种 server，另有 skills）
  - 一个用于切换激活状态的小扩展
- **真实 Chromium**（headless shell 1228）驱动各 daemon 自己提供的 Web Shell。没有任何 mock。`page.route` 只在下文注明的两处使用，且仅用于延迟或挂起真实的 daemon 响应。

### 结果

| 检查项 | 结果 |
| --- | --- |
| HTTP 对等性，head（103 个扩展） | **10/10**。summary 外层结构与完整状态一致。103 条 summary 与完整条目去掉 `capabilities`/`details` 后逐字段相等，顺序相同。103 个 `/:name/details` 响应都与对应的完整条目逐字段相等，包括 Agent Plugins 的 MCP server。不存在的扩展返回 `404 extension_not_found`。`RICH-QWEN` 解析到同一条目。source 已脱敏（`https://***REDACTED***@github.com/acme/rich-qwen.git`）。新读取之后，legacy 状态不变。 |
| legacy `GET /workspace/extensions`，base vs head | **完全一致**：103 条，比较前已归一化 home 路径。base 臂上两个新路由均为 404。 |
| 边界集合，真实 daemon | 仅大小写不同的同名（`CaseExt`/`caseext`）：完整状态、summary、details 以同样方式失败（`500 extension_conflict`）。两个目录声明完全相同的名字：三条路由都选同一个（最后一个）目录。损坏的 manifest：各处都排除。名为 `summary`、`operations`、`v1.2` 的扩展都能经 `/:name/details` 正确返回，`/operations` 也照常可用。 |
| 浏览器线路，head 客户端 + head daemon | 打开页面只发 `GET …/summary`（另有 `operations`）。选中扩展时只发一次 `GET …/<name>/details`。**所有流程中都没有出现完整状态请求。** |
| 版本矩阵（图 1） | daemon × 客户端的四种组合渲染出相同的 tab 计数与 MCP 行。只有 head + head 走拆分；base 客户端连 head daemon、head 客户端连 base daemon，都走完整路由。 |
| 加载中 / 真实 404 + 重试 / 迟到响应（图 2） | 加载时显示 spinner。为制造真实的 404，我在列表加载后把扩展目录移走；页面显示错误，恢复目录后点"Try again"返回 200（Skills 6）。先挂起 Bulk 0 的响应，切到 Rich Qwen 后再放行，迟到的响应**被忽略**。 |
| 嵌入在 Plugins 面板中 | 同样的"先 summary、后 details"流程可用，Agent Plugins 的 MCP 行正常显示。 |
| 单元测试（head） | core `extensionManager` 185/185 · SDK `DaemonClient` 493/493 · web-shell 页面 + 逻辑 21/21 · CLI 路由 + controller + 文档契约 98/98（其中 **`workspace-qualified-extensions` 57/57**，PR 中在 macOS 上报告的两个超时这里不复现）· `server.test.ts` 中的 capability 测试 87/87 · 集成测试 `qwen-serve-routes` 42/42（基于构建产物）· 对 19 个改动的 TS 文件跑 ESLint `--max-warnings 0`：无问题。 |
| 变异检查（针对 PR 守卫的 15 个单点变异） | **杀死 12 个。** 3 个存活者见后续建议第 3 条。 |

**接口耗时。** 在 loopback 上对 head daemon（103 个扩展）发真实 HTTP 请求。每种操作交替采样 9 次；legacy 读取之间间隔超过 2 s，确保 2 s 缓存始终不命中。

| 操作 | 中位数 | 范围 | 字节数 |
| --- | ---: | ---: | ---: |
| legacy 完整状态（缓存未命中），head | 937.9 ms | 922–944 | 123,315 |
| legacy 完整状态（缓存未命中），base | 945.8 ms | 910–952 | 123,315 |
| summary | **8.5 ms** | 7.0–9.5 | 30,644（−75 %） |
| 单个详情 | 16.3 ms | 15.8–19.4 | 1,208 |
| summary + 详情 | **24.2 ms** | 23.0–25.6 | 31,852 |

**浏览器耗时**（真实 Chromium：从执行 `/extensions` 到卡片可见，再从点击卡片到 tab 可见）。取第 2–5 次的中位数：

| | 打开列表 | 打开一个扩展 |
| --- | ---: | ---: |
| base | 1,498 ms（首次 2,504） | 33 ms（无请求） |
| PR | **255 ms**（首次 1,490） | 71 ms（一次 details 请求） |

### 后续建议（非阻塞）

**1. 列表重载会重置已打开的详情 tab，并显示 spinner（图 3）。** 这在真实浏览器中证实了 triage 评审的第一条观察，并给出了数据。
- **步骤：** 打开 Rich Qwen，选中 **Skills**，再把全局设置改为 Disabled。
- **base：** 仍停在 Skills，没有 spinner（3/3 次切换）。
- **PR：** tab 被卸载，显示"Loading..."，恢复后回到 **Overview**（3/3 次）。实际绘制出的 spinner 持续 932–950 ms。
- **spinner 为何这么久：** 激活流程会发起运行时刷新（`POST …/extensions/refresh`），3–4 ms 后页面发出 details 请求。daemon 日志记录该请求耗时 928–948 ms，空闲时约 16 ms。
- **原因：** details 的 effect 依赖 `selectedExtension` 对象，每次 `load(true)` 都会生成新对象，于是清空 `detailResult` 并重新挂载非受控的 `<Tabs defaultValue="overview">`。
- **建议修法：** 以扩展名加一个重载计数器作为请求键；重新校验期间保留同名扩展的上一份条目，只在该名字还没有任何条目时显示 spinner。把 `Tabs` 改为受控，也能保住当前 tab。
- 正面的一点：PR 下激活流程更快结束，刷新 POST 约在 1.07 s 发出；base 要先等完整扫描，约在 1.9–2.0 s 才发出。

**2. 插件数据目录无法创建时，详情中可能出现 Agent Plugins 的 stdio MCP server。**
- details 路径上，选中扩展本身的 `createDataDir` 也是 false，于是跳过了 `loadAgentPluginMcpServers` 中"mkdir 失败 → 移除 stdio server"的分支。
- **复现：** 把 `$QWEN_HOME/extension-store/plugin-data/agent-plugins/<id>` 设为普通文件。
- **结果：** 完整状态报告 `["plugin-http"]`（1 个），base 也一样；而 `/agent-plugin/details` 报告 `["plugin-stdio","plugin-http"]`（2 个）。
- 只有数据目录不可写（只读 home、磁盘满）时才会触发，但这确实打破了"详情与完整条目逐字段一致"的说法。用只读检查即可补上，例如：当数据目录已存在却不是目录，或其最近的已存在祖先不可写时，移除 stdio server。

**3. 变异检查发现的测试缺口。** 3 个存活者中有 2 个会改变行为，值得补测试：
- 把 `refreshExtensionDetailsSnapshot` 中的 `findLast` 改为 `find`、去掉 summary 的按名去重，这两个变异都存活。两者在"两个目录声明完全相同的名字"时都会产生分歧。在构建好的 core 上直接取证：完整状态保留 `dup-b`，`find` 会返回 `dup-a`（skills 不同），catalog 会返回两个目录，因此 summary 会把 `dup` 列两次。
- 去掉 `detailResult.summary === selectedExtension` 这个同一性检查也存活。从绘制层面看它似乎是冗余的：对照客户端与变异客户端（均用 `vite build` 构建、由真实 daemon 提供）各跑 5 次，没有任何一帧在新标题下绘出上一个扩展的 tab。React 会在绘制前同步执行点击触发的 effect。

**两点说明**
- triage 评审的第二条观察（"summary 去重，完整状态不去重"）不成立。`refreshCache` 同样构建以名字为键的 `Map`，真实重名探测显示三条路由结果一致。
- 外观小问题：错误提示直接显示原始路由模板（`GET /workspace/extensions/:name/details: Extension not found`），"Try again"按钮也紧贴着文字。

harness 脚本在 `harness/`，原始结果在 `data/`。

![版本矩阵](fig1-version-matrix.png)
![加载、错误重试、迟到响应](fig2-loading-error-race.png)
![列表重载后 tab 被重置](fig3-tab-reset.png)
