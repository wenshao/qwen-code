# PR #10841 复验报告（`941d876d4f` → `5b2cfa0a9e`）

- 复验提交：`5b2cfa0a9e`；上一轮验证：`941d876d4f`
- 作者在此期间推了 4 个提交，`a63ba7f118` / `443320cd23` / `708f8f2318` / `5b2cfa0a9e`，正好对应我上一轮报告里的 R3-3 与两条残留
- 结论：**上一轮提出的问题全部修复且经真实环境复核；新逻辑本身带来 2 条新的建议级问题**

---

## 1. 上一轮问题的处理情况

| 上轮结论 | 提交 | 复验结果 |
| --- | --- | --- |
| R3-3 锁定标签作用域反转（建议合并前修） | `443320cd23` + `708f8f2318` | ✅ 已修 |
| 残留 2：resume 恢复无 `authoredName` 回退 | `a63ba7f118` | ✅ 已修 |
| 残留 3(a)：同一裸条目对每个技能各发一条警告，改其一即静默其余 | `a63ba7f118` | ✅ 已改为按条目分组 |
| 残留：`Replace it with X` 未提示同时存在的 hard 阻止 | `a63ba7f118` | ✅ 新增 hardNote |
| 残留：hard 解除建议未说明会顺带放开兄弟技能 | `a63ba7f118` + `5b2cfa0a9e` | ✅ 已补，且拒绝给出会自我循环的建议 |
| 残留 1：所有者标签未做换行清理 | — | 未处理（仍为非阻断） |
| 残留 4：CJK 徽章按 UTF-16 计宽 | — | 未处理（仍为观感） |

### R3-3

`SkillsManagerDialog.tsx` 的作用域循环已改为真实合并优先级 SystemDefaults < User < Workspace < System。实测双向正确：

- System 与 Workspace 同时持有 `skills.defaultDisabled: ["pdf"]` → 标签给出 `(System)`，即真正需要编辑的那个文件；
- 仅 Workspace 持有 → 标签仍给出 `(Workspace)`，没有矫枉过正。

变异探针：把顺序改回修复前，新用例 `names System over Workspace when both hold the same defaultDisabled entry` 单独变红（20 passed / 1 failed），其余全绿——是真见证。

### resume 恢复

`restoreLoadedSkillsFromHistory` 增加了 authored 名回退，且以 `!skillByName.has(authored)` 保证同名本地技能优先。移除该回退后新用例 `restores loaded Skill state requested under a pre-rename authored name` 单独变红（107 passed / 1 failed）。

顺带查了一个我担心的点：两个扩展同 authored 名时回退只会绑定其中一个。但恢复分支还有一道 `output === skill.output` 的相等判定，绑错时直接 `continue`，退化为修复前行为，不会把没加载过的技能误标为已加载。**属于 fail-safe，不构成问题。**

### 三条新警告子句的见证

分别注入三个变异体（去掉 hardNote / 去掉 default-off 分支 / 去掉 notAlone 从句），core config 套件恰好三条对应用例变红（636 passed / 3 failed），全部是真见证。

## 2. 新警告的端到端行为

按建议逐字操作，检查是否真的到达目标状态：

- **分组的失效授权警告**：`enabled:["pdf"]` → 一条警告同时点名 `'python:pdf', 'rust:pdf'`。
- **hardNote**：`enabled:["pdf"] + disabled:["pdf"]` → 追加“裸 `pdf` 在 skills.disabled 里也会挡住它们，只换授权不会启用任何东西：那条也要删”。
- **hard 解除的副作用说明**：`enabled:["rust:pdf"] + disabled:["pdf"]` → “删除也会重新启用 `'python:pdf'`。把 `'python:pdf'` 加进 skills.disabled 以继续阻止它。” 照做后实测：无警告、`rust:pdf` 可用、`python:pdf` 被挡。**一步收敛。**
- **不动点情形**：存在用户级 `pdf` 时，追加“`'pdf'` 在 `'rust:pdf'` 保持启用的情况下无法单独阻止，因为任何匹配 `'pdf'` 的条目也匹配 `'rust:pdf'`”。该论断可证且实测成立：写 `disabled:["pdf","python:pdf"]` 会把 `rust:pdf` 一起挡掉。**建议正确地拒绝了会循环的写法。**

