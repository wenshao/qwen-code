## 维护者验证 —— 真实环境实测（Linux）

我为本 PR 搭建了一套真实的端到端环境（真实 `qwen serve` daemon、真实 spawn 的 ACP child、两个监听不同端口的 OpenAI-compatible mock provider，以及 Chromium 中的真实 Web Shell），在 **merge base 与 PR head 两侧** 分别执行了 PR 的 Reviewer 测试计划以及我自己的补充探测。

| | |
|---|---|
| PR head | `23ad39acbb` |
| Merge base | `bc6f1a015cfb5e03a078733cbcfdb8bd05425fad` |
| 平台 | 🐧 Linux（Debian 13，内核 6.12.63），Node v22.22.2 —— PR 正文标注 Linux 为「未测试」 |
| Daemon | 真实 `qwen serve --port 4581 --workspace ws-main --workspace ws-second --allow-private-auth-base-url` |
| Provider | `alpha-model` @ mock A `:4501`（预置）、`beta-model` @ mock B `:4502`（运行期安装）；两个 mock 都会记录实际收到的 `model` 与 `Authorization` 头 |

**结论：该缺陷在 merge base 上可以精确复现，本 PR 已修复。建议合并。** 下面两条 follow-up 值得关注，尤其是 F1：在多 workspace 的 daemon 中，原始症状仍然可达，而接口却返回 `applied`。

---

### 1. merge base 上缺陷复现

先创建 Session，再安装 Provider —— 模型已列出，但 live session 无法使用：

```
### 1. install response（main 上没有 runtimeSync 字段）
{ "status": 200, "body": { "v": 1, "providerId": "custom-openai-compatible", "modelId": "beta-model", ... } }

### 2. provider status 已列出新模型
[ "beta-model(openai)", "alpha-model(openai)" ]

### 3. 在 live session 中选择这个可见的 route
{ "status": 500, "body": { "error": "Internal error", "code": -32603,
    "data": { "details": "Model 'beta-model' not found for authType 'openai'" } } }

### 4. SSE model_switch_failed 帧
{ "type": "model_switch_failed",
  "data": { "requestedModelId": "beta-model(openai)", "error": "[object Object]" } }
```

### 2. PR 侧确实修好了 —— 不只是响应体里的字段

```
### 2. POST /workspace/auth/provider
{ "status": 200, "runtimeSync": { "status": "applied" } }

### 4. 在「变更前就已存在」的 session 上 POST /session/:id/model beta-model(openai)
{ "status": 200, "body": { "_meta": { "qwenModelSwitch": {
    "authType": "openai", "modelId": "beta-model",
    "baseUrl": "http://127.0.0.1:4502/v1", "apiKey": "bet...t-v1" } } } }

### 6. 热切换之后的一轮对话（由哪个 mock 应答？）
MOCKB:hello-after-switch
```

mock 的请求日志证明凭据本身也跟着切过去了，而不仅仅是 route：

```
[{ "label": "MOCKB", "model": "beta-model", "auth": "Bearer beta-secret-v1" }]
```

### 3. Reviewer 测试计划 —— 六步全部通过

| 步骤 | 结果 |
|---|---|
| 1–2. 在已有 session 上安装并直接选择 route（不重启） | ✅ `runtimeSync.status = applied`；切换返回 200；该轮对话由 mock B 应答 |
| 3. turn 执行期间安装 | ✅ 安装在 turn 中途 **15 ms** 返回；进行中的 turn 用原 generator 跑完（`MOCKA:SLOW-DONE`），结束后新模型可选 |
| 4. 删除模型 | ✅ `{removed:true, clearedActiveModel:true, runtimeSync:{status:"applied"}}`；provider status 中消失；live session **未被隐式切换**，继续用已持有的 generator（`MOCKB:after-delete`）；旧 route 被拒绝；`alpha-model(openai)` 仍可选且仍路由到 mock A |
| 5. 重建 ACP channel | ✅ 对 ACP child `kill -9` 后，替换的 child 能选中新 route，并携带 `Bearer beta-secret-v1` |
| 6. 注入失败 | ✅ 将 workspace `.env` 置为不可读后：HTTP **200** + `runtimeSync.status = failed`，用户配置**未回滚**，provider 仍然列出，Web Shell 给出告警而非报错 |

`qwen-oauth` 模型在 `ModelRegistry.reload()` 重写后依然存在 —— 每次变更之后 `coder-model(qwen-oauth)` 仍在列表中，说明构造函数里的硬编码重新注册确实正确替代了原来的「保留 qwen-oauth」分支。

### 4. 并发

8 次 Provider 安装与 8 次 Session 创建交叉执行：每次安装都返回 `applied`，每个 Session 创建耗时约 30 ms，且这 8 个在「风暴」期间创建的 Session **全部**能立即选中最后一次安装的模型。Session 发布前新增的 `while (true)` 重载循环既没有活锁，也没有让 Session 创建出现可测量的变慢。

### 5. 证据

**同一个 live 会话的模型选择器，变更前 / 变更后**

![model picker](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/01-model-picker.png)

**`[object Object]` 修复：两侧是同一个失败**

![switch error](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/02-switch-error.png)

**在已存在的 Web Shell 会话中完成热切换**

![hot switch](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/03-hot-switch.png)

**`failed` 告警路径**

![runtime sync failed](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/04-runtime-sync-failed.png)

---

### 问题清单

