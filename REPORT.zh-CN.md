# PR #10841 本地真实环境验证报告（中文完整版）

- 验证提交：`941d876d4f`（PR head）
- 对照基线：`c39e83e01c`（`origin/main`，为本 PR 的 merge-base）
- 平台：Linux 6.12.63 / Node 22 / `npm ci` + `npm run bundle` 双臂真实构建
- 结论：**建议合并**，附 1 条建议级修复（R3-3）与 3 条非阻断残留

---

## 1. 验证装置

隔离 `HOME`，两个扩展各自携带同名技能 `pdf`，外加一个用户级 `pdf` 技能，构造三方命名冲突：

```
home/.qwen/extensions/rust/qwen-extension.json      name=rust
home/.qwen/extensions/rust/skills/pdf/SKILL.md      name=pdf
home/.qwen/extensions/rust/skills/functions/SKILL.md name=functions
home/.qwen/extensions/python/qwen-extension.json    name=python
home/.qwen/extensions/python/skills/pdf/SKILL.md    name=pdf
home/.qwen/skills/pdf/SKILL.md                      name=pdf   (用户级)
```

模型侧使用一个 OpenAI 兼容的本地 mock，会把每次请求体落盘，因此“到底哪一份技能正文被注入”是按字节判定的，不是靠界面推断。TUI 通过独立 tmux socket 驱动，截图由 `capture-pane -e` → ANSI→PNG 渲染。

## 2. 基线对照：main 上问题是真实存在的

`origin/main` 同样装置下：

- `/pdf` 补全**只有一行**：`pdf [Extension]  Build PDF reports with reportlab.` —— 即 **python** 扩展那一份。
- `/skills` 面板只有 16 项，显示 `pdf (User)`，两个扩展的 `pdf` 完全消失。
- 实际执行 `/pdf` 时，落盘请求体里出现的是 `shipped by the python extension`。

也就是说 main 上：面板显示 User 的 `pdf`，实际跑的是 python 扩展的 `pdf`，rust 扩展的 `pdf` 与用户自己的 `pdf` 都无法触达。这不是标签问题，是**执行到错误技能**。

PR 分支同装置：`/pdf` 给出三行 `pdf [User]` / `rust:pdf [Extension: rust]` / `python:pdf [Extension: python]`，全新会话执行 `/pdf` 注入的是用户自己的正文（`Personal pdf skill`），执行 `/rust:pdf` 注入的是 `shipped by the rust extension`。

## 3. PR 自述测试计划逐条复核

| 声明 | 结果 |
| --- | --- |
| `/skills` 与选择器显示 `ext:name` 与所有者徽章 | ✅ 面板 18 项，`rust:pdf (Extension: rust)`、`python:pdf (Extension: python)` |
| 裸名放入 `skills.disabled` 仍禁用 | ✅ `disabled:["pdf"]` 同时挡住 `rust:pdf` 与 `python:pdf`，二者落入锁定区并标注归属 |
| 裸名放入 `skills.enabled` 不再启用 + 启动警告 | ✅ 两条警告分别点名 `rust:pdf` / `python:pdf` 作为替换 |
| `defaultDisabled:["pdf"]` + `enabled:["rust:pdf"]` 打印阻止警告且保持禁用 | ✅ 警告出现，技能不可见；按警告建议改成两侧都写 `rust:pdf` 后恢复可用 |
| `qwen --help` 说明双拼写规则 | ✅ 且实测双向成立：`--disabled-slash-commands pdf` 隐藏三者；`--disabled-slash-commands rust:pdf` 只隐藏 `rust:pdf` |
| `npm -w packages/core run typecheck && npm -w packages/cli run typecheck` 干净 | ✅ 退出码 0 |
| 单测通过 | ✅ core 1193 通过；PR 触及的 15 个 cli 套件 670/670 通过 |

core 中 `skill-curator.test.ts > reports skippedErrors when rename fails transiently` 一条失败，**在 `origin/main` 上同样失败**（以 root 运行导致权限型故障注入失效），与本 PR 无关。

## 4. 兼容性与往返

