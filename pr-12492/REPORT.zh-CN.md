## 维护者验证 — PR #12492 @ `8560fe95`（真实构建、真实 TUI、真实 DashScope）

**结论：修三处小问题（R3-7、R3-3、R3-10；补丁 +30/−6 见下，已 RED→GREEN）后可合入。** 在这个 head 上工作流端到端可用，我实际跑过的有：
- 真实 DashScope 上的 `check`、预览、篡改后拒绝，以及一次真实付费提交（已交付）；
- 真实 TUI 中的 `/batch-api`，从写计划一直到自动唤醒汇报；
- 启动时自动收取；
- PR 自带的 27 项 E2E。

所有探测下，金钱安全核心都成立：默认审批模式下，付费提交始终单独弹审批（有宽泛 allow 规则也一样）；预览摘要过期就拒绝提交。

自动评审挂着的 10 条 Critical 我全部复现了，另外也复现了 pomelo-nwu 提的 `list()` 问题。其中 3 条值得合入前修；其余属实但触发面窄，建议合并成一个后续 issue。

环境：Linux x86_64，Node 22.22.2。worktree 在 `8560fe95`，base 为 `64c04538`。`pnpm install --frozen-lockfile` 用时 1m07s，`npm run build` 3m30s，随后 `npm run bundle`。所有运行都使用隔离的 `HOME`/`QWEN_HOME`。

### 1. 可用性（均在本 head 实测）

| 检查 | 结果 |
| --- | --- |
| 单测：batch 各套件 + `startup-prefetch` + `cli.test` + `config.test`（9 个文件） | **753/753** |
| core `src/skills` + `batch-api/SKILL.test.ts` | 751/752。唯一失败的 `skill-curator › reports skippedErrors when rename fails transiently` 在 base `64c04538` 上同样失败，原因是以 root 身份运行，与本 PR 无关 |
| 在 bundle 上跑 `docs/verification/batch-api/workflow-e2e.mjs` | **27/27**，这是该 E2E 首次在这个确切 head 上运行：作者对 `8560fe95` 只跑了单测、lint、构建和类型检查；批准评审里写的 "22/22" 是旧的检查项数 |
| 对 `dashscope.aliyuncs.com` 真实执行 `qwen batch check` | 配置矩阵见下图。会话用 Anthropic 且设了 `batch.model: qwen3.7-plus` → `ready`，0.66 s，不计费；Anthropic 或 Qwen OAuth 未设 `batch.model` → 明确拒绝；`batch.model` 写了不存在的 id → 明确拒绝 |
| 真实预览 → 篡改 → 拒绝 | 改动源文件后，`--expect 9ebf0064…` 以 `the batch changed since it was previewed` 拒绝；零上传，也不留任务记录 |
| 真实付费提交（4 篇短文档中译英，`qwen3.7-plus`） | 输出 `batch job: batch_b94e3319-…`，任务记录为 `running 0/4` |
| 对该 batch 真实执行 `collect --wait` | 提交后约 52 分钟结束，期间轮询 27 次，退避 10 s → 60 s。结果：**4 个交付，0 held，0 failed**，4 个 `TEST-0x` 标识全部保留，用量 `584 in / 2,975 out`。账本最终为 `done` / `collected: true`，目录 0700、文件 0600。再执行一次 `collect` 只读本地，目标文件 mtime 不变；`list` 显示 `done 4/4` |
| 真实 TUI `/batch-api`：脚本化 agent 模型 + 假 DashScope，经 `scripts/cli-entry.js` 启动 bundle | 走完整个 SKILL 流程。以下步骤各弹一次审批：`batch --help`、`batch check`、写计划、`run --dry-run`、`run --expect`（**付费**，弹框时预览就在屏上）、`collect --wait` 后台 shell。随后输入框恢复可用，`/tasks` 里能看到 waiter。waiter 按 10 s → 20 s 退避轮询，下载 1 个文件、删除 2 个，agent 被唤醒一次，交付 3 个文件 |
| `QWEN_CODE_CLI` | PATH 上装着旧版 `/usr/bin/qwen`，但 shell 执行的是本会话自己的构建（审批框显示 `Allow execution of: 'cli-entry.js'`） |
| 模型无法调用 | 首个模型请求列出的 15 个 skill 里没有 `batch-api`；`/batch` 描述里带上了新增的“可以建议用户输入 `/batch-api`”一句 |
| 默认模式下付费提交无法被预授权 | 在无害的 `batch --help` 审批上选 "Always allow"，保存下来的规则是小写化的 `Bash("${qwen_code_cli:-qwen}" *)`，此后每条命令仍然弹框。预置大小写正确的 `Bash("${QWEN_CODE_CLI:-qwen}" *)` 或 `… batch *)`，付费的 `run --expect` 照样弹框。正对照：预置 `Write` 规则后，写计划那一步不再弹框 |
| 在没有 Batch 任务的项目里开会话 70 s | Batch 请求 0 次，`~/.qwen/batch` 始终没有创建 |
| 启动时自动收取 | 先用 CLI 提交，在没有会话的情况下等 batch 结束，再启动新 TUI。启动后约 1 s 内完成 GET → 下载 → 2 次 DELETE，并发出一条列出 3 个已交付文件的通知。第 3 轮沙箱验证把这条正向路径列为“未覆盖” |