#### F1 —— 同步止步于 primary workspace，但状态仍然是 `applied`（建议处理）

`DaemonClient.installAuthProvider` / `deleteModel` 始终请求非限定路由 `/workspace/auth/provider` 和 `/workspace/models`，而 `createServeApp` 只把 `syncModelProvidersRuntime` 接到 `primaryWorkspace.reloadModelProviders(...)`。`modelProviders` 持久化在 **user** scope，因此每个 workspace 的 provider status 都会列出新模型 —— 但只有 primary workspace 的 ACP child 被刷新。

在 daemon 同时绑定 `ws-main`（primary）与 `ws-second`、两侧都有预热过的 live session 时，2/2 复现：

```
### install（非限定路由 = primary workspace）
{ "status": 200, "runtimeSync": { "status": "applied" } }

### PRIMARY workspace session 切换
{ "status": 200, ... }

### SECONDARY workspace session 切换
{ "status": 500, "body": { "error": "Internal error", "code": -32603,
    "data": { "details": "Model 'beta-model' not found for authType 'openai'" } } }
```

这正是 #10184 原封不动的表现，而且由于状态是 `applied`，Web Shell 完全不会给出任何提示。范围说明里写了「qualified 多 workspace 变更路由不在本次范围内」，这没问题；但*非限定*路由改的是对整个 daemon 全局的状态，所以要么同步应遍历所有 live workspace runtime，要么在其它 live child 未被刷新时不应返回 `applied`。

已经生效的部分缓解：在安装**之后**才在 `ws-second` 创建的 Session 能正确解析该模型 —— 新增的「发布前重载」路径覆盖了新建 Session。卡住的只有非 primary workspace 中变更前就已存在的 Session。

#### F2 —— 在 Web Shell 中安装完成后，当前会话的模型选择器需要刷新页面才会更新

PR 构建上实测：live 会话 → `/auth` → Custom Provider 向导 → 保存 → `Successfully configured Custom Provider.`；随后在 t+0 s、t+5 s、t+10 s 打开模型选择器，都只有 `alpha-model`。按 `F5` 重新打开同一个会话后，选择器才列出 `beta-model`，且切换成功。

daemon 侧确实已经修好（REST 的 `POST /session/:id/model` 立即成功），但 `AuthMessage.save()` 只调用了 `onMessage()` / `onClose()` —— 而 `handleDeleteModel` 是会调用 `reloadProviders()` / `reloadWorkspaceSettings()` 的。于是本 PR 想解决的那条路径（「装完模型，就在我已经打开的会话里用」）仍然需要手动刷新。这不是回归 —— `main` 上表现相同，而且之后还会切换失败 —— 但它削弱了修复中面向用户可见的那一半，而相对本 PR 的体量，这是个很小的改动。

#### F3 —— 仅父进程环境降级时，`failed` 的提示偏重

注入父进程 env 文件读取失败后，**child** 的重载其实是成功的，live session 立刻就能选中并使用新模型 —— 但响应仍是 `failed`，Web Shell 提示「运行中的会话无法刷新，请重启 qwen serve」。这符合文档中 fail-closed 的设计意图（供后续 child 使用的父进程快照确实没刷新），因此我不要求改动；只是指出面向用户的措辞比实际失败的范围更严重。

#### F4 —— 这两个变更接口现在完全没有客户端超时

`packages/webui/src/daemon/workspace/actions.ts` 中 `installAuthProvider` / `deleteModel` 的 `withActionTimeout` 被移除，同时 `DEFAULT_PROVIDER_MUTATION_TIMEOUT_MS = 0` 关闭了 SDK 的 fetch 计时器，浏览器侧不再有任何上限。对 ACP child 执行 `SIGSTOP` 后实测：`POST /workspace/auth/provider` 在 **25.7 s**（单 child）与 **24.3 s**（三个 child）后返回 200 —— 都在 daemon 自身 30 s 的 `invokeWorkspaceCommand` 预算内，所以这个改动是合理的，转圈也确实会结束。可以考虑给一个宽松的客户端上限（60–90 s）而不是完全不设，这样万一某条 daemon 侧路径没能守住预算（例如 `withSettingsLock` 被更慢的操作占用），UI 也不会一直转下去。

### 顺带值得一提的改进

`LoadedSettings.reloadScopeFromDisk` 现在会在 `workspaceSettingsActive` 为 false 时清空 workspace scope，而不是继续从磁盘读取。这补上了一个超出本 PR 标题范围的真实漏洞：此前在 untrusted / `skipWorkspaceSettings` 的 workspace 中重新加载，会把 workspace settings 文件重新合并回来。`settingsWatcher` 同样受益于这个修复。

### 静态检查（PR head，全新 `npm ci` + `npm run build`）

| 检查项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0 |
| `packages/cli`（10 个受影响文件，含 `acpAgent`、`Session`、`settings`、`settingsWatcher`、`environment`、`workspace-models`、`run-qwen-serve`、`server`、`facade`） | ✅ 3072 passed |
| `packages/acp-bridge` `bridge.test.ts` | ✅ 804 passed |
| `packages/core` `config` + `modelRegistry` | ✅ 667 passed |
| `packages/sdk-typescript` `DaemonClient.test.ts` | ✅ 360 passed |
| `packages/web-shell` `App` + `AuthMessage.dom` | ✅ 556 passed |
| `packages/webui` `workspace/actions.test.ts` | ✅ 18 passed |

**共 5477 个测试，0 失败。**
