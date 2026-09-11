## 维护者验证 — 真实双工作区 daemon + 真实 Web Shell（Linux）

在一台注册了两个工作区运行时的真实 `qwen serve` daemon 上验证，并用浏览器驱动真实的 Web Shell。PR 描述中 Linux 标记为 ⚠️（未本地运行），本次验证补上了这一块。

**结论：行为与描述一致，建议合并。** 末尾记录了一个不阻塞的观察项，以及一个在 base 上同样复现的既有问题（因此不是本 PR 引入的）。

<sub>Head `8c027e5d3a`（关键结论在更早的 `4e35093986` 上也复跑过一遍）· Base 取 merge-base `2f426a64f4` · Node 22.22.2 · 两个分支 `npm ci && npm run build` 均通过。</sub>

### 环境

两个工作区 `ws-a`（primary）与 `ws-b`（secondary），均受信任，`HOME`/`QWEN_HOME` 完全隔离，这些路由不需要模型凭据：

```
qwen serve --workspace <…>/ws-a --workspace <…>/ws-b --port … --token …
```

两个探针扩展以 user scope 全局安装，各带一个 skill 和一个斜杠命令：

| 扩展 | ws-a | ws-b |
| --- | --- | --- |
| `wsprobe` | 启用（继承全局） | **禁用**（工作区覆盖） |
| `wsprobe2` | 启用 | 启用 |

整个 A/B 就建立在这一处不对称上：当输入区/管理页指向 `ws-b` 时，任何"回答成 `ws-a`"的实现都会错误地列出 `wsprobe`。

---

### 1. 本 PR 修复的缺陷，已在 base 上复现

当**输入区工作区选为 `ws-b`** 时，base 通过绑定 primary 的 `GET /workspace/extensions` 解析扩展引用，因此 `@` 和 `+` 扩展菜单会列出在所选工作区已被禁用的 `wsprobe`。合入本 PR 后，同样的菜单改读 `GET /workspaces/<ws-b>/runtime/extensions`，列表即正确。

浏览器实际抓到的请求（两侧扩展存储状态完全一致）：

| 分支 | 输入区工作区 | 客户端实际发出的请求 | `@`/`+` 扩展列表 |
| --- | --- | --- | --- |
| base `2f426a64` | `ws-b` | `GET /workspace/extensions` | `wsprobe`、`wsprobe2` ❌ |
| PR `8c027e5d` | `ws-b` | `GET /workspaces/<ws-b>/runtime/extensions` | `wsprobe2` ✅ |
| PR `8c027e5d` | `ws-a` | `GET /workspaces/<ws-a>/runtime/extensions` | `wsprobe`、`wsprobe2` ✅ |

切回 `ws-a` 仍然两个都在，说明这不是一刀切地把列表抹掉。

### 2. 扩展管理跟随所选工作区

base 的 **Plugins ▸ Extensions** 没有工作区选择器、只读 primary，所以无论你关心哪个工作区，`wsprobe` 都显示 `enabled`。本 PR 加入选择器，并通过 `/extensions` + `/workspaces/<ws-b>/extensions` + `/workspaces/<ws-b>/runtime/extensions` 解析。详情页正确区分了两个作用域（Global setting = Enabled，Workspace setting = Disabled），并且 `Commands 1`、`Skills 1` 这些能力计数来自所选工作区的运行时。

### 3. 启用状态被协调进**存活的**次级运行时

这是核心论断，所以通过真实界面操作、再从 daemon 读回验证。在运行时已经存活的情况下，于管理页把 `ws-b` 的 **Workspace setting 切到 Enabled**：

```
切换前  ws-b  runtimeEpoch=1  capabilities.extensions={state:ready, desiredGeneration:8, appliedGeneration:8}
               /workspaces/<ws-b>/runtime/extensions  wsprobe.isActive = false
               /workspaces/<ws-b>/runtime/skills      wsprobe-skill    = disabled (inactive_extension)

切换后  ws-b  runtimeEpoch=1  capabilities.extensions={state:ready, desiredGeneration:9, appliedGeneration:9}
               /workspaces/<ws-b>/runtime/extensions  wsprobe.isActive = true
               /workspaces/<ws-b>/runtime/skills      wsprobe-skill    = ok
```

`runtimeEpoch` 全程保持为 `1` —— 运行时没有被替换，而是把目录协调进了同一个运行时。`ws-a` 全程保持启用。

在两个次级运行时都存活时**新装**一个扩展，表现一致：store generation 推进，两个运行时的 `appliedGeneration` 都在 `runtimeEpoch 1` 下跟上，同时 `ws-b` 保留自己的工作区覆盖：

```
ws-a  epoch 1  {state:ready, desiredGeneration:3, appliedGeneration:3}   wsprobe isActive=true   wsprobe2 isActive=true
ws-b  epoch 1  {state:ready, desiredGeneration:3, appliedGeneration:3}   wsprobe isActive=false  wsprobe2 isActive=true
```

`ws-b` 中的存活会话可以看到该扩展的斜杠命令及其 `[wsprobe]` 标记。

### 4. 文档契约抽查

| 契约（出自 `qwen-serve-protocol.md`） | 结果 |
| --- | --- |
| 工作区运行时可用时声明 `workspace_extensions_config_runtime` 与 `workspace_extension_mentions` | PR 两者均有，base 两者均无 |
| `GET /workspace{,s/:ws}/runtime/extensions` 受该 feature 门控 | base `404`，PR `200` |
| 运行时目录读取「不会启动或准备冷运行时」 | 对从未 ensure 过的 `ws-b`：`initialized:false`，**15 ms** 返回，之后 `runtime/status` 仍为 `cold` |
| 运行时目录读取要求目标受信任 | 未受信任的 `ws-b` → `403 untrusted_workspace` |
| projection 在不受信任时仍可读，并在 body 中报告 | 未受信任的 `ws-b` → `200`，`trusted:false` |
| 受信任目标不受影响 | `ws-a` → `200` |