![真实 DashScope：check 矩阵、预览、篡改拒绝、付费提交](01-real-dashscope-check-preview-submit.png)

![TUI：付费提交审批框，预览就在屏上](02-tui-approve-paid-submit.png)

![TUI：后台 waiter 完成后唤醒 agent 汇报](03-tui-waiter-wakes-agent.png)

![TUI：无会话期间结束的任务，在新会话启动时被自动收取](04-tui-startup-autocollect.png)

### 2. 未关闭的 R3 Critical：逐条执行复现

均用真实 bundle 对假 DashScope 执行，网络命名空间只有回环。R3-3、R3-7、R3-10 我本人又重跑了一遍。

| 编号 | 复现 | 现象 | 现实触发 | 合入？ |
| --- | --- | --- | --- | --- |
| **R3-7** | 是 | ModelStudio 预设条目（`extra_body.enable_thinking: true`）加 `/effort none`：**realtime 发 `enable_thinking:false`，Batch 发 `true`**，预览显示 `thinking on`。原因：realtime 在合并参数**之后**才应用 `reasoning === false`（`pipeline.ts:1163-1199`），而 `freezeRequest` 只要看到该字段已存在就跳过关闭逻辑（`batch-docs.ts:128-131`）。这违背了 PR “与 realtime 同条件”的说法，也会为用户已关闭的思考 token 计费 | 常见：默认预设 + `/effort none` | **合入前修**（2 行） |
| **R3-3** | 是 | `QWEN_BATCH_HOME=""` 时，连 skill 的第一步 `run --dry-run` 都会往项目根写一个内容为 `*` 的 `.gitignore`：`git status` 从 2 个未跟踪文件变为空，`git add -A` 什么都暂存不了。如果项目根已有 `.gitignore`，则任务记录（含源文件全文副本）会作为可提交文件出现 | 少见：env 文件里一行空赋值 | **合入前修**（1 行；后果是文件静默漏提交） |
| **R3-10** | 是 | 状态轮询遇到一次瞬时 503 或 429，`collect --wait` 在约 10 s 后以 exit 1 退出。随后执行普通 `collect` 能全部交付，不丢数据；但 skill 依赖的后台 waiter 在长达数小时的等待里会因第一次抖动就退出 | 数小时轮询中很可能发生 | **合入前修**（成本低） |
| R3-2 / R3-4 / R3-8 | 是 | 同一根因：`attempt.collected` 同时表示“已收取”和“远端已清理”，而遇到不可用的服务端数据时没有终止出口。结果行畸形或无法映射、DELETE 恒失败、结果文件 404，这三种情况都会让任务卡死：`retry` 说 “may still be running”，`cancel` 说 “already settled”，只能 `clean --force` 退出 | 不常见（需服务端异常或权限受限的 key） | 后续 issue |
| R3-1 | 是 | 设了 `max_completion_tokens` 时，`check` 显示 `provider default`，而 `run --dry-run` 显示真实的 1024 上限；上传的请求体是正确的 | DashScope 下少见 | 后续 |
| R3-9 | 是 | 只通过 `.env` 或 settings `env` 设置的 `QWEN_BATCH_HOME`，run/collect 会用，`list`/`clean` 不会 | 低 | 后续 |
| R3-5 / R3-6 | 是，影响小 | retry 的 create 被 4xx 拒绝后，下一次 collect 会把失败原因恢复成旧值，源文件已变的条目会翻回 `held`；之后仍能正常 retry。不影响计费或交付 | 少见 | 后续 |
| pomelo-nwu `list()` | 是 | 磁盘上 1 个正常、1 个 JSON 损坏、1 个 `schemaVersion: 2` 的任务：`list` 只显示正常的那个，stderr 为空；自动收取器同样跳过被隐藏的任务 | 极少（写入是原子的） | 后续（加一行警告即可） |

![R3-7 / R3-3 / R3-10 复现](05-r3-repro-evidence.png)

R3-7 / R3-3 / R3-10 的补丁（+30/−6）：

