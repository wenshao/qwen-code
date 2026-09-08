# PR #10841 第 5 轮验证报告（`315017a726`）

> 英文版发在 PR 评论：https://github.com/QwenLM/qwen-code/pull/10841
> 前四轮：R1 `941d876d4f`、R2 `708f8f2318`、R3 `5b2cfa0a9e`、R4 `aead7ca511`

## 0. 验证装置

| 臂 | 内容 | bundle 身份判据 |
| --- | --- | --- |
| **PR** | `315017a726`，完整 `npm ci` + `npm run build` + `npm run bundle` | 新文案出现 1 次、旧配对警告 1 次 |
| **round-4 hunk** | 同一棵树，只把 `packages/core/src/config/config.ts` 换回 `aead7ca511`，重新 bundle | 新文案 0 次、旧配对警告 1 次 |
| **M2 变异体** | 同一棵树，删掉 `!lists.hardDisabled.has(name)` 一行，重新 bundle | 新文案 1 次 |
| **base** | `f1ed3bc31a`（本 PR 与 `origin/main` 的 merge-base），独立 worktree 全量构建 | 两者皆 0 次 |

- 夹具：扩展 `rust`（`skillStates:{pdf:false}`，另带 `functions`）、扩展 `python`（`pdf`）、扩展 `go`（`report`，默认关闭）、用户级技能 `pdf`。每个技能正文带唯一 token（`RUST-PDF-BODY-MARKER` 等）。
- 判据不看面板文字，而是**录制式 fake OpenAI 服务器落盘的请求字节**：`<available_skills>` 里出现哪些 token（= 广告了哪些技能）、块外出现哪些 token（= 注入了哪个技能正文）。
- 真实 TUI 由 pty（`@lydell/node-pty` + xterm.js + Playwright）驱动并截图；headless（`-p`）把启动警告写到 stderr，逐字比对。
- 22 个配置形态 × 4 个臂，另加 6 个变异体。

## 1. N-4 已闭合 —— 新增测试是真见证

对 `packages/core/src/config/config.test.ts`（645 条）做变异：

| 变异体 | 改动 | 结果 |
| --- | --- | --- |
| M1 | `Config.initialize()` 里把 `defaultOffNames.add(skill.name…)` 改回 `authoredSkillName(skill)`（即第 4 轮的未见证状态） | **1 条红** —— 正是新增的 `surfaces the default-off pair warning named by registry identity` |
| M2 | 去掉 `!lists.hardDisabled.has(name)` | **645 全绿（存活）** |
| M3 | 去掉 `!lists.hardDisabled.has(authored)` | 1 条红 |
| M4 | `onNames = offNames` | 5 条红 |
| M5 | `stillOff = offNames` | 2 条红 |
| M6 | 去掉 `lists.enabled.has(name)` | 4 条红 |

第 4 轮 N-4 的核心是"调用方那一半没有见证"，M1 现在被精确杀死，闭合成立。

## 2. N-5 已闭合 —— 同树单文件 A/B

配置：`skills.enabled:["pdf","rust:pdf"] + skills.defaultDisabled:["pdf"]`，`rust` 声明 `pdf` 默认关闭。

| 臂 | 启动警告 | 同一次启动的面板 | 请求字节里的 rust:pdf |
| --- | --- | --- | --- |
| round-4 hunk | "…no longer enables the extension skill 'rust:pdf', **which defaults off**" | `rust:pdf` `[x]` | 已广告 |
| **PR** | "…but the qualified grant 'rust:pdf' in skills.enabled **already enables it**, so the bare pair changes nothing." | `rust:pdf` `[x]` | 已广告 |

三个可达触发器全部复现：用户级配对 + 用户级限定授权（C）、workspace 限定授权 + 用户级裸配对（I）、单一属主扩展（O，`go:report`）。

## 3. 混合形态的拆分是正确的

`rust` 与 `python` 都声明 `pdf` 默认关闭，只授权 `rust:pdf`：

- round-4 hunk：一句话把两个都说成"默认关闭、未被启用"（`'python:pdf', 'rust:pdf', which default off`），而 `rust:pdf` 当时是开的。
- PR：两条独立警告 —— `python:pdf` 仍默认关闭；`rust:pdf` 已被限定授权启用。同一次启动的面板一致：`python:pdf [ ]`、`rust:pdf [x]`。

## 4. 新发现（非阻断）

### N-7 —— 默认关闭配对警告从不查 `skills.disabled`

`enabled:["pdf"] + defaultDisabled:["pdf"] + disabled:["pdf"]`：唯一那条警告说 *"Replace the bare 'pdf' with 'rust:pdf' in both … **to enable it**."*，而同一次启动的对话框已经把两个 pdf 技能放进锁定区 `[locked: User]`。

逐字照做的收敛过程：