### 5. 测试

在 `8c027e5d3a` 上，本 PR 涉及的测试套件全部本地通过：

| 包 | 文件 | 用例 |
| --- | --- | --- |
| `cli`（`workspace-runtime-coordinator`、`workspace-qualified-extensions`、`workspace-extensions-controller`、`acpAgent`、`server`、`run-qwen-serve`） | 6 | 2586 ✅ |
| `web-shell`（extensions、`useComposerCore.dom`、`useAtMentionMenu`、`AtMentionPanel`、`PluginManagerPage`） | 6 | 227 ✅ |
| `core`（`extension-store`） | 1 | 97 ✅ |
| `sdk-typescript`（`DaemonClient`） | 1 | 426 ✅ |

**非空洞性 —— 四个变异，全部被杀掉。** 每个变异都只回退本 PR 新增的某一处保护：

| 变异 | 被杀情况 |
| --- | --- |
| `GET /workspaces/:workspace/runtime/extensions` 改为解析 `registry.primary` 而非请求对应的运行时 | 3 个路由测试失败 —— **并且真实 E2E 退化成与 base 完全一样的缺陷**：变异构建下 `ws-b` 输入区又列出了 `wsprobe`，尽管 URL 仍是工作区限定的 |
| `useComposerCore` 始终使用绑定 primary 的旧加载器 | 7 个 `useComposerCore.dom` 测试失败 |
| `mergeExtensionCatalog` 去掉 runtime/coordinator 的 epoch 一致性门槛 | 1 个 `extensions-manager-logic` 测试失败 |
| `status()` 中 `appliedGeneration` 不再按存活运行时 epoch 重新认证 | 1 个 coordinator 测试失败 |

第一个变异最关键：它证明上面那条 E2E 判据确实对这个修复本身敏感，而不是被环境凑出来的。四个被变异文件中有三个在 `4e35093986` 与 `8c027e5d3a` 之间逐字节相同；路由变异在 tip 上重跑过。

---

### 截图

**输入区 `@` 菜单 A/B（composer 工作区 = ws-b）**

![composer @ menu before/after](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/ab-composer-at-menu.png)

**扩展管理页 A/B**

![extensions manager before/after](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/ab-manager-page.png)

**ws-b 的扩展详情页（Global = Enabled / Workspace = Disabled）**

![extension detail for ws-b](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/manager-detail-ws-b.png)

**PR 分支切回 ws-a 仍显示两个扩展**

![ws-a at menu](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/after-head-ws-a-at-menu.png)

**ws-b 存活会话中的扩展斜杠命令**

![live session slash commands](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/live-session-slash-commands.png)

---

### 发现（均不阻塞合并）

**1 · 既有问题，非本 PR 引入 —— 重新启用扩展后，已存活会话不会恢复它的斜杠命令。**

同一会话、同一运行时、`ws-b`：

```
初始（启用）    /wsprobe → /wsprobe-skill, /wsprobe-cmd   ✅
禁用之后        /wsprobe → 无匹配                         ✅  实时刷新生效
重新启用之后    /wsprobe → 无匹配                         ❌  命令没有回来
```

此时 daemon 侧是正确的 —— `/workspaces/<ws-b>/runtime/extensions` 报 `isActive:true`，`runtime/skills` 报 `ok`；而且在 `ws-b` **新建**的会话立刻就能看到 `/wsprobe-cmd`，只有那个已存在的会话是陈旧的。**同样的操作序列在 base `2f426a64` 上得到完全相同的结果**，所以这是会话级重新激活刷新的既有不对称，不是本 PR 的回归。建议另开 issue 跟进，而非在本 PR 中改。

**2 · 观察项 —— 新的输入区加载器没有套客户端 action 超时。**

被替换掉的 `workspace.actions.loadExtensionsStatus` 走的是 `withActionTimeout(..., 30_000)`。`useComposerCore.ts` 中新增的内联加载器没有，并且会在 `503 runtime_still_starting` 上按 `COMPOSER_EXTENSIONS_MAX_ATTEMPTS = 3` 重试 `ensureRuntime()`。由于 coordinator 自身的 ensure 截止时间是 60 s，超时后返回的正是这个 503，一个持续启动缓慢的次级工作区理论上可以让 `@`/`+` 扩展菜单停在 *Loading* 约 `3 × 62 s + 2 × 2 s ≈ 190 s`，而不是 30 s 就失败。

范围有限，而且我**没有**复现出来 —— 在真正冷启动的 `ws-b` 上菜单 **1.77 s** 就出来了。之所以提出来，只是因为这次改动把超时包装丢掉了；在整个重试循环外面套一层 `withActionTimeout`（或给多次尝试设一个总预算）就能廉价地恢复原有上界。

**3 · 说明，无需处理 —— 未受信任次级工作区的客户端分支属于纵深防御。**

`useComposerCore` 中「未受信任的非 primary 目标就不提供加载器」这一分支，以及管理页对未受信任目标的处理，在界面上都走不到：开启 folder trust 后，未受信任的工作区在**输入区工作区芯片**和 **Plugins 工作区选择器**中都会渲染为 `aria-disabled`，根本无法被选中。真正强制的边界是服务端的 `403 untrusted_workspace`，上面已验证。这些分支有单测覆盖，这里只是说明它们是双保险而非实际路径。