```diff
--- a/packages/cli/src/commands/batch-docs.ts
+++ b/packages/cli/src/commands/batch-docs.ts
@@ -125,11 +125,12 @@
   })) {
     if (value !== undefined && value !== null) params[key] = value;
   }
+  // Realtime applies `reasoning: false` after merging extra_body (pipeline
+  // disable path), so a preset's `extra_body.enable_thinking: true` does not
+  // keep thinking on there; it must not here either.
   if (
     config?.reasoning === false &&
     !config.thinkingMandatory &&
-    params['enable_thinking'] === undefined &&
-    params['reasoning_effort'] === undefined &&
     !setThinking(params, model, false)
   ) {
     notes.push(
--- a/packages/cli/src/commands/batch-task.ts
+++ b/packages/cli/src/commands/batch-task.ts
@@ -264,9 +264,12 @@
 export function batchHomeDir(
   env: Record<string, string | undefined> = process.env,
 ): string {
-  return (
-    env['QWEN_BATCH_HOME'] ?? path.join(Storage.getGlobalQwenDir(), 'batch')
-  );
+  // An empty value (`QWEN_BATCH_HOME=` in an env file) means unset, not
+  // "the current directory".
+  const configured = env['QWEN_BATCH_HOME']?.trim();
+  return configured
+    ? path.resolve(configured)
+    : path.join(Storage.getGlobalQwenDir(), 'batch');
 }
 
 /** Task records hold full copies of the sources and the generated outputs. */
--- a/packages/cli/src/commands/batch-workflow.ts
+++ b/packages/cli/src/commands/batch-workflow.ts
@@ -653,7 +653,27 @@
   const sleep = deps.sleep ?? realSleep;
   let delay = 10_000;
   for (;;) {
-    const job = await api.getBatch(deps.ep, batchId);
+    let job: BatchJob;
+    try {
+      job = await api.getBatch(deps.ep, batchId);
+    } catch (error) {
+      // Hours of polling will meet a 429/5xx or a dropped connection; only a
+      // definite client error (bad key, unknown batch) ends the wait early.
+      const status = (error as BatchApiError | undefined)?.status;
+      const definite =
+        typeof status === 'number' &&
+        status >= 400 &&
+        status < 500 &&
+        status !== 408 &&
+        status !== 429;
+      if (definite || Date.now() >= deadline) throw error;
+      deps.err(
+        `[batch] warning: polling ${batchId} failed (${error instanceof Error ? error.message : String(error)}); retrying`,
+      );
+      await sleep(Math.min(delay, deadline - Date.now()));
+      delay = Math.min(delay * 2, 60_000);
+      continue;
+    }
     if (SETTLED_STATUSES.has(job.status)) return job;
     if (Date.now() >= deadline) {
       throw new Error(
```

新增测试在 head 源码上 4/5 失败，打补丁后 5/5 通过；原有 168 个 batch 用例在打补丁前后都通过。打过补丁的 bundle 也做了端到端验证：Batch 改为发送 `enable_thinking:false`，两个对照组不变；waiter 打印 `warning: polling … failed (…503…); retrying` 后以 exit 0 交付 2 个文件；`QWEN_BATCH_HOME` 为空时项目里不再出现 `.gitignore` 或 `tasks/`，记录落到默认目录。

### 3. 次要说明（不阻塞）

- **token 估算不含 thinking，预览却没有说明。** 这次真实 batch 按预设 `extra_body` 冻结为 thinking 开启（ModelStudio `qwen3.x` 条目的默认值）。预览估算 `~584 out`，实际为 2,975（5.1 倍），其中 2,608 是推理 token。`completion_tokens`（含推理）最高到 796，接近计划设定的 800 上限。也就是说，在开启 thinking 的模型上，`maxOutputTokens` 大部分被推理消耗；基于这个估算的 `maxCostUsd` 门禁可能放行实际花费高出数倍的 batch。`assembleAttempt` 的代码注释写明了不含 thinking，面向用户的那一行也应该写明。
- 计划里设了 `maxOutputTokens` 时，`run --dry-run` 显示 `max output 800 tokens (frozen from your current settings; …)`，但 800 来自计划，不是设置。
- `check` 证明的是 `/batches` 路由可用，而不是该模型支持 Batch：某私有网关端点对其聊天模型也返回了 `ready`。说“Batch 路由可用”是准确的，说“可以用这个模型跑”就不准确了。
- 既有问题，非本 PR 引入：对任何 `"${QWEN_CODE_CLI:-qwen}" …` 命令，"Always allow" 选项保存的都是小写化、永远匹配不上的规则，`/review` 同样受影响。在本 PR 场景下这无害（付费审批本来就无法跳过），但值得单独开一个 issue。

### 4. 未覆盖

Windows（锁文件、`wx` 交付）；`auto`/`yolo` 审批模式（`yolo` 按定义不弹框）；在本 head 上用真实模型做交互运行（作者的真实运行在 `fe9efcaf`；我的 TUI 运行用的是脚本化 agent 模型 + 假 DashScope）；stage-B 成本对比。

证据（截图、harness、原始日志、补丁与测试）：（本目录）