| 启动 | 设置 | rust:pdf | 警告 |
| --- | --- | --- | --- |
| 1 | `enabled:[pdf] defaultDisabled:[pdf] disabled:[pdf]` | 关闭 | 配对警告，承诺"to enable it" |
| 2 | 按建议替换为 `rust:pdf` | **仍关闭** | 这时才点名 `skills.disabled` 里的 `'pdf'` |
| 3 | 删掉 `disabled:[pdf]` | 启用 | 无 |

同一个函数的**非配对分支**已经有这段 `hardNote`（"…remove that entry too."），配对分支没有。

更尖锐的形态：硬条目写的是**限定名**（`disabled:["python:pdf"]`）时，`bareDisablementBlocksQualifiedGrantWarnings` 只对**裸**条目触发，于是照做之后**一条警告都不打印** —— 静默死路。

一行修复：把已有的 `hardNote` 追加到 `stillOff` 那条警告上。

### N-8 —— 存活变异体 M2：限定硬条目那道守卫没有测试

`onNames` 过滤里的 `!lists.hardDisabled.has(name)` 是承重件，但删掉它 645 条全绿。用删掉该行重新打包的真实 CLI 跑 `enabled:["pdf","rust:pdf"] + defaultDisabled:["pdf"] + disabled:["rust:pdf"]`：警告变成"the qualified grant 'rust:pdf' … already enables it"，而同一次启动的面板显示 `rust:pdf [locked: User]`，请求字节里也没有它 —— 正好是刚修好的 N-5 缺陷再次出现。

现有的 `keeps the off-state claim when a hard entry defeats the qualified grant` 用例只覆盖**裸**硬条目（走 `!lists.hardDisabled.has(authored)` 那道守卫）。补一条限定硬条目的断言即可。

### 文案小瑕疵

多个成员同时被限定授权时是 *"the qualified **grant** 'python:pdf', 'rust:pdf' … already **enable** them"*，`grant` 应为复数。

## 5. 沿用的两条（未变）

- **N-3**：存在同名用户级技能时 `if (registry.has(authored)) continue;` 吞掉整组 —— `defaultDisabled:["pdf"] + enabled:["pdf"]` 下确实默认关闭的 `rust:pdf` 静默保持关闭且零提示。作者已说明延后。
- **N-6**：裸条目落在 system settings 时建议无法执行。两次启动逐字照做，警告与状态完全不变；而同一次启动的对话框已经算出了作用域 `[locked: skills.defaultDisabled 'pdf' (System)]`。

## 6. 回归清单（新 head）

| 项 | base `f1ed3bc31a` | PR `315017a726` |
| --- | --- | --- |
| `/skills` 面板（用户 `pdf` + 两个扩展 `pdf`） | 16 个技能，**1 行** `pdf` | 18 个技能，**3 行**，各带属主 |
| `<available_skills>` 与 `/pdf` 注入体 | 广告**用户**的 pdf，注入 **python** 的正文 | 两者都广告，`/pdf` 注入它广告的那个 |
| ACP `session/update` 可用命令 | 51 条，技能行 `functions, pdf` | 52 条，技能行 `python:pdf, rust:functions, rust:pdf` |
| `@ext:rust` 广告 | `Skills: functions, pdf` | `Skills: rust:functions, rust:pdf` |
| `--disabled-slash-commands pdf` | — | 同时挡住 `rust:pdf` 与 `python:pdf` |
| `--disabled-slash-commands rust:pdf` | — | 只挡 `rust:pdf`，`python:pdf` 仍可运行 |
| `--help` 双拼写说明 | 无 | 有 |
| 9 个 locale 的锁定区标题键 | — | 9/9 新键，0 残留旧键 |
| `/rust:pdf`、`/python:pdf`、`/rust:functions` 路由 | — | 各注入且只注入自己的正文 |

## 7. 门禁

- `npm -w packages/core run typecheck`、`npm -w packages/cli run typecheck`：均退出码 0。
- core `src/skills src/config src/tools/skill.test.ts`：32 个文件、**1408/1408** 通过（第 4 轮那条 `skill-curator` 抖动这次未出现）。
- 本 PR 触及的 18 个 cli 套件：**2202/2202** 通过。
- GitHub CI：`web-shell E2E Smoke` 红。归因：该用例文件 `packages/web-shell/client/e2e/web-shell.history-viewport.spec.ts` 由 main 的 #11208（`a4a62258b1`）引入；本 head 上 `packages/web-shell` 与 `origin/main` **逐字节相同**，且 PR head 与 `origin/main` 的全部差异恰好是本 PR 自己的 63 个文件（外加落后 main 一个无关提交 #11315）。失败与本 PR 无关。

## 8. 结论

**可合并。** N-4、N-5 都真的闭合了，且新逻辑在真实链路上与面板、与请求字节三方一致。N-7 / N-8 / N-3 / N-6 都不改变任何技能最终的可达状态，可作为后续。若只做一条，建议 **N-8**：一条断言，且它守的正是刚修好的那个缺陷类。

唯一阻断仍是 `e7223d6f5f`（2026-09-05 09:19）那条机器人 `CHANGES_REQUESTED`，它已落后 9 个提交，早于第 3–5 轮验证过的全部修复。
