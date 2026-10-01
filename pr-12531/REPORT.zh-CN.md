## 维护者验证（本地真实环境）— PR #12531 @ `985683eb4d`

**结论：不能原样合入。** 我发现一个新的 fail-open 回归，由今天的 `1e29efde68` 引入，下面附上已验证的修复（+78/−18）。

#10199 的修复本身端到端成立：真实 MCP server、真实 TUI、headless 和 ACP 都验证过。问题出在 `1e29efde68` 把 `mcpIdentity` 穿进调度器各道闸门之后。此后 `matchesMcpPattern` 的 identity 分支在比较通配规则和整 server 规则时，**只**比较原始拼法 `mcp__<serverName>__<serverToolName>`。匹配器原本认可的其他拼法，在真实执行路径上全部失效：

- 模型和 UI 显示的已注册名，
- legacy 字符集，
- 连文档化的 `mcp__*` 也不例外。

所以 `permissions.deny: ["mcp__*"]` 已经拦不住一次普通的 `github` / `create_issue` 调用。

既有轮次：这个 PR 之前没有维护者验证。2026-09-30 的沙箱轮在单测层面验证了 `1fe811c3e5`，并把「无真实 MCP 传输」「无真实 ACP 会话」列为未覆盖。本轮补上这两块，同时覆盖此后的提交（`2da7c3f80f`、`1e29efde68` 和几次合并），不重复沙箱的普查。

### 环境

- **三个 arm：**
  - **base** `e083d6a6b8`（与 `main` 的 merge-base）
  - **head** `985683eb4d`
  - **head + 建议补丁**（第三个 worktree）

  每个 arm 都执行了 `pnpm install --frozen-lockfile` → `npm run build` → `npm run bundle`，全部 exit 0。我核对过每个 bundle 确实是对应的构建：`mcpIdentity` 在 head 的 3 个 chunk 里出现、base 里 0 个；`identitySpellings` 只出现在打了补丁的 bundle 里。
- **每个场景：** 全新的 `HOME`，写入 `settings.json`（`mcpServers` + `permissions`），使用**真实的 stdio MCP server**（`@modelcontextprotocol/sdk` 的 `Server`）。server 收到的每一次 `tools/call` 都会追加写入 `hits.jsonl`，这个文件就是「是否真的执行了」的判据。脚本化的 OpenAI 兼容假模型按已注册名调用目标工具。
- **三种驱动方式：** **真实交互式 TUI**（node-pty + xterm.js）、**headless `qwen -p`**（调度器路径）、通过 JSON-RPC 驱动的 **`qwen --acp`**（`Session.ts` 路径）。Linux，Node v22.22.2。

### 1. #10199 修复端到端成立

![Fig 1](./01-tui-s1-cross-server-allow.png)

配置：`permissions.allow: ["mcp__foo.bar"]`，两个真实 server `foo.bar` 和 `foo_bar`。

- **base：** 模型调用 **`foo_bar`** 的 `evil` 时不弹任何确认就执行了，`foo_bar` server 记录到了这次调用。
- **head：** TUI 弹出 *Allow execution of MCP tool "evil" from server "foo_bar"?*，server 没有收到任何调用。

同样的翻转也出现在：

- `mcp__foo.bar__*`（S1w）；
- R13-1 的 `allow mcp__foo` → server `foo_` 的 `mcp__foo___x`（S4），由 `1e29efde68` 关闭。

本 server 对照组（S1c、S4c）仍然自动放行。ACP 上 S1、S4 同样翻转：base 直接执行，head 发出 `session/request_permission`。

### 2. `1e29efde68` 引入的新回归：限制类规则失效（fail-open）

![Fig 2](./02-tui-m1-deny-mcp-star-fail-open.png)

以下都是真实 CLI 在 YOLO 模式下的运行，deny 规则是唯一的拦截手段；以 server 端日志为判据。

| id  | `permissions.deny`                                       | 被调用的工具                                     | base       | head       |
| --- | -------------------------------------------------------- | ------------------------------------------------ | ---------- | ---------- |
| M1  | `mcp__*`                                                 | `github` / `create_issue`                        | 被 deny 拦截 | **执行了** |
| D1  | `mcp__zybio_db`                                          | `zybio.db` / `search_pubmed`                     | 拦截       | **执行了** |
| D2  | `mcp__zybio_db__*`                                       | `zybio.db` / `search_pubmed`                     | 拦截       | **执行了** |
| D8  | `mcp__foo_bar`                                           | `foo:bar` / `a.b`                                | 拦截       | **执行了** |
| D3  | `mcp__github__search_*`                                  | `github` / `search.repos`                        | 拦截       | **执行了** |
| D6  | `mcp__foo.bar__get_data_for_a_specific*`（R14-2 自己的形态） | `foo.bar` / `get+data_for_a_specific_location_…` | 拦截       | **执行了** |

