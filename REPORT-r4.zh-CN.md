# PR #10841 第 4 轮验证（增量）— `aead7ca511`

> 前三轮：`941d876d4f`（第 1 轮，阻断 1 项）、`708f8f2318`（第 2 轮，可合并）、`5b2cfa0a9e`（第 3 轮，新增 N-1/N-2）。
> 本轮只覆盖自 `5b2cfa0a9e` 起的增量：一个修复提交 `c076a18752`（"default-off pair warning names only true default-offs"）与三次 main 合并（`fc0bf77b9a`、`b4aec83d2a`、`aead7ca511`）。

## 环境

- PR 臂 `/root/git/x6-v10841` = `aead7ca5118833f01d456675abc42b2cd7a4f6d3`
- 基线臂 `/root/git/x6-v10841-base` = `50b33052cd`（本 PR 与 `origin/main` 的 merge-base）
- 两臂均真实构建（core → acp-bridge → git-commit-info → web-shell → web-templates → channel-base → sdk → channels/\* → `node esbuild.config.js`），通过 `node <arm>/dist/cli.js` 驱动真实 TUI
- 隔离 `HOME=/root/git/h10841/home`；夹具：扩展 `rust`（`displayName: "Rust Tools"`，`skillStates: {"pdf": false}` → 默认关闭）、扩展 `python`（`pdf`，默认开启）、扩展 `go`（`report`，默认关闭）、用户级 `~/.qwen/skills/pdf`
- 录制型 OpenAI mock 落盘每一次请求体，用于按字节判定注入了哪个技能正文

## 第 3 轮两条发现均已修复

### N-1 — 只点名真正默认关闭的成员

`defaultOffNames` 改为按注册名收集，`offNames` 从组内按注册名过滤。实测（`skills.defaultDisabled:["pdf"] + skills.enabled:["pdf"]`）：

- 警告只点名 `'rust:pdf'`（真正默认关闭），不再把默认开启的 `python:pdf` 一起描述为默认关闭
- 同一次启动的面板：`python:pdf` `[x]`、`rust:pdf` `[ ]`，与警告文本一致

### N-2 — 照做即收敛

文案改为「Replace the bare 'X' with 'Y' in both skills.enabled and skills.defaultDisabled」。逐字照做后一次启动即收敛：

| 配置 | `go:report` | 警告 |
| --- | --- | --- |
| `defaultDisabled:["report"] + enabled:["report"]` | 关闭 | 默认关闭配对警告 |
| **按建议替换** → `defaultDisabled:["go:report"] + enabled:["go:report"]` | **启用** | **无** |
| 追加而非替换 → `defaultDisabled:["report"] + enabled:["report","go:report"]` | 启用 | 仍每次打印 |

多属主夹具同样一步收敛：`defaultDisabled:["rust:pdf"] + enabled:["rust:pdf"]` → `rust:pdf` `[x]`、`python:pdf` `[x]`、零警告。

第三行（追加而非替换）仍会重复打印，但新文案不再引导用户走这条路。

## 三条非阻断发现

### N-4 — 修复的调用方一半没有测试见证

把 `Config.initialize()` 里 `defaultOffNames.add(skill.name…)` 改回 `authoredSkillName(skill)`（即第 3 轮的行为）后：

- `packages/core/src/config/config.test.ts` **641/641 全绿**
- 但重新构建 bundle 后，真实路径下警告**完全消失**，`rust:pdf` 静默保持关闭——正是该警告存在的目的所在

纯函数侧的见证是真的（见下表），缺的是把注册名喂进去的那一行。

| 变异 | 结果 |
| --- | --- |
| `offNames = registryNames`（去掉默认关闭过滤） | 641 中 2 条变红 |
| 调用方按 authored 名收集（N-4） | **641 全绿** |
| 回退到第 3 轮文案 | 641 中 3 条变红 |

### N-5 — 已被限定授权启用的技能仍被描述为「默认关闭 / 未被启用」

workspace `skills.enabled:["rust:pdf"]` + user 裸配对 `defaultDisabled:["pdf"] + enabled:["pdf"]`：

- 面板：`rust:pdf` `[x]`（限定授权生效）
- 启动警告仍称 `'rust:pdf'`「defaults off」且「no longer enables」它

