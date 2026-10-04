## 维护者验证第 2 轮：PR #9273 @ `0b51eef6c6`（相对第 1 轮的增量）

**结论：从验证角度看已没有阻断项，可以合并。**

第 1 轮（[评论](https://github.com/QwenLM/qwen-code/pull/9273#issuecomment-5970490274)，`5936b9f118`）发现 1 个阻断项。在当前 head，阻断项已修复，应修项和字体建议也已修复：

- 每项修复都用构建好的 CLI 在**真实 tmux 3.5a** 和**真实 freeze v0.2.2** 上跑过。
- R1 head 从同一 worktree 构建，作为负对照：每个缺陷在它上面都能复现。

`0b51eef6c6` 里的其他行为变更（R26-2、R26-3、R26-4）也按同样方式验证：每项都在 R1 head 复现缺陷，在当前 head 已修复。R26-5 只有单元 pin，变异测试证明它能抓住回退。

仍然开着的都不阻断：作者推迟的 sentinel 小问题、PNG 保真度里颜色那一半，以及文末三条小观察。

### 环境

- PR head 为 `0b51eef6c686af13ff2c6f2ab67c6e6f2d3b48dc`。
- 同一 worktree 产出两份构建，都用 `npm run bundle`：`dist-old/` 来自 `5936b9f118`（检出三个生产文件），`dist-new/` 来自 `0b51eef6c6`。Debian 13，Node 22.22.2，tmux 3.5a，freeze v0.2.2 release 二进制；本机由 `rsvg-convert` 光栅化。
- 可无冲突合入当前 `main` `6136786c0c`（`git merge-tree` 退出码 0）。main 新增的 29 个提交都没有触及 `commands/review/`。

### 第 1 轮发现在当前 head 的状态

| # | 第 1 轮 | `0b51eef6c6` | 证据 |
| --- | --- | --- | --- |
| 1 | **阻断**：有真实 freeze 时，`png` 档位写出的是 SVG | ✅ **已关闭** | 用两份构建分别捕获 qwen 自己的 TUI（80×24）。R1 head 上，`qwen.png` 是 `SVG XML`，`validateAssetContent` 返回 `{ok:false, "…extension claims png…"}`。当前 head 上是 `PNG image data, 2940 x 1880`，门禁返回 `{ok:true}`，也没有残留 `.render-*` 文件。只回退后缀，新 pin（`lands a PNG the publish gate accepts`）就会变红。 |
| 2 | **应修**：fixture 以 0755 创建真实的 `/tmp/tmux-<uid>` | ✅ **已关闭**（五处） | 在 user namespace 里以 uid 1000 运行、`/tmp/tmux-1000` 不存在时，三个套件为 **335 过 / 1 跳过**；第 1 轮是 67 失败 / 262 通过。日志里没有任何 "unsafe permissions" 拒绝。五个 fixture 单独跑完后目录都是 `drwx------`，之后 uid 1000 的真实 `tmux new-session` 仍能启动。 |
| 3 | 建议：PNG 用了比例字体 | ✅ **已关闭**（字体部分） | 图 2 就是 png 档位产出的原始文件，未做任何修改：标题框右边框是一条直线。去掉 `--font.family monospace`，`freezePlan` 的 argv pin 就会变红。颜色那一半（freeze 丢弃 SGR 7 和 SGR 44）作者有意留给 brief 处理；这一点仍然成立，但不阻断。 |
| 4 | 小问题：被 SIGKILL 的启动器会留下 `qwen-capture-ready-*` | 作者已推迟；仍可复现 | 本轮留下 3 个 sentinel，每个被 SIGKILL 的启动器各一个。按作者提议另开后续切片处理即可。 |

### `0b51eef6c6` 中的其他行为变更：R1 head 与当前 head，同一主机

**R26-4：精确匹配 `=cap:` 目标。** 场景：pane 命令在自己 `$TMUX` 所在的 server 上植入 `capdecoy`，再执行 `kill-session -t =cap`。
- R1 head：退出码 0，`.ans` 为 `DECOY-FROM-INSIDE foreign-bytes`，manifest 写 `settledBy: until-match`。外来 pane 被认证为本次运行的证据。
- 当前 head：退出码 3，输出 `refused — tmux failed mid-capture: can't find session: cap`，不写 `.ans` 也不写 manifest。普通捕获在新的目标写法下仍正常。

**R26-2：被信号杀死的探测。** 场景：`tmux -V` 或 `freeze --help` 给自己发信号；另外在 `tmux -V` 挂起时用真实的 `timeout -s TERM 2` 杀整个进程组。
- R1 head：拒绝信息和 manifest 里都写 `the binary ran and failed, so it is installed but not usable here. Fix the installation`。
- 当前 head：写 `killed by a signal, possibly this run's own termination … nothing about its usability was established`。freeze 侧降级为 `ans-only`，措辞相同。

**R26-3：kill 之后 socket 已经消失时的 `review cleanup`。** tmux 3.5a 会保留 socket，所以我用一个包装脚本模拟会 unlink 的 tmux 构建。
- R1 head：对一个已经什么都没有的路径打印 `WARNING: … its socket was left in place`，没有 `Reaped`，也没有 `Nothing to clean`。
- 当前 head：打印 `Reaped orphaned capture server: …` 和 `Nothing to clean`，没有 WARNING。

**R26-5：planted-guard 2×2（无 stamp × 另一 base）。** 本轮没有做端到端验证。完整回退会让 `an unstamped run never connects or unlinks an entry at its unique name on ANOTHER base` 变红。

**额外检查（不属于增量）：freeze 崩溃。** 主机没有 `rsvg-convert` 时，freeze v0.2.2 会退回自带的光栅化器，它在本机每次都 segfault。这是 freeze 自身的问题，与本 PR 无关。capture-tui 的处理是正确的：
- 退出码 0，`evidence: "ans-only"`；
- `degradedBecause` 里写 `freeze failed (exit 2: …)`；
- 没有 `cap.png`，也没有暂存残留。

### 第 1 轮 E2E 重跑、测试套件、变异测试、CI

- **第 1 轮 E2E（`run-e2e.sh`，S1–S8）：** 当前 head **38 / 38**。第 1 轮为 37 / 38，唯一失败在 S2，即 png 档位（图 3）。
- **三个改动套件，root：** **332 过 / 4 跳过（共 336）**，与作者的数字一致。uid 1000：335 / 1。
- **变异测试：** 每处生产改动单独回退（图 4），全部被抓住：

  | 变异 | 回退的改动 | 失败测试数 |
  | --- | --- | --- |
  | M1 | png 后缀 | 1 |
  | M2 | 模糊匹配 `-t cap` | 4，包括真实 tmux 诱饵测试 |
  | M3 | 信号死亡 | 2 |
  | M4 | ENOENT 被当作替换 | 1 |
  | M5b | R26-5 完整回退 | 1 |
  | M6 | 字体 argv | 1 |

- **`0b51eef6c6` 的 CI：** 以下 lane 通过：Test (ubuntu)、Lint & Static、Integration (no-AK)、web-shell E2E smoke、TUI parity、Desktop Shell。macOS 和 Windows 的 Test lane 被路由跳过，我也只测了 Linux，所以 `=cap:` 写法和 0700 fixture **在 macOS 上未验证**。

### 非阻断观察

1. **冗余子句。** `capture-tui.ts:1526` 的 `socketStamp === undefined ||` 已被后面两个子句蕴含：没有 stamp 时 `isStampedSocket` 为 false，另一 base 子句现在也无条件成立。单独删掉它，187 个测试仍全绿（M5a），所以这是等价变异，不是测试缺口。真正的行为变化是另一 base 子句去掉了 `socketStamp !== undefined &&`（M5b）。为了注释保留它或者删掉都可以。
2. **可能未被 pin 住的分支（既有代码，不在本次 diff）。** `capture-tui.ts:1634` 处同样的写法位于 reap 的 `confirmedDead` 分支，删掉后 187 个测试也全绿（M7）。这个分支要么没被 pin 住，要么只能经 tmux 的 `/tmp` 回退到达。我没有确认是哪一种，值得在后续批次里看一眼。
3. **freeze 失败信息不具信息量。** `freeze failed (…)` 引用的是 stderr 的**最后**两行（`capture-tui.ts:2408`）。遇到 Go panic 时，这是 goroutine dump 的末尾（`created by unique.runtime_registerUniqueMapCleanup … mgc.go:1794`），没有信息量。第一行（`SIGSEGV: segmentation violation` / `unexpected fault address`）才是有用的部分。属于外观问题。

### 未验证

- macOS 和 Windows：两个 CI lane 都被跳过，我也只跑了 Linux。
- freeze 自带光栅化器（没有 `rsvg-convert`，macOS 上很可能走这条路径）：它在本机会崩溃，所以 `--font.family monospace` 的效果只在 `rsvg-convert` 路径上验证过。
- R26-5 的端到端验证：只有单元 pin 和 M5b 变异覆盖。

### 复现

harness、运行记录和未修改的 `qwen.png`（`data/current-head-qwen.png`）都在本目录：

- `harness/delta.sh`：D1–D5，`dist-old` 与 `dist-new` 的 A/B 对照。
- `harness/run-e2e.sh`：第 1 轮的 S1–S8 套件。
- `harness/unit.sh`：root 和 uid 1000 下的测试套件。
- `harness/mutate.sh`：变异抽查。
- `harness/render.cjs`：渲染图片。

### 图

![delta A/B](fig1-delta.png)

![png rung output](fig2-png-rung-real-tui.png)

![round-1 E2E rerun](fig3-e2e.png)

![suites and mutation](fig4-unit-mutation.png)