allow 方向：M2 `allow: ["mcp__*"]`（default 模式）在 base 上自动放行；在 head 上每次都要确认，headless 下直接被拒。

以下对照组在两边行为一致：

- 原始拼法 `mcp__zybio.db`（D4），
- 精确已注册名（D5），
- `mcp__github__*`（M3），
- 无规则（M4、M5）。

完整的 18 场景 × 3 arm 表格，以及 ACP 运行结果：

![Fig 3](./03-real-cli-matrix.png)

**机理。** 只要 `mcpIdentity !== undefined`，identity 分支就会接管：`rule-parser.ts:1782-1801`（通配）和 `:1819-1823`（整 server）。它们只与 `mcp__${serverName}__` 和 `serverToolName` 比较，带来两个后果：

- `mcp__*` 既不等于 `mcp__github__`，也不以它为前缀，所以对所有 MCP 工具都返回 `false`。
- server 名或工具名的 provider-safe 拼法、legacy 拼法都不是原始拼法，同样返回 `false`。

下面的拼写路径（`matchesPrefixLiterally`）本来能处理这些拼法，但 identity 分支在到达它之前就返回了。

生产代码在调度器路径上会传入 identity：

- `permissionFlow.ts:82`（`invocation.mcpIdentity`）；
- `coreToolScheduler.ts:3130-3141`（`isToolEnabled` 和 `findMatchingDenyRule`）。

我还用真实的 `DiscoveredMCPTool` producer 和 `PermissionManager.evaluate` 做了 matcher 层探针（[`data/probe-matcher.txt`](./data/probe-matcher.txt)）。上面每条规则在 base 上、**以及 head 不带 identity 时**，都求值为 `deny`/`allow`；head 带上 identity 后则为 `default`。所以病因正是 identity 分支。

同一个谓词也供给 agent 的黑名单（`agent-core.ts` 的声明与调用检查、`matchesAgentToolBlocklist`、`agent.ts:1800` 的 fork 继承过滤）。例如 `matchesToolPattern('mcp__*', 'mcp__github__create_issue', aliases, identity)` 在 base 上为 `true`，在 head 上为 `false`（[`data/probe-blocklist.txt`](./data/probe-blocklist.txt)）。所以 subagent 的 `disallowedTools: ["mcp__*"]` 也不再排除 MCP 工具。这一点只在 matcher 层核验过，没有用真实的 subagent 调度驱动。

**为什么我认为这是无意的，而不是设计取舍：**

- 本分支的设计文档写明：
  - *"`mcp__*` and `mcp__server__*` keep their documented meanings"*（`docs/design/mcp-tool-name-provider-compatibility.md:36`）；
  - 规则*"against the registered name and the raw identity, plus the gated legacy reduction"*进行比较（`:32`）；
  - 把限制类规则*"in the registered spelling"*书写，是推荐的缓解办法（`:37`）。
- PR 描述保留 provider-safe 残留，理由正是关闭它*"would break deny rules copied from the registered names the model and UI actually show"*。
- 提交信息写的是 *"without it the existing spelling logic is unchanged"*。这句话本身没错，但生产代码现在已经不会走「不带 identity」的路径了。
- 新增的 7 条 identity 测试和现有各行，都没有在**带 identity** 的情况下求值 provider-safe 拼法、legacy 拼法或 `mcp__*`。这就是所有套件依然全绿的原因。

**ACP 说明。** `Session.ts:13860` 的 L1 闸门 `pm.isToolEnabled(...)` 传了 aliases，但**没有**传 `mcpIdentity`。由此有两个效果：

- ACP 上的 deny 场景（M1、D1）仍然在这道闸门被拦下（`Tool "…" is disabled.`）。
- `Session.ts` 构造的 L3/L4 上下文带了 identity，所以 `allow mcp__*`（M2）在 ACP 上同样退化。

同一个缺失的参数还意味着，R13-1 的 `deny mcp__foo` 在 ACP L1 仍会误拦 `foo_` 的工具。这属于 fail-closed，优先级低，但说明 identity 的穿线并不像提交信息说的那样统一。

### 3. 建议修复（已验证）

保留 producer 提供的边界，同时枚举该工具本来就认可的几种拼法：

- 原始拼法；
- 已注册名（前提是它的 server 前缀在 63 字符预算内没有被截断）；
- legacy 字符集（仅当 producer 发布了该归约时纳入，即同一道 R12-1 闸门）。

每种拼法都按 identity 给出的边界切分。在通配分支里，止于 server 名内部的前缀（`mcp__*`、`mcp__git*`）视为 server 名通配；到达分隔符的前缀必须完整命名 server。这样 identity 分支不会认可任何拼写路径不认可的拼法，唯一的变化是边界取自 producer。

