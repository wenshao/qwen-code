## 维护者验证 —— 在本分支上做了真实的本地 A/B

我为这个 PR 搭了真实环境（worktree 检出到 `6ca85e0b62`，完整 `npm ci`（含 postinstall 的包构建），Node v22.22.2，vitest 3，Linux / 16 核），并通过在原位增删这三行来做 A/B 对比。

**结论：代码改动本身正确、定位准确、可以安全合并。但 PR 描述写的是另一个改动，而且 `Fixes #11414` 并不由这份 diff 兑现。** 请在合并前先更新描述。

---

### 本分支实际贡献了什么

相对 `main` 的三点 diff 是 **`applies authenticated open before the yargs path starts the daemon`**（`packages/cli/src/commands/serve.test.ts:429`）中的 3 行，等待的是 `mockOpenBrowserSecurely`。

分支上有两个实质提交：

| 提交 | 改动 | 相对 `main` 的净效果 |
| --- | --- | --- |
| `a2420452fd` | 在 `forwards --token and --allow-origin` 上等待 `mockQr.generate` | **无** —— `main` 已经通过已合并的 #11362（`10895031e2`，2026-09-09）拥有它 |
| `e7e2ecdf20` | 在 `--open-with-auth` 上等待 `mockOpenBrowserSecurely` | 这才是真正随本 PR 发布的改动 |

---

### 发现

#### 1.（重要，文档问题）描述写的是已经不在 diff 里的改动

描述说「`forwards --token and --allow-origin` 这个 Local Control 测试现在会等待其 handler 的**配对阶段**」。而 diff 等待的是 `--open-with-auth` 测试的**打开浏览器阶段**。测试不同、mock 不同、阶段也不同。

这对评审有实际影响，因为 **「审查者测试计划」是已合并的 #11362 的复现配方，不是本 PR 的**。我逐字执行了描述里的配方（第一个测试的 Local Control `enable()` 延迟约 100 ms，下一个测试延迟约 1000 ms）：

* 移除已合并的 #11362 等待后 → `Unhandled Rejection: Error: process.exit(1) called`，1 failed | 69 passed，`Errors 1 error` —— #11414 的失败签名与描述完全一致地复现；
* 保留已合并的 #11362 等待（即当前 `main`，也是本分支的状态）→ 70/70 全绿、零未处理错误，**无论本 PR 的三行是否存在**。

也就是说，按照描述里的步骤去验证，验证的是 `main`，不是这个 PR。

#### 2.（重要）`Fixes #11414` 夸大了这份 diff 的作用

#11414 的签名是由未处理的 `process.exit(1)` 导致的、**无归属**的整轮运行失败。本 diff 所封堵的泄漏**不可能**产生该签名：它唯一的出口是 `openBrowserSecurely`，而这个调用的所有失败路径都被 `maybeOpenWebShellBrowser` 自己的 `try/catch` 接住了。我直接验证过 —— 让泄漏的调用去消费下一个测试安装的一次性 `mockOpenBrowserSecurely.mockRejectedValueOnce(new Error('leak-boom'))`，运行结果是：

```
qwen serve: failed to open browser: leak-boom. Please open this URL manually: http://127.0.0.1:4170/#token=generated-token
Tests  1 failed | 69 passed (70)      <- 受害测试被点名，没有 "Errors" 行
```

没有未处理 rejection，也没有 `process.exit`。这个泄漏最坏只会造成一个**被点名的**测试失败。#11414 真正指向的隐患已经由 #11362 在 `main` 上关闭，而且 #11414 本身已于 2026-09-09 被手动关闭，所以这条 `Fixes` 既不准确也已失效。

#### 3.（小问题）在当前的 mock 下，这个等待是空操作 —— 它是保险，不是让 CI 转绿的那一环

`startServeHandlerWithArgs` 的锚点是「`mockRunQwenServe` 已被调用」。`vi.waitFor` 的第一次检查是同步的、在这里必然失败（handler 在调用它之前 `await` 了 `import('../serve/run-qwen-serve.js')`），之后的每次检查都是 50 ms 的 `setInterval` 宏任务。等到锚点被观察到时，下游链路 —— `runQwenServe` → `runtimeReady: Promise.resolve()` → `openBrowserSecurely` —— 早已跑完，因为它全是微任务。

在未打补丁的树上实测：在测试 A 走到断言的那一刻，`openBrowserSecurely` **25/25 次运行**都已经被调用过（15 次空载 + 10 次 CPU 超额订阅、16 核上负载约 38）。套件耗时没有变化（`tests 2.70s` vs `2.72s`）。

#### 4. 这个等待确实做到了它声称的事，范围也划得对

在锚点与可观测点之间强行制造一个真正的宏任务窗口（把测试 A 的 `runtimeReady` 延迟 300 ms），泄漏就真实发生，而这三行把它封住了 —— 打的是文件里**已有**的断言，不是我造的断言：

* 不带本 PR：泄漏的 `openBrowserSecurely` 落进 `prints the authenticated manual URL on the yargs headless path`，打破它的 `expect(mockOpenBrowserSecurely).not.toHaveBeenCalled()` → 1 failed | 69 passed；
* 带本 PR：70/70。

两项风险探针都干净：

* **会不会挂住？** 不会。把被等待的调用变成不可达（强制测试 A 走 headless 路径）后，`vi.waitFor` 在其 1000 ms 默认超时处放弃，并给出一个被点名的断言失败。有界且有归属，最坏多花 1 秒。
* **是否漏掉了同类的兄弟测试？** 没有。唯一结构相似的地方 —— `keeps Local Control pairing separate from the temporary primary token`，同样是 `--open-with-auth`、同样只锚在 `mockQr.generate` 上 —— 在同样的强制竞态下依然通过，因为 `startLocalControl` 在测试所锚定的 QR 调用**之前**就 `await` 了 `runtimeReady`，因此没有任何可观测行为能活过那个锚点。本文件不需要再补静默等待。

#### 5.（清理）#11376 现在是空的

描述中提到的另一个兄弟 PR #11376，相对 `main` 已是空 diff（`compare main...autofix/issue-11363` → 0 个文件改动），可以关闭。

---

### 本地门禁

| 门禁 | 结果 |
| --- | --- |
| `npx vitest run src/commands/serve.test.ts`（带 PR） | 70/70，连续 8/8 次 |
| `npx vitest run src/commands/serve.test.ts`（不带 PR） | 70/70 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npx vitest run src/commands`（整个目录，带 PR） | 170 个文件，7098 passed \| 19 skipped |
| PR CI | 全绿 |

---

### 建议

**修好描述后合并。** 改动本身是一处正确、有界、范围准确的测试加固，没有可测量的成本。但记录应当与代码一致：

1. 重写「本 PR 做什么 / 为什么需要」，改为描述 `--open-with-auth` → `openBrowserSecurely` 的等待；
2. 把「审查者测试计划」的复现步骤换成能真正触发**本** diff 的那一个（延迟测试 A 的 `runtimeReady`，而不是 Local Control 的 `enable()`）；
3. 把 `Fixes #11414` 降级为普通引用 —— #11414 的机制已由 #11362 关闭，保留这条 trailer 会把那次修复归到错误的提交上，误导下一个排查同类 CI 签名的人。
