# PR #10841 本地真实环境验证报告 · 第 2 轮（增量）

- 验证提交：`708f8f2318`（PR head）
- 对照基线：`c39e83e01c`（`origin/main`，本 PR 的 merge-base）
- 第 1 轮见 PR 评论（验证于 `941d876d4f`）
- 平台：Linux 6.12.63 / Node 22 / `npm ci` + `npm run bundle` 双臂真实构建
- 结论：**可以合并**

## 0. 本轮范围

第 1 轮之后新增 3 个功能提交：

| 提交 | 内容 | 对应第 1 轮记录 |
| --- | --- | --- |
| `a63ba7f118` | entry-scoped grant warnings + authored-name resume restore | 残留 2、第 3 轮延后项 |
| `443320cd23` | lock label 按真实合并优先级取最高作用域 | R3-3（第 1 轮唯一的合并前建议） |
| `708f8f2318` | 修正 R3-3 见证用例的断言 | — |

本轮只验证增量，并对第 1 轮仍开放的残留在新 head 上逐条复核。

## 1. R3-3 已修复（含判别性见证）

装置：可信 workspace，System 与 Workspace 同时写 `skills.defaultDisabled: ["pdf"]`。

- 真实 TUI `/skills`：锁定行读作 `[locked: skills.defaultDisabled 'pdf' (Syst…]`。
- 精确字符串由探针给出（真实 settings 文件 → 真实 `loadSettings` → 真实 `buildHigherDisabled`）：
  `lockedIn(rust:pdf) = "skills.defaultDisabled 'pdf' (System)"`。
- 第 1 轮同装置下这里给的是 `(Workspace)`：用户按标签删掉 workspace 条目后技能仍然锁定，被点名的恰是改了也没用的那个文件。

负对照（证明见证用例真的钉住了这次修复）：把 4 行顺序改回修复前，`SkillsManagerDialog.test.tsx` 出现**且仅出现**新增用例 1 条失败（1 failed | 20 passed），恢复后 21/21 全绿。第 1 轮记录的“当前顺序完全没有被测试固定”已经不成立。

## 2. 残留 2（resume 按注册身份建索引）已修复

真实升级路径，不是构造的历史记录：

1. 在 `origin/main` 构建上跑一个会话，模型调用 `skill('functions')`（升级前的裸名），技能正文注入，会话落盘。
2. 用 PR 构建 `--resume` 同一个 session id，再调用 `rust:functions`：**首次**调用即返回
   `Skill "rust:functions" is already loaded in context.` —— 没有重复注入。
3. 负对照：同一构建、同一会话，把 bundle 里 authored-name 回退循环禁用，同样的首次调用重新注入了完整正文，第二次才提示 already loaded。

歧义性检查：两个扩展共享同一 authored 名且没有本地同名技能时，回退把裸名映射到缓存中先出现的那一个；但 restore 同时逐字节比对记录的 output，因此映射错了只会**失配**（退化为重新注入），不会把错误的技能标记为已加载。实测：resume 一个升级前的 `pdf` 记录，`python:pdf`（当时真正加载的那个）被正确恢复，`rust:pdf` **没有**被误标记，首次调用仍然注入自己的正文。

## 3. 新的 entry-scoped 警告与 default-off 警告

- 一条裸 `skills.enabled: ["pdf"]` + 两个冲突的扩展技能 → **一条**警告同时点名 `'python:pdf'`、`'rust:pdf'`。第 1 轮是两条、各点一个，照其中一条改会让另一条静默。
- 再加 `skills.disabled: ["pdf"]` → 警告追加硬阻断说明（“替换授权本身不会启用任何东西，那条也要删”）。
- default-off 分支用真实默认关闭的扩展技能验证：新增第三个扩展，清单声明 `skillStates: { "report": false }`。
  - `enabled: ["report"] + defaultDisabled: ["report"]` → 新警告出现，指出这一对取消了禁用但不再启用 `'go:report'`，因为它默认关闭。
  - 照建议改成 `enabled: ["go:report"]` → 出现第二条警告（裸 `report` 仍在 `defaultDisabled` 中阻断）。
  - 再按第二条改成两侧都写 `go:report` → 无警告，`go:report` 在面板中为启用态。

迁移建议链条会终止，每一步都诚实。

## 4. 本轮新发现（非阻断）：硬阻断的“连带影响”建议存在自指循环

位置：`packages/core/src/config/config.ts` 的 `bareDisablementBlocksQualifiedGrantWarnings`。