## 3. 新发现（建议级，均为本次新增逻辑引入）

### N-1：default-off 警告把同 authored 名的兄弟技能一并说成“默认关闭”

`bareEnabledGrantWarnings` 按 authored 名分组，而 `defaultOffAuthored` 也以 authored 名为键，因此组内只要有一个技能默认关闭，警告就把**整组**都描述为默认关闭。

实测（`rust` 清单声明 `skillStates: {"pdf": false}`，`python` 未声明；配置 `defaultDisabled:["pdf"] + enabled:["pdf"]`）：

```
Warning: skills.enabled and skills.defaultDisabled both list 'pdf' by bare name. The pair cancels
the disablement but no longer enables the extension skills 'python:pdf', 'rust:pdf', which default
off. Write the registered name in skills.enabled to enable them.
```

同一时刻 `/pdf` 只列出 `python:pdf` —— 它是**启用的**，且并不默认关闭。用户若照建议把裸条目替换成两个限定名，`python:pdf` 反而会被 `defaultDisabled:['pdf']` 挡掉（实测确认），下一次启动才由另一条警告把人引回来。

建议：`defaultOffAuthored` 改为按注册名收集，警告只点名该组中真正默认关闭的成员。

### N-2：照建议修好之后，警告仍每次启动重复

用单一属主的夹具隔离（扩展 `go` 独占 `report` 并声明其默认关闭）：

| 配置 | `go:report` | 警告 |
| --- | --- | --- |
| `defaultDisabled:["report"] + enabled:["report"]` | 关闭 | default-off 配对警告 |
| 追加 `"go:report"`（照建议“写入注册名”） | **启用** | **同一条警告仍然打印** |
| `defaultDisabled:["report"] + enabled:["go:report"]` | 关闭 | 另一条“被裸条目挡住”的警告 |
| `defaultDisabled:["go:report"] + enabled:["go:report"]` | 启用 | 无 |
| 仅 `enabled:["go:report"]` | 启用 | 无 |

也就是说，“写入注册名”这句话有两种读法：**追加**会到达“技能已启用但警告永远不消失”的死胡同；**替换**会先把技能关掉、触发第二条警告，再按其“两个列表都写 `go:report`”才收敛。看起来成功的那条路径恰恰是不收敛的那条。

建议把措辞改成明确的动作，例如：把 `skills.enabled` 与 `skills.defaultDisabled` 里的裸 `'report'` 一并替换为 `'go:report'`（或直接删掉 `defaultDisabled` 条目）。

### N-3（旧残留，此轮更有杀伤力）

`registry.has(authored)` 豁免依旧存在。存在同名本地技能时，一个**确实默认关闭**的扩展技能会静默保持关闭且没有任何警告：实测 `defaultDisabled:["pdf"] + enabled:["pdf"]` 且存在用户级 `pdf` 时，`rust:pdf`（默认关闭）不可见、零提示。上一轮记为窄条件残留，现在 default-off 路径落地后，它正好落在新警告本该覆盖的区域。

## 4. 回归清单（全部复跑）

- `/pdf` 三行、各带属主标签；`/rust:pdf` 与 `/pdf` 分别命中正确技能（按落盘请求体字节判定）
- 裸 `skills.disabled:["pdf"]` 仍挡住两个扩展技能
- `--disabled-slash-commands` 双拼写双向成立
- `@ext:rust` 注入模型的文本仍为 `- Skills: rust:functions, rust:pdf`
- `/skills` 面板切换写入限定名并在重启后生效
- 无 default-off 技能时，旧的裸 opt-in 配对保持静默且两技能可用（无误报回归）
- typecheck 退出码 0；core `src/skills src/config src/tools/skill.test.ts` 1394 通过；PR 触及的 15 个 cli 套件 671/671 通过
- core `skill-curator` 那条失败依旧是 root 环境导致的既有问题，与本 PR 无关
- GitHub CI 在新 head 上全绿

## 5. 建议

上一轮的阻断项已清空，新增逻辑测试质量很高（五个新用例逐一变异验证均为真见证）。N-1 与 N-2 都只涉及新警告的措辞与取值范围，不影响任何技能的最终可达状态，可以合并后再修，也可以顺手在本 PR 里改掉——**倾向于顺手改掉 N-2**，因为“照做之后警告不消失”会直接消耗用户对这套迁移提示的信任。
