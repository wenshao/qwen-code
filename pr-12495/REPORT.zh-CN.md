## 维护者验证 — PR #12495 @ `113636f`

**结论：可以合入。** 没有发现缺陷。生产代码只删了 2 行，行为与 PR 描述完全一致：`--quiet`、`--silent` 现在和 `-n` 的判定相同。凡是真实 GNU sed 会当作写操作的命令，都不会因此被自动批准。下面列了两个可选的后续项，都不阻塞合入。

### 做了什么

所有检查都在两个 arm 上对比，两者只差这个 PR：

- **head**：`113636f`，即 PR 当前提交。
- **base**：合并基点 `99bf4ce`。做法是在 head 的工作区里把 `shell-safety-rules.ts` 和两个测试文件换回 base 版本。

两个 arm 都构建了真实的 CLI bundle，并在 bundle 里 grep 确认换版生效：被删掉的 guard 正则 `/^--(?!line-length(?:=|$))/` 出现在 base 的 `dist/chunks/*.js` 中，head 里没有。

#### 1. 真实 TUI 端到端

环境：
- 两个 arm 各自的真实 `dist/cli.js`，跑在 node-pty + xterm.js 里。
- 一个脚本化的假 OpenAI 模型，只发出一次 `run_shell_command` 调用。
- 隔离的临时 `HOME`。
- 项目目录里只有一个 `notes.txt`。

| 场景 | 模式 | 命令 | base | head |
|---|---|---|---|---|
| A（对照） | default | `sed -n 's/alpha/ALPHA/p' notes.txt` | 直接执行 → `ALPHA` | 直接执行 → `ALPHA` |
| B | default | `sed --quiet 's/alpha/ALPHA/p' notes.txt` | **弹出确认** | 直接执行 → `ALPHA` |
| C | default | `sed --silent 's/alpha/ALPHA/p' notes.txt` | **弹出确认** | 直接执行 → `ALPHA` |
| D | default | `sed --quiet 'w leaked.txt' notes.txt` | 弹出确认 | 仍然弹出确认 |
| E | plan | `sed --quiet 's/alpha/ALPHA/p' notes.txt` | 弹出确认（"could not determine…"） | 直接执行 → `ALPHA` |
| F | plan | `sed --quiet 'w leaked.txt' notes.txt` | 可批准的确认框 | **直接拦截**："classified as state-modifying" |

每个场景里，模型收到的 `tool` 结果都与上表一致。`leaked.txt` 始终没有被创建，`notes.txt` 始终未被修改。

除了去掉多余的确认框，场景 F 是唯一的用户可见变化：plan 模式下，带 `--quiet` 的写脚本以前会弹出一次性可批准的确认框，现在直接被拒绝。这是更严格、也更正确的方向，对应 /review R1-1 指出的 `unknown → write`，这次在真实 UI 中得到了确认。

![default 模式](fig1-default-mode.png)
![plan 模式](fig2-plan-mode.png)
![写脚本仍需确认](fig3-write-still-prompts.png)

#### 2. 双 arm 差分 fuzz + 真实 GNU sed 4.9 真值

共 11,921 个去重后的参数向量，由选项×脚本的穷举网格加上带种子的随机组合构成。每个向量都分别用两个 arm 的 `classifySedCommandSafety` 判定。其中任一 arm 判为 `read-only`、或两边判定不同的向量共 1,212 个，对它们在全新目录里执行真实 `sed`，并比较执行前后所有文件的哈希。

| 判定迁移 | 数量 |
|---|---|
| `read-only → read-only` | 681 |
| `write → write` | 2230 |
| `unknown → unknown` | 8479 |
| `unknown → read-only` | 337 |
| `unknown → write` | 194 |