装置：`skills.disabled: ["pdf"]` + `skills.enabled: ["rust:pdf"]`，同时存在一个**非扩展**的同名技能 `pdf`（用户级）。

新增的连带影响句会把 `'pdf'` 自己算进兄弟清单：

> Remove 'pdf' from skills.disabled to enable the skill. The removal also re-enables 'pdf', 'python:pdf'; add 'pdf', 'python:pdf' to skills.disabled to keep them blocked.

逐字照做（`skills.disabled: ["pdf","python:pdf"]`）之后：`rust:pdf` 依然锁定，并且**重新打印完全相同的一条警告**——用户落在不动点上。根因是被建议“加回去”的 `'pdf'` 正是按双拼写匹配阻断 `rust:pdf` 的那条裸条目；而该建议承诺的状态在当前语义下不可表达：没有任何 `skills.disabled` 写法能只挡住本地 `pdf` 而放行 `rust:pdf`。

建议：把“注册身份等于裸名”的兄弟从“加回去”那半句里剔除（它们没有限定拼写），或直接说明本地同名技能无法单独重新阻断。属建议级——是建议质量问题，不是能力缺陷。

## 5. 门禁（新 head）

- `npm -w packages/core run typecheck`、`npm -w packages/cli run typecheck`：退出码 0。
- core：`src/skills src/config/config.test.ts src/tools/skill.test.ts` → 1199 通过、1 失败。失败项为 `skill-curator.test.ts > reports skippedErrors when rename fails transiently`，在 `origin/main` 上当天复跑同样失败（36 passed | 1 failed）——以 root 运行使其基于权限的故障注入失效，与本 PR 无关。
- cli：本 PR 触及的 16 个套件 → 724/724 通过。
- CI：该 head 无失败检查；唯一的阻塞来自第 3 轮那条已过期的 `CHANGES_REQUESTED` bot review。

## 6. 关于“workspace 的 skills.enabled 取消 system 的 skills.defaultDisabled”的裁定

**维持现状，本 PR 不做改动。**

- 该行为是既有行为：在 merge-base `origin/main` 上，用一个与扩展无关的普通用户技能实测，workspace 的 `skills.enabled: ["pdf"]` 同样取消 system 作用域的 `skills.defaultDisabled: ["pdf"]`。本 PR 未触及 `resolveSkillSettings`，`skill-settings.ts` 的改动只是新增两个查找辅助函数。
- `docs/users/configuration/settings.md` 在 merge-base 上就逐字写着这条语义：“a user can put a skill in `defaultDisabled` and a project can add the same name to `enabled`”。
- deny-by-default 并未因此失效，因为 `defaultDisabled` 本来就不是拒绝原语：
  - `skills.disabled` 才是。实测 System 写 `skills.disabled: ["rust:pdf"]` 且 workspace 写 `skills.enabled: ["rust:pdf"]` 时，`rust:pdf` 仍然 `[locked: System]`——任何作用域的 `enabled` 都取消不了硬条目。
  - 各作用域的列表是并集而非覆盖（System `disabled:["rust:pdf"]` + Workspace `disabled:["python:pdf"]` 合并为两者），仓库文件无法删除管理员的条目，只能追加。
  - workspace settings 只有在文件夹被信任时才参与合并。
- 如果确实需要“默认关闭且仓库不得自行 opt-in”，那是另一个特性；仓库里已有现成形状：`packages/cli/src/config/settingsUtils.ts` 的 `WORKSPACE_NON_OVERRIDING_SETTINGS` / `WORKSPACE_TIGHTEN_ONLY_SETTINGS` 同时驱动合并期剥离与相应告警。把 `skills.enabled` 加进去即可，但那是针对 main 的独立改动，不应塞进本 PR。

## 7. 仍开放的残留（非阻断，均已在第 1 轮记录）

1. 所有者标签未做单行化。新 head 上复核仍然成立：清单 `displayName` 含换行会在 Skills 面板注入一整行伪造内容。作者已明确延后，同意作为后续。
2. （已关闭，见第 2 节。）
3. 同名本地技能仍会吞掉迁移警告（`if (registry.has(authored)) continue;`）。当天实测：存在用户级 `pdf` 时，`skills.enabled: ["pdf"]` 完全不给任何提示。
4. CJK 所有者名按 UTF-16 计宽导致截断偏早，纯观感，未变。

## 8. 结论

**可以合并。** R3-3 已修复且带判别性见证；残留 2 已修复且有真实升级路径与负对照；新增的三类警告在真实链路上成立且建议链条终止；仅新增一条建议级的自指循环问题，与其余三条残留一样不阻断合并。