- 旧的 opt-in 组合 `defaultDisabled:["pdf"] + enabled:["pdf"]`（升级前扩展技能的标准写法）**仍然生效**，`rust:pdf` 保持可用，且不触发误报警告。
- `/skills` 面板切换 → 写入 workspace `skills.disabled: ["rust:functions"]`（**限定名**）→ 重启后仅 `rust:functions` 消失，`rust:pdf` 不受影响。这正是 main 上做不到的按扩展粒度控制。
- 第 3 轮的语言包修复有效：`general.language: de` 下锁定区标题、`[gesperrt: User]`、`(Erweiterung: Rust Tools)` 均为德文。
- 第 3 轮的 Critical R3-1 修复在真实链路成立：`@ext:rust` 提及注入模型的文本为 `- Skills: rust:functions, rust:pdf (invoke via /<skill-name>)`，与实际注册的斜杠命令一致。系统提示词中的技能目录同样使用 `rust:pdf`。

## 5. 建议在合并前修掉的一条（R3-3，建议级）

`SkillsManagerDialog.tsx:196-199` 的作用域收集循环把 Workspace 排在 System 之后（`[...scopes, Workspace]`，其中 `scopes` 是 SystemDefaults/User/System），而合并优先级是 SystemDefaults < User < Workspace < **System**（`settings.ts:609-614`）。后写覆盖先写，于是 Workspace 抢走了标签。

实测（System 与 Workspace 同时写 `skills.defaultDisabled: ["pdf"]`，工作区已信任）：

1. 锁定行显示 `[locked: skills.defaultDisabled 'pdf' (Workspace)]`；
2. 用户照标签删掉 workspace 条目 → 技能**仍然锁定**，标签这才变成 `(System)`。

被点名的文件恰恰是改了也没用的那个。把循环改成真实优先级顺序（保留 trust 守卫）后，实测标签直接给出 `(System)`：

```ts
for (const [scope, label] of [
  [SettingScope.SystemDefaults, 'SystemDefaults'],
  [SettingScope.User, 'User'],
  [SettingScope.Workspace, 'Workspace'],
  [SettingScope.System, 'System'],
] as const) {
  if (scope === SettingScope.Workspace && !settings.isTrusted) continue;
```

变异探针显示当前顺序**完全没有被测试固定**：施加上述修正后 `SkillsManagerDialog.test.tsx` 20/20 仍然全绿。所以修复本身零风险，但需要自带一个见证用例（trusted，System 与 Workspace 同写 `pdf`，断言标签为 `(System)`）。

## 6. 非阻断残留（记录，不要求本轮处理）

1. **所有者标签未做单行化处理。** `extensionOwnerLabel()`（`commandMetadata.ts:54`）直接使用扩展清单的 `displayName`。清单里放一个含换行的 `displayName`，会让补全弹窗与 Skills 面板的行被撑成两行、括号断开。同一文件的 `/skills` 文本清单对 description 做了 `replace(/[\r\n]+/g, ' ')`，对所有者标签却没做；仓库里已有 `sanitizeDisplayText`，一行即可对齐。属于显示卫生问题，扩展本来就是受信任内容，影响面有限。
2. **恢复会话时按注册身份查表。** `skill.ts:359-366` 的 `restoreLoadedSkillsFromHistory` 只用 `skill.name`（`rust:pdf`）建索引，没有 `authoredName` 回退。升级前的记录里是 `skill('pdf')`，恢复后匹配不上，会被判定为未加载并重复注入正文。一次性的迁移期 token 浪费，行为不出错。
3. **同名本地技能会吞掉迁移警告。** `bareEnabledGrantWarnings` 里 `if (registry.has(authored)) continue;` 是有意的豁免（裸名确实启用了那个同名技能）。但如果用户当初写 `skills.enabled: ["pdf"]` 本意是给扩展技能，同时又恰好有一个同名的 user/project 技能，升级后扩展技能静默失去授权且没有任何提示。本次实测确认了这一分支；由于 `skills.enabled` 不是白名单，只有当扩展技能本身默认关闭时才有实际后果，因此影响窄。
4. **CJK 所有者名截断偏早**（第 3 轮已记录）：徽章按 UTF-16 长度算宽度，中文显示名会比列宽允许的更早出现省略号。实测行不换行、布局不破，纯观感。

## 7. 建议

CI 全绿、类型检查干净、新增测试有效，第 3 轮除 R3-3 外的发现（R3-1 Critical、R1-7 四处文案、R2-2 接线测试、R3-2 六语言包）作者都已在 `08a81ef777` / `fb6558a25e` 中修复并经本地复核。功能相对 main 是明确的行为纠错，不只是改名。

**建议：补上 R3-3 的 6 行顺序修正与其见证用例后合并。** 其余四条作为已知残留记录即可。
