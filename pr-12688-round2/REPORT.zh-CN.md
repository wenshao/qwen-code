## 维护者验证 —— 第 2 轮 @ `5d59f93`（仅增量）

**结论：可合入。** 第 1 轮的阻塞项已修复，我在全新完整构建上复核通过；两个新提交都没有引入回归。第 1 轮：[评论](https://github.com/QwenLM/qwen-code/pull/12688#issuecomment-5835014344)。

### 自第 1 轮以来的变化（`e3add752` → `5d59f93`）

- `62ff1afc` 修复 F1，其增删行与我在第 1 轮给出的补丁完全一致（91/91）。
- `5d59f93` 对应 triage 第 2 点：`advisorUsage` 改为 `readonly`，并在既有的 `isSessionTransition` 块内就地重置。新旧重置位置之间只有 `unregisterSessionModel` / `publishModelEnv` / `sessionData`，条件相同，常规路径行为不变。
- 提醒、工具、UI、文档与集成测试自 `3b49c69` 以来未变（仅 `e3add752` 的常量替换），因此第 1 轮的真实模型结果（§4）和观察项（§6）仍然适用，本轮没有重跑。

### 在 `5d59f93` 上复核

全新 `pnpm install` + `npm run build` + `npm run bundle`，均 exit 0；bundle 中已包含新的告警文案。

| 检查 | 结果 |
| --- | --- |
| F1 启动矩阵：user/system 的 `-1`、`1.5`、`"5"`，以及 Advisor 关闭时的 `-1` | 全部能启动，并打印 `Warning: advisorMaxUses must be a non-negative integer …`；`null` 与合法值启动时不告警；workspace 值仍被忽略并有各自的告警；base 不变 |
| `qwen serve`，user `-1`，`POST /session` | **200**（第 1 轮 head：500 `agent channel closed during initialize`） |
| 第 1 轮 §2 运行时 A/B（12 个 headless 场景 + `qwen serve` 路径） | 与第 1 轮一致 |
| **新增：** 真实 Ink TUI，上限 1，两阶段之间执行 `/clear` | 阶段 A：首次咨询成功，第二次被拒；`/clear` 之后，子代理咨询被放行，父代理随后的咨询被拒（同一份共享、已重置的额度）；Advisor 请求共 2 次。旧重置（`3b49c69` + 补丁）与新的就地重置结果相同 |
| PR 定向单测 | core 1360/1360、cli 487/487 |
| `integration-tests/cli/advisor-tool.test.ts` | 6/6 |
| `5d59f93` 上的 PR CI | 全绿；发帖时 `web-shell E2E Smoke` 仍在运行 |

| `5d59f93`，user `"advisorMaxUses": -1` | `5d59f93`，`/clear` 后子代理与父代理先后咨询 |
| --- | --- |
| ![](t4-invalid-head-r2.png) | ![](t5-clear-head.png) |

### 针对两个新提交的变异：7 个中 5 个被杀

| 变异 | 结果 |
| --- | --- |
| R2-M01 在 `tryConsumeAdvisorUse` 中重新赋值计数对象 | 被派生 Config 测试杀掉，**且被 `tsc` 拒绝（`TS2540 … read-only`）**：`readonly` 现在由编译器保证 |
| R2-M02 去掉就地重置 | 被杀（`resets the Advisor count when a new session starts`） |
| R2-M04 跳过校验 / R2-M05 接受负数 | 被杀（`falls back to unlimited …`） |
| R2-M06 永不发出设置告警 | 被杀（`warns that an invalid advisorMaxUses …`） |
| R2-M03 把重置移到 transition 判断之外，使恢复**当前**会话也会重置额度 | **存活**；补一条断言即可钉住：`config.startNewSession(config.getSessionId())` 之后计数不变（可选） |
| R2-M07 对显式 `null` 也告警 | 存活（仅影响提示文案） |

### 第 1 轮遗留项（均非阻塞）

1. **`advisor-tool.test.ts` 仍不在 PR CI 中。** 按 no-AK 通道自身的参数（`--poolOptions.forks.maxForks 2`）运行也是 6/6，所以只需在 `test:integration:no-ak:sandbox:none` 里加一行（[diff](data/noak-suggestion.diff)）：在 `./cli/_prompt-latency-policy.test.ts` 之后加上 `./cli/advisor-tool.test.ts`。这样第 1 轮的 M03/M10/M16/M25 都会进入 CI，建议并入本 PR。
2. **真实模型运行中没有一次在动手前咨询（0/5）。** 这关系到以后能否关闭 #9036，与本 PR 无关（本 PR 不会自动关闭它）。
3. 每轮提醒的成本（每轮 319 个 token）与交互式 `/advisor` 不显示额度：我同意放进 scope ledger 提议的 follow-up issue 跟踪。

证据：[`pr-12688-round2/`](.)