作者新增的 `keeps the replacement advice while a qualified grant coexists with the bare pair` 用例正是钉住这一形态，说明保留「清理裸条目」的建议是有意为之——但句子对当前状态的断言是错的。建议拆开：保留清理建议，去掉「默认关闭 / 未启用」的断言。

### N-6 — 裸条目落在用户改不动的作用域时，建议无法执行

System `skills.defaultDisabled:["pdf"]` + user `skills.enabled:["rust:pdf"]`：

- 警告：「Write 'rust:pdf' in both lists, or remove 'pdf'.」
- 用户在自己的 settings 里照做（两个列表都写 `rust:pdf`）→ **状态不变，同一条警告照旧**，因为裸 `'pdf'` 在 System 里，用户既删不掉也覆盖不了
- 面板本身是对的：`[locked: skills.defaultDisabled 'pdf' (System)]` 已经点名了真正的阻止者

作用域信息在对话框里已经有了，警告没用上。属既有 `bareDisablementBlocksQualifiedGrantWarnings` 的措辞问题，非本次新增代码。

### N-3（沿用）— 同名本地技能仍吞掉整组诊断

`if (registry.has(authored)) continue;` 依旧。存在用户级 `pdf` 时，`defaultDisabled:["pdf"] + enabled:["pdf"]` 下 `rust:pdf` 静默保持关闭、零警告。作者已说明延后。

## 新 head 回归清单 — 全部通过

main 在本轮期间改动了 16 个本 PR 也改动的文件（`SkillCommandLoader.ts`、`skill.ts`、`acpAgent.ts`、`Session.ts`、三个 locale、`settingsSchema.ts` 等），因此整套矩阵重跑：

- **面板 `/pdf`**：PR 三行（`pdf [User]`、`rust:pdf [Extension: Rust Tools]`、`python:pdf [Extension: python]`）；`origin/main` 只有一行 `pdf [Extension]`——用户自己的 `pdf` 与另一个扩展的 `pdf` 都被吞掉
- **对话框**：PR 5 行、各带属主；`origin/main` 3 行，两个扩展 `pdf` 合并成一行且只写 `(Extension)`
- **路由按字节判定**：`/rust:pdf` → 仅 rust 正文（5 次命中，python 0、user 0）；`/python:pdf` → 仅 python；`/pdf` → 仅用户技能
- **裸 `skills.disabled:["pdf"]`**：三个 pdf 技能全部进入锁定区，`[locked: User]`
- **`--disabled-slash-commands`**：`pdf` 隐藏三个，`rust:pdf` 只隐藏一个；`--help` 文案说明双拼写规则（基线臂没有该说明）
- **`@ext:rust`**：线上广告 `Skills: rust:functions, rust:pdf (invoke via /<skill-name>)`
- **锁定标签作用域（第 3 轮 R3-3）**：System+User 同时持有 → `[locked: System]`；仅 User → `[locked: User]`，无矫枉过正
- **i18n**：9 个 locale 全部含改写后的锁定区标题键，无残留旧键
- **resume authored 名回退**：`packages/core/src/tools/skill.ts` 中回退分支在三次 main 合并后依旧存在

## 门禁

| 项 | 结果 |
| --- | --- |
| `npm -w packages/core run typecheck` | exit 0 |
| `npm -w packages/cli run typecheck` | exit 0 |
| core `src/skills src/config src/tools/skill.test.ts` | 1400 passed / 1 failed |
| 上述唯一失败 `skill-curator … rename fails transiently` | 基线臂同样失败（36 passed / 1 failed）→ 环境所致（以 root 运行使基于权限的故障注入失效） |
| 本 PR 触及的 18 个 cli 套件 | 2202 / 2202 passed |
| GitHub CI（`aead7ca511`） | 全绿，无失败检查 |

## 结论

**可合并。** 唯一阻断是 `e7223d6f5f`（2026-09-05T09:19）上那条机器人 `CHANGES_REQUESTED` 评审，它早于此后的 7 个提交，其中包括本轮验证的修复。

N-4 / N-5 / N-6 / N-3 均为非阻断：没有一条改变任何技能最终的可达状态。四条里我最建议顺手做掉 N-4——它是一行改动（把调用方那次收集也钉住），代价最低而回归风险最实在。