- **所有判定变化的向量都含字面的 `--quiet` 或 `--silent`。** 其他选项的判定都没有变。
- **两个 arm 都没有出现"判为 `read-only`、但真实 sed 创建或修改了文件"的向量：base 0 个，head 0 个。** 覆盖的写法包括 `e` 命令、`s///e`、`w`/`W`、`{}` 内的 `w`，以及换行分隔的多条脚本。
- 194 个 `unknown → write` 向量中，真实 sed 确实写了文件的有 183 个。其余 11 个里，9 个是 `w /dev/stdout`（分类器保守地判为写），2 个是 sed 在写之前就因参数错误退出了。`write` 本来就不会被自动批准，所以这只是判定更严格了。
- 23 个不写文件的脚本上，真实 sed 的 `--quiet`、`--silent` 输出都与 `-n` 逐字节一致，证实了白名单依赖的别名关系成立。
- 下列写法在两个 arm 上都仍是 `unknown`，属于保守结果：GNU 缩写 `--qui`、`--sil`，`--quiet=x`（真实 sed 会拒绝），`--QUIET`，`---quiet`，以及 `--quiet` 与 `--posix`、`--sandbox`、`--debug` 的组合。

#### 3. 单测、负对照与门禁

- **单测**：head 上 `shellReadOnlyChecker` + `shellAstParser` → **787/787**。
- **负对照**：PR 的新测试跑在 base 的 `shell-safety-rules.ts` 上 → **5 失败 / 782 通过**。失败的正好是新增的几条：3 条 `--quiet`/`--silent` 只读断言，以及 2 条 `'w out' = write` 断言。
- **lint 与类型**：3 个文件的 `eslint --max-warnings 0` → 0；`prettier --check` → 通过；`packages/core` 的 `tsc --noEmit` → 0。
- **`packages/core` 全量**：29,898 通过，3 失败。这 3 个在 base 上以同样方式失败，是以 root 身份运行造成的：`skill-curator` rename、`session-writer-lease` 不可读锁、`git-branches` 的 index 锁。
- **CI**：撰写本文时，`113636f` 上的 `Test (ubuntu-latest)` 和 `Lint & Static` 仍在 pending。

![证据汇总](fig4-evidence.png)

#### 4. 变异测试

对 `shell-safety-rules.ts` 做了 7 个变异，用 PR 的测试去跑。被杀死 4 个：只对 `--silent` 恢复 guard、把 `SAFE_SED_OPTION` 放宽到任意 `--[a-z-]+`、从白名单里去掉 `--silent`、去掉残余参数扫描。

存活 3 个，但都不可能产生错误的 `read-only`：
- **M3** 把 `--quiet` 加进 `SED_VALUE_OPTIONS`；**M7** 让 in-place 循环跳过 `--q*`/`--s*` 后面的参数。两者都会让 `sed --quiet -i 's/a/b/' file` 从 `write` 降为 `unknown`。这是 fail-closed，但会把 plan 模式下的直接拦截悄悄变成可批准的确认框，也就是 /review 第 4 轮延后记录的那个缺口。
- **M6** 接受 `--quiet=x`。真实 sed 会直接拒绝这个选项（"doesn't allow an argument"），所以该变异无害。

### 可选后续（不阻塞）

1. **在 tri-state 的 write 表里再加两行**，就能杀死 M3 和 M7。加上后共 789 个测试，这两个变异各失败 2 个。补丁在 `harness/suggested-test.patch`，在 head 上 `git apply --check` 可以通过：
   ```diff
        "sed --silent 'w out' file",
   +    "sed --quiet -i 's/a/b/' file",
   +    "sed --silent --in-place 's/a/b/' file",
   ```
2. **一个 PR 之前就存在、不在本 PR 范围内的问题**：单独写 `-e SCRIPT FILE` 的形式在两个 arm 上都仍会弹确认。`sed -e 's/a/b/' file`、`sed -n -e 's/a/b/p' file`、`sed --quiet -e … file` 端到端都判为 `unknown`，`sed --expression='s/a/b/' file` 也一样。在 `classifySedCommandSafety` 这一层，`['-e','s/a/b/','file']` 是 `unknown`，`['-e','s/a/b/']` 是 `read-only`。

   原因：残余参数扫描会把剩下的参数拼起来，其中包括 `-e` 这个 token 本身，拼出的 `-e file` 命中了 `/(?:^|[^\\])[ewr]\s/`。建议另开 issue 处理。探针输出见 `data/e-probe.txt`。

复现脚本在 `harness/`（`fuzz.mjs`、`e2e.mts`、合成脚本），原始数据在 `data/`（fuzz 报告、E2E 结果、各场景屏幕文本）。
