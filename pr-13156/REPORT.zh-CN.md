## 维护者验证：Linux 上真实 CLI，head `5078d2af` ✅

**结论：可以合入。** 我在干净的工作树上分别构建了三棵树：PR head、它的 merge-base，以及 head 合入当前 `main` 后的结果。然后用脚本化的 OpenAI 兼容端点驱动真实的交互式 CLI。

之前几轮留下两处空白：作者在 macOS 上验证，沙箱验证直接调用编译后的构建函数。本轮在 Linux 上走宿主自己的流程（模型写入笔记 → 宿主重建 `MEMORY.md` → 刷新系统提示词），并且从模型实际收到的请求里读取索引。

| 检查项 | merge-base `47463b79` | PR head `5078d2af` | head 合入 `main` `1a4de748` |
|---|---|---|---|
| 端到端 A：系统提示词中能用 `read_file` 打开的索引链接 | **3 / 7**，4 次 `File not found` | **7 / 7** | 7 / 7 |
| 端到端 B（200 条笔记，触发大小上限）：系统提示词中的死链 | **34 / 166** | **0 / 166** | 0 / 166 |
| 端到端 B：保留的常规笔记 · 保留的长链接笔记 | 132 / 160 · 0 / 40 | **160 / 160 · 6 / 40** | 160 / 160 · 6 / 40 |
| `packages/core` `src/memory` vitest | 1003 通过 · 0 失败 | 1020 通过 · 0 失败 | 1020 通过 · 0 失败 |

### 执行内容

1. **构建。** 每一臂都执行 `pnpm install --frozen-lockfile`、`npm run build`、`npm run bundle`，全部退出码为 0。head 的 bundle 含有新增的 `PATH_TARGET_RAW_NON_ASCII` 字符类，base 的没有，说明两臂确实不同。与 `main`（比 merge-base 领先 35 个提交）合并无冲突。
2. **端到端 A：逐条打开链接。** 在 pty 中启动 `node dist/cli.js --approval-mode yolo`，用户记忆库放在 `QWEN_CODE_MEMORY_BASE_DIR`，其余为默认设置，所以召回保持 `legacy` 模式，索引会进入系统提示词。
   - **初始状态：** 磁盘上有 6 条笔记，外加一个只有一行的过期 `MEMORY.md`。
   - **第 1 轮：** 脚本模型调用 `write_file` 写入第 7 条笔记，标题有 104 个字符。宿主的 `refreshMemoryAfterManagedWrite` 在发出续接请求之前就重建了索引并刷新了系统提示词：抓到的请求里，索引从 1 行过期内容变成 7 行。
   - **第 2 轮：** 模型从收到的提示词里 `## <memoryDir>/MEMORY.md` 一节取出每个 `](target)`，解码后执行 `read_file <memoryDir>/<target>`。
   - **base 失败 4 条：**
     - 3 条在第 150 列被截在 `](…` 里面。原因分别是：模型写入的那条笔记标题太长、PR 自带的 markdownlint 笔记标题太长、中文文件名在 base 中每个字被百分号编码成 9 个字符。
     - 1 条 140 字符的文件名在编码前被截到 120 个码点。
   - **head：** 7 条全部打开。
     - 3 行因为链接本身超过 150 而超长（167 / 173 / 175 字符），不带摘要，符合设计。
     - 中文路径保持原样。
     - 含空格和括号的路径仍按百分号编码，两臂都能打开。
   - **与 PR 描述交叉核对：** PR 自带的四条证据笔记也在这组数据里，结果与 PR 描述的改前/改后完全一致（2/4 → 0/4，`can be encoded…` → `can be…`）。
   - **磁盘与提示词：** 各臂提示词里的索引副本都与磁盘上的 `MEMORY.md` 逐字节一致。
3. **端到端 B：超预算记忆库，同一流程。** 预置 199 条笔记，模型再写入 1 条。每 5 条中有 1 条链接超过 150 字符，长、短笔记按 mtime 交错排列，所以前缀截断会同时影响两类。两臂都触发了 25,000 个 UTF-16 代码单元的上限。
   - base 的预算被 34 行目标被截断的条目占满，并丢掉了 28 条常规笔记。
   - head 先保留全部常规笔记，再用剩余空间放入 6 条完整的长链接，其中包括本会话写入的那条。
4. **单元测试。**
   - head 上 `indexer.test.ts` 32/32 通过。
   - **负对照：** 把 PR 的测试文件放到 base 的 `indexer.ts` 上运行，**14 失败 / 18 通过**。失败用例覆盖了目标内截断、路径上限、同组兄弟条目、预算优先级、代理对和不可见字符编码，说明新测试确实钉住了修复，而不只是顺带通过。
   - 整个 `src/memory` 套件在三臂上都是 0 失败。测试数增加的 17 个，正好是 `indexer.test.ts` 从 15 个增加到 32 个。
5. **静态检查。** 三个改动文件的 `eslint --max-warnings 0` 和 `prettier --check` 都干净。PR 的 CI 中 Test (ubuntu)、Lint & Static、Integration (no-AK)、web-shell E2E 均通过。
6. **本机真实记忆库。** 用两臂编译后的 indexer 分别重建 `~/.qwen/memories` 的一份副本（7 条真实笔记，都很短）。
   - 两臂的链接完全相同，0 条损坏。
   - 只有 2 条摘要的结尾不同：head 在词边界截断。
   - 所以这次改动在真实数据上没有回归，但这个库里没有长条目，无法演示修复效果。

### 证据

![真实 TUI A/B：逐条打开索引链接](01-links-e2e-tui-ab.png)

![从模型请求中抓取的索引块](02-index-in-system-prompt-ab.png)

![超预算记忆库 A/B](03-budget-e2e-tui-ab.png)

### 非阻塞说明

- **读取端二次截断（既有行为，属于 #13178）。** 端到端 B 中，写入端的正文加上它自己的 `> WARNING` 行超过了 25,000，所以 `truncateManagedAutoMemoryIndex` 会再截一次，但只截在写入端警告之前的分隔处。两臂磁盘上的 166 条都完整进入了提示词，这通过真实 CLI 证实：生成内容不会落到读取端的行中截断分支。模型看到的是读取端的警告（`MEMORY.md is 24.5 KB (limit: 24.4 KB) … Only part of it was loaded`），写入端的措辞到不了模型。两臂行为相同。
- **之前轮次仍未关闭、本轮未重新测量的项：**
  - 两个变异体存活，即 `MIN_INDEX_HOOK_CHARS` 守卫和预算循环的 first-fit `continue` 没有被测试钉住（见沙箱验证报告）。
  - `docs/design/auto-memory/memory-system.md` 中紧挨本 PR 改写那一行的下一行，仍写着 "25,000 字节"（#13178）。
  - 转交 #13251 的三条建议。

  以上都不是已交付行为的正确性缺陷。

### 未覆盖

- **Windows 和 macOS。** CI 跳过了这两个平台的 Test 任务；macOS 由作者覆盖。
- **启用 git 同步的团队索引。** 作者覆盖了启动时的团队索引重建。
- **真实模型。** 只用了脚本化的模型回合。

驱动脚本、各臂 JSON（每个抓到的请求、提示词里的索引原文、磁盘上的索引、每条链接的解析结果）和日志都在 [`harness/`](harness/) 与 [`data/`](data/)。`tc.mts` 就是 `integration-tests/terminal-capture/terminal-capture.ts`，只加了一个 node-pty 的 ESM 互操作垫片。
