## 维护者验证第二轮：`3aab049`（相对[第一轮](https://github.com/QwenLM/qwen-code/pull/12353#issuecomment-5772724630)的增量）

**结论：我这边仍认为可以合并。** 第一轮提出的跟进项全部落实；在 `3aab049` 上完整重新构建并重跑，结果与第一轮一致。

- **只是 rebase。** `git range-diff` 显示两个原提交都没有变化（`1ca47a8 = c57c85d`、`adc5c44 = f1d9686`）。`child-heap-args.ts`、`spawnChannel.ts`、`child-heap-policy.ts` 与 `adc5c44` 逐字节相同。唯一的新改动是 `3aab049`：一个测试、两处文案修正，以及中英文设计文档 §6（+28/−6）。
- **两个对照臂从零重建。** 我从零重建了 head `3aab049` 和 base `74b5eb9`（即 merge-base，也就是当前 `main`），每个都真实执行了 `pnpm install --frozen-lockfile`、build 和 bundle。harness 与第一轮相同。

| 第一轮事项 | `3aab049` 上的状态 | 核验方式 |
| --- | --- | --- |
| 以 Node 本身为 oracle 钉住 `NODE_OPTIONS` 一致性 | 原样采纳 | `child-heap-args.test.ts` 从 7 个用例增至 10 个，全部通过。变异体 M01（triage 建议的解析器改法）和 M06（写回时不再转义 `\`）现在都被杀死，正是被这几个新用例杀死的。总计：25/28 → **27/28** |
| `--memory-budget-mb` 帮助文本说预算不影响子进程大小 | 已修正 | 构建产物的 `serve --help` 现在写的是 "In `admit` and `enforce` modes it determines managed ACP child capacity; `enforce` also applies the modeled per-child old-space ceiling." |
| `daemon-status.ts` 中过时的注释 "`enforced` … stays `false`" | 已修正 | 阅读 diff |
| 发布文档应写明 heap 遥测的读取路径 | 中英文设计 §6 | 我在真实 daemon 上按文档步骤重放了一遍。挂 watcher 之前：`sampled: 0, heap: null`。挂上一个 SSE watcher，12 秒后：`sampled: 1, reported: 1, peakLiveSetBytes` 约 102 MiB，旁边是 `perChildCeilingMb: 768` |
| 百分比参数冲突要到 listener 就绪后才检测 | 未改（作者的决定） | 仍在打印 `listening` 约 1 秒后以 exit 1 退出，提示信息同样清楚。我同意保持现状 |

在 `3aab049` 上的重跑结果，全部与第一轮一致：

- **测试。** PR 的 12 个测试文件全部通过：140 + 2077 个用例，其中普通的完整 `server.test.ts` 运行为 1319/1319。对 21 个改动的 TS 文件运行 `eslint --max-warnings 0`、对 27 个文件运行 prettier，均无问题。
- **`observe` / `admit` / `off`。** 子进程堆参数、V8 上限（15384 MiB）以及 `enforced: false` 都与 base `74b5eb9` 完全相同。
- **`enforce` 生命周期。** 2 轮都是 38/38 项检查通过。每个主 workspace、启动时次级 workspace 和动态 workspace 的子进程都恰好拿到 `--max-old-space-size=768 --expose-gc`，V8 上限为 816 MiB。
- **并发准入。** 3/3 轮都是 2 个 200、2 个 503，存活子进程从未超过 2 个，`kill -9` 后名额被释放。启动校验矩阵的 9 个用例结果与第一轮相同。三种 `DEV=true` 下的 `NODE_OPTIONS` 写法中，daemon 与子进程加载的都是同一个 preload 文件。
- **`3aab049` 上的 CI。** 20 项成功，3 项跳过：macOS 与 Windows 的 `Test` 任务，以及 CLI integration。我检查时 web-shell E2E smoke 仍在运行。之前那个 head 上失败的 Java 21 任务现在已经是绿的。

（图：第一轮跟进项与变异前后对比、真实 daemon 全量重跑 —— 见上方英文部分）

**仍未验证**（与第一轮相同）：

- Windows 与 macOS 上的实际运行。
- 真实模型下的 GC 与延迟代价、多小时稳定性。
- M09（win32 下键名大小写不敏感的查找）仍然存活，但这段代码在 Linux 上执行不到。

证据：[`pr-12353-round2/`](.)；第一轮的 harness 与 oracle 见 [`pr-12353/`](https://github.com/wenshao/qwen-code/tree/23298692b1a8f8dd23828d7674f4aa2230ba33b7/pr-12353)。
