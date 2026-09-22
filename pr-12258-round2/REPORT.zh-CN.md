# PR #12258 —— 维护者验证第 2 轮（head `8a2b0a6d3b`）

**结论：合并前还需修一处。** 自第 1 轮以来新增的 MCP Apps 能力在真实浏览器 + 真实守护进程下表现良好——App→服务器工具调用、每次渲染的独立来源、同页 App 与守护进程 API 的隔离、资源上限与降级路径都按设计工作。有一处边界弱于设计文档的承诺：**B1 —— 在 WebKit(Safari) 中，已渲染的 App 能够导航顶层 Qwen 标签页并打开弹窗。** 该问题与引擎相关（Chromium 会拦截），且由本 PR 引入。我建议合并卡在 B1 上，其余均通过。

第 1 轮（[评论](https://github.com/QwenLM/qwen-code/pull/12258#issuecomment-5743184356)，head `e59d0f0`）只验证了核心资源上限层。本轮覆盖此后新增的部分——App→服务器工具桥、带一次性来源的专用沙箱监听器、回放/降级代码——以及第 1 轮未覆盖的 WebShell 渲染、冷重启回放和 `settings.json` 路径。以下仅列**增量**结论。

## 测试方式

| 部件 | 运行内容 |
| --- | --- |
| 两臂 | head `8a2b0a6d3b` vs merge-base `e1213d57d9`；各自 `pnpm install --frozen-lockfile`、完整 `npm run build` + `npm run bundle`，并以各自 `QWEN_HOME` 运行 `dist/cli.js serve` |
| 浏览器 | 真实 **Chromium 149** 与 **WebKit 26.5**（Playwright），加载守护进程提供的构建版 WebShell |
| MCP 服务 | 基于 `@modelcontextprotocol/sdk` 1.30.0 的真实 stdio 服务；其 App HTML 运行官方 `@modelcontextprotocol/ext-apps` 1.7.5 App SDK（`app.callServerTool`）。工具含：App 渲染工具、App-only 的 `get_embed_token`/`failing_app_tool`/`slow_app_tool`、model-only 工具、`visibility:null` 工具 |
| 第三方来源 | 一个独立本地服务，模仿 Tableau 的 `startSession` 并拒绝 `Origin: null`——即本 PR 针对的嵌套第三方 frame 场景 |
| 模型 | 仅工具选择用脚本假模型（记录每个请求体）；浏览器全流程 E2E 在 head 上跑 3 次结果一致，另加 1 次带记录 hook 的运行 |
| 平台 | Linux x86_64、Node 24 |

真实浏览器 → 真实构建版 WebShell → 真实守护进程 → 真实 ACP 子进程 → 真实 stdio MCP 服务。被测代码无 mock 守护进程、无 `page.route`。

## 发现 B1（阻塞）—— WebKit：App 可驱动顶层导航与弹窗

设计文档承诺 App 与 Qwen 页面隔离：*"Both iframe layers … retaining sandbox restrictions on top navigation, popups and other ungranted capabilities"*（`docs/design/mcp-app-server-tools.md:27`）。在 WebKit 中此承诺不成立。

因为 head 给**两层** iframe 都加了 `allow-same-origin`（`packages/cli/src/serve/mcp-app-sandbox.ts:81`、`packages/web-shell/client/components/messages/McpApp.tsx:279`），且 App 文档与其 proxy 共享同一个每次渲染的来源，所以 App 文档内的脚本与"给它上沙箱的那个 frame 元素"同源。这使 App 自己的脚本能够解除它所依赖的沙箱限制；一旦该 frame 不再受沙箱约束，WebKit 就允许它伸出卡片之外。App 脚本运行 4 秒后的实测结果：

| 臂 · 引擎 | App 脚本触及 proxy DOM | 顶层 Qwen 标签页被导航离开 | 打开弹窗 |
| --- | :--: | :--: | :--: |
| **HEAD · WebKit 26.5** | 是 | **是 → 攻击者页面** | **是** |
| HEAD · Chromium 149 | 是 | 否（被拦截） | 否 |
| BASE · WebKit 26.5 | 否（`SecurityError`） | 否 | 否 |
| BASE · Chromium 149 | 否（`SecurityError`） | 否 | 否 |

同轮的对照证实判别性：不改动自身 frame 的 App，在**两种**引擎下都无法导航顶层或打开弹窗（`data/sandbox-boundary-matrix.json` 中 "App frame, sandbox unchanged" 与 "proxy frame" 两行）。base 上 App 来源为不透明 `null`，脚本根本触及不到 proxy DOM——这是本 PR 的同源共享**新引入**的能力。Chromium 对"无用户激活的跨源顶层导航"策略更严，拦下了最终效果，因此当前用户可见影响仅限 WebKit/Safari；但"沙箱属性可被 App 移除"这一点与引擎无关，故仅靠该属性并非可靠的隔离控制。

影响：恶意或被攻陷的 MCP App bundle，可对 Safari 用户替换整个 Qwen 标签页（钓鱼/顺路攻击）或弹窗——正是该特性所宣称的"App 与 Qwen UI 隔离"属性。同页 App 之间与守护进程 API 的隔离**不**受影响（见下方通过项），本条仅针对顶层导航/弹窗这一支。图 6 并排展示 head/base × 两引擎的三种状态。本材料不含复现步骤或探针代码；结果矩阵与截图足以确认该类问题。

**修复方向（由维护者定夺）：** "禁止顶层导航/弹窗"这一属性必须放在 App 无法改写的层。按稳健度大致排序：(a) 由监听器在 App 文档上以 HTTP 响应头 `Content-Security-Policy: sandbox …` 下发沙箱策略——头部下发的 CSP sandbox 无法通过改元素属性撤销；(b) 让 App 文档拥有独立于 proxy 的来源，使 App 脚本触及不到 proxy DOM（保留嵌套第三方来源的收益，但需另行处理桥当前依赖的 proxy↔App 同源通道）；(c) 至少改写 `mcp-app-server-tools.md:27` 与中文文档，不再断言 WebKit 无法兑现的顶层导航保证。(a) 或 (b) 才是真正修复，(c) 仅让文档如实。

## 其余项均已验证 —— 通过

**B-pass —— App→服务器工具桥的门禁正确。** 真实 App 通过 `app.callServerTool` 调用 App-only 工具（`get_embed_token`）时，会经会话自身权限流程弹出 WebShell 审批框；"仅本次允许"后，原始 `content` + `structuredContent`（嵌入令牌/JWT）**只**交付给 App。跨全部 7 个运行目录（7 个守护进程、81 次模型请求、所有 transcript/遥测/debug 日志），令牌值在 fixture 自身 `settings.json` 之外出现 **0** 次——从不进入模型请求或会话记录；模型侧只收到固定摘要 `"MCP App tool completed."`。图 1–2。

**拒绝矩阵（REST，`data/rest-matrix-head.json`）。** 对活动路由：无 client id → 403；未知/他会话 client id → 400 `invalid_client_id`；未知会话 → 404；`resourceUri` 非 `ui://`、或 `arguments` 为数组 → 400；model-only 工具、外部服务器、未公开资源、带前缀（`mcp__…`）名、`visibility:null` 工具 → 全部被拒，服务器零执行。并发的模型审批与 App 审批互不影响：中止 App 调用后，模型审批仍可作答且模型回合正常完成；不留悬空的 App 审批。

**策略层对 App 调用同样生效（`data/policy-deny-head.json`）。** `PreToolUse` deny-hook 拦截 App 工具（返回 hook 理由，服务器执行 0 次）；`permissions.deny` 规则返回 `"… is disabled."` 且无弹框、0 执行；`tools.exclude` 同样返回 `is disabled`；同服务器上无限制的对照调用则弹框，批准后恰好执行 1 次。`PostToolUse`/`PostToolUseFailure` 的 hook 载荷只带固定摘要，从不带原始 App 结果（`data/hook-payloads.jsonl`）。

**取消。** 批准 `slow_app_tool`（30 秒）后重载页面会中止在途调用；stdio 服务在重载后约 15 ms 记录 `aborted`，遥测记为 `cancelled`。后台 App 调用后输入框不会卡在 *Processing*。

**每次渲染独立来源 + 同页隔离（Chromium + WebKit）。** 每个渲染的 App 在专用监听器上取得全新的 `uuid.localhost:<port>` 来源。从 App 来源发起的 `GET /capabilities`、`POST /session`、到守护进程的 `/terminal` WebSocket 全部被拒（守护进程记录 403 / `origin-not-allowed`）；已消费的沙箱 URL 二次请求返回 404；`top.document`/`top.location` 读取为 `SecurityError`。一页三个 App 时，两引擎下每对跨 App DOM 访问均为 `SecurityError`（`data/siblings-*.json`）。监听器只应答已注册的确切 Host + `GET /mcp-app-sandbox`；`POST`、其它路径、`/session`、`/capabilities` 及错误 Host 一律 404，且铸造出的 URL 仅一次有效（第 2 次 GET → 404）。`hostOrigin` 必须是 loopback（`a.localhost`、`evil.com` → 400）。

**前提可复现。** 同一 fixture App、同一嵌套第三方 frame：**base** 上该 frame 以 `Origin: null` 运行、第三方 `startSession` 失败；**head** 上该 frame 保留 `http://127.0.0.1:<vendor>`、调用返回 200。图 1。

**资源上限端到端 + 冷重启（图 4）。** 1.66 MB 的 App 在默认上限下被丢弃，并显示指名 `mcpServers.big.appResourceMaxBytes` 的可操作警告，且保留成功的工具文字；同一 App 在 `appResourceMaxBytes: 2 MiB` 下正常渲染。停掉守护进程再重启后，transcript 原样回放"超限警告"与"配置后渲染"，各自处于新的独立来源下。配置经 SDK/CLI/守护进程读写往返后保持不变。

**沙箱加载失败（图 7，非阻塞，对应未决线程 R3-7）。** 当沙箱文档返回 404、或 `*.localhost` 无法解析时，卡片渲染为空框——文档承诺的文本回退不出现，因为 HTTP 错误的 iframe 响应体不触发 `error` 事件。这正是仍未决的 R3-7 建议；确认可复现。

**门禁。** 25 个改动测试文件在 head 全绿（**5,276 / 0**）、base 全绿（**5,195 / 0**）。对新逻辑的 17 个变异（`data/mutation/`）中，**12** 个被 PR 自带的定向测试杀死；**5** 个存活项（M3、M10、M11、M12、M14）放到各包整套测试重跑仍全绿，说明确属未被钉住（而非仅窄范围）。其中 4 个正对应未决的 R3-13 覆盖缺口线程：App-call-id↔权限绑定（`bridgeClient.ts:999`，M11）、断连取消（`session-control-plane.ts:3911`，M12）、ACP 子进程信任门（`acpAgent.ts:11148`，M14）、读取时的 `isToolDisabled` 复检（`tool-registry.ts:1194`，M3）。第 5 个 M10 删除注册过期检查后无沙箱测试变红——它在 `src/serve` 广测上的"杀死"仅来自 3 个以 root 运行的既有失败，在未变异对照上完全一致（`data/mutation/M10-broad-unmutated-control.json`），故过期分支同样未被钉住。这 5 项都不是线上缺陷（上文运行中的守护进程里，禁用/deny/过期行为均正常），而是缺回归覆盖——正是 R3-13 的要点。

## 未覆盖
- 真实 Tableau / Amplitude 服务（以作者自己的截图为准，本轮不在范围）。
- Windows。
- 除上文触及的两条外（R3-7 已复现、R3-13 存活项已测量），其余未决 Suggestion 线程维持原有处置。

---

图：`01` 来源 + App 工具 A/B · `02` App 发起调用→审批→私有结果 · `03` 两个 App、不同来源 · `04` 冷重启后的资源上限 · `05` WebKit 下 App 处于独立来源 · `06` 沙箱边界状态，head/base × WebKit/Chromium（B1）· `07` 沙箱加载失败时的空卡片（R3-7）。harness 与原始记录见 `harness/`、`data/`。

*维护者本地验证。Claude Code — Claude Opus 4.8。*