<details>
<summary>补丁：<code>rule-parser.ts</code>（+78/−18）— 测试：<code>mcp-server-rule-collision.test.ts</code> 新增 13 行</summary>

```diff
diff --git a/packages/core/src/permissions/rule-parser.ts b/packages/core/src/permissions/rule-parser.ts
index c97853b8c5..14e267d49d 100644
--- a/packages/core/src/permissions/rule-parser.ts
+++ b/packages/core/src/permissions/rule-parser.ts
@@ -1783,21 +1783,29 @@ export function matchesMcpPattern(
       // The boundary comes from the producer, not from a flattened spelling:
       // `mcp__foo_` + `__*` (server `foo_`) and `mcp__foo` + `__*` (server
       // `foo`) are the same string family under startsWith, and a tool whose
-      // name starts with '_' reads as separator continuation there.
-      const serverPrefix = `mcp__${mcpIdentity.serverName}__`;
-      if (prefix === serverPrefix) {
-        return true;
-      }
-      if (!prefix.startsWith(serverPrefix)) {
-        return false;
-      }
-      const toolPrefix = prefix.slice(serverPrefix.length);
-      // A prefix of pure underscores is separator continuation, not a tool
-      // filter — otherwise a sibling server's whole-server spelling leaks in.
-      if (!/[^_]/.test(toolPrefix)) {
-        return false;
-      }
-      return mcpIdentity.serverToolName.startsWith(toolPrefix);
+      // name starts with '_' reads as separator continuation there. Every
+      // spelling the tool answers to is still consulted — raw, registered
+      // and legacy — each split at the producer's boundary.
+      return identitySpellings(
+        mcpIdentity,
+        toolName,
+        legacySpelling !== undefined,
+      ).some(({ serverPrefix, tool }) => {
+        if (prefix === serverPrefix) {
+          return true;
+        }
+        if (!prefix.startsWith(serverPrefix)) {
+          // A prefix that ends inside the server name (`mcp__*`,
+          // `mcp__git*`) is a server-name wildcard; one that reaches the
+          // separator must name the whole server.
+          return serverPrefix.slice(0, -2).startsWith(prefix);
+        }
+        const toolPrefix = prefix.slice(serverPrefix.length);
+        // A prefix of pure underscores is separator continuation, not a
+        // tool filter — otherwise a sibling server's whole-server spelling
+        // leaks in.
+        return /[^_]/.test(toolPrefix) && tool.startsWith(toolPrefix);
+      });
     }
     return matchesPrefixLiterally(prefix);
   }
@@ -1817,9 +1825,15 @@ export function matchesMcpPattern(
   const patternParts = pattern.split('__');
   if (patternParts.length === 2 && patternParts[0] === 'mcp') {
     if (mcpIdentity !== undefined) {
-      // Exact producer compare: no split of the tool side, so a rule for
-      // server `foo` can never reach server `foo_`'s tools and vice versa.
-      return patternParts[1] === mcpIdentity.serverName;
+      // Producer compare: no split of the tool side, so a rule for server
+      // `foo` can never reach server `foo_`'s tools and vice versa — but the
+      // server is still named by any of its spellings.
+      const serverPrefix = `mcp__${patternParts[1]}__`;
+      return identitySpellings(
+        mcpIdentity,
+        toolName,
+        legacySpelling !== undefined,
+      ).some((spelling) => spelling.serverPrefix === serverPrefix);
     }
     // A server name containing '__' makes this split unreliable, but that is
     // the accepted provider-safe-name residual (see mcp-tool.ts). The tool
@@ -1839,6 +1853,52 @@ export function matchesMcpPattern(
   return false;
 }
 
+/**
+ * The spellings an MCP tool answers to when the producer supplied its
+ * identity, each split at the producer's server boundary instead of by
+ * re-splitting a flattened name: the raw `mcp__<server>__<tool>` spelling,
+ * the registered provider-safe rendering (what the model and the UI show),
+ * and the legacy character set pre-normalization entries were persisted in.
+ * Splitting at the producer's boundary is the only change from the spelling
+ * path: the identity arm consults no spelling the spelling path would not.
+ */
+function identitySpellings(
+  identity: McpToolIdentity,
+  toolName: string,
+  includeLegacy: boolean,
+): Array<{ serverPrefix: string; tool: string }> {
+  const spellings: Array<{ serverPrefix: string; tool: string }> = [];
+  const add = (serverPrefix: string, tool: string): void => {
+    if (
+      !spellings.some(
+        (spelling) =>
+          spelling.serverPrefix === serverPrefix && spelling.tool === tool,
+      )
+    ) {
+      spellings.push({ serverPrefix, tool });
+    }
+  };
+  add(`mcp__${identity.serverName}__`, identity.serverToolName);
+  // The registered name substitutes characters one for one, so its server
+  // prefix is known; it is only usable while the 63-character budget left
+  // that prefix intact.
+  const registeredServerPrefix = `mcp__${identity.serverName.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
+  if (toolName.startsWith(registeredServerPrefix)) {
+    add(registeredServerPrefix, toolName.slice(registeredServerPrefix.length));
+  }
+  // The legacy character set, only while the producer still advertises the
+  // reduction — the same provenance gate the spelling path applies (R12-1).
+  if (includeLegacy) {
+    const legacy = (segment: string): string =>
+      segment.replace(/[^A-Za-z0-9_.-]/g, '_');
+    add(
+      `mcp__${legacy(identity.serverName)}__`,
+      legacy(identity.serverToolName),
+    );
+  }
+  return spellings;
+}
+
 /**
  * Pick the advertised alias that serves as the tool's raw identity for
  * matching, or `undefined` when no alias can vouch for it.
```

测试行见 [`patch/suggested-tests.patch`](./patch/suggested-tests.patch)（两份合在一起见 [`patch/suggested-fix.patch`](./patch/suggested-fix.patch)）。

</details>

打补丁后的结果（第三个 arm，同一套测试台）：

- **真实 CLI。** 7 个回归格全部恢复为 base 的行为（Fig 3 最右列）。**S1、S1w、S4 仍保持关闭**，所有对照组不变。TUI 中 M1 重新被拦截（Fig 2 右栏）。
- **先红后绿。** 在未修补的 head 上，13 条新增行为 **8 失败 / 5 通过**；通过的 5 条是跨 server 负向用例，head 本来就判对了。打补丁后碰撞测试文件 **71/71** 通过。
- **对补丁做变异**（三个 permission 套件）：

  | 变异 | 结果 |
  | --- | --- |
  | 去掉 server 名通配分支 | 3 行变红 |
  | 去掉已注册名拼法 | 3 行变红 |
  | 永不加入 legacy 拼法 | 1 行变红（R14-2 那一行） |
  | 去掉 legacy 的来源闸门 | 存活 |

  存活在预期之内：有了 identity，边界已经确定，这道闸门只起「不宽于拼写路径」的保守约束作用。建议保留，但它不承重。
- **门禁。** `packages/core` 定向集合（permissions、tool-registry、mcp-tool、agents/runtime、coreToolScheduler、memory 包装、tools/workflow、tools/agent）：head 3939/3939，补丁 3952/3952（+13 新增）。cli `Session.test.ts`：两边都是 1111/1111。补丁文件的 `tsc --noEmit`、eslint、prettier 均通过。

### 4. 延续项（非新发现）

- **F6 在本 head 上端到端复现。** D7 是一个 29 字符 key（`com.example.enterprise-search`，工具 `a×32`）的截断 legacy 精确拼法 `deny`。它在 base 上拦截，在 head 上执行。补丁不涉及这里（问题在精确分支 / 发布闸门）。它仍是沙箱轮留下的待定产品决策，现在多了一个真实 CLI 的见证。
- Reviewer Test Plan 第 4 步的计数已过时：在本 head 上是 **786 passed**（描述里写的是 676）。

### 5. head 上的门禁

| 门禁                                                      | 结果                                                                                                                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `985683eb4d` 的 CI                                        | 所有未跳过的检查全绿                                                                                                                                                                                                       |
| PR 测试计划第 4 步（4 个文件，在 `packages/core` 下运行）    | 786/786，exit 0                                                                                                                                                                                                            |
| `packages/core` 全量 vitest，base 与 head 对照（顺序执行，root 身份） | base：33794 个测试，5 失败。head：33858 个测试，6 失败。共有的 5 个是 root 环境类失败（不可读锁、瞬时 rename、git index 卡死）。head 独有的那个（`recall-scan-latency`）单独重跑 3/3 通过，且 PR 未改动 `src/memory/recall*`。 |
| 定向 core 集合 / cli `Session.test.ts`                    | 3939/3939 / 1111/1111                                                                                                                                                                                                      |
| 全部改动文件的 eslint `--max-warnings 0` + prettier        | 通过                                                                                                                                                                                                                       |

**未覆盖：**

- Windows 和 macOS（CI 在这两个平台为绿）。
- subagent `disallowedTools` 和 fork 继承路径：只在 matcher 层核验，没有用真实 subagent 调度驱动。
- `tool_search` 桥接：模型是按名字直接调用延迟加载的 MCP 工具，没有走这条桥。

证据：测试台、逐次运行的原始数据（settings、CLI stdout、模型日志、server hits）和补丁都在 [wenshao/qwen-code `asserts`/pr-12531](.)。
