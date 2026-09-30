## Linux real-stack verification — LGTM ✅

Verified PR head `529311dc8a` on Linux (Debian, arm64, Node 24, Chromium 1228 / Playwright 1.61.1), filling in the PR's "not validated: real daemon sessions, Linux runtime" gap. **Recommend merge.**

### Build & test gates (all from a fresh pnpm worktree at PR head)

| Gate | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` + `npm run build` (full repo) | ✅ |
| web-shell `typecheck` / `lint` / `format:check` | ✅ / ✅ / ✅ |
| Focused trajectory unit suites (13 files) | ✅ **265/265** |
| Full web-shell unit suite (399 files) | ⚠️ 10445/10446 — see note |
| Trajectory Chromium e2e at PR head | ✅ **35/35** (matches PR claim) |
| Trajectory Chromium e2e at merge-base `c0ebf08dfd` | ✅ **32/32** (matches the PR's "baseline 32" claim) |

> The single full-suite failure is `BranchPickerPopover › remotes view › resets the remotes view and restores no focus after a workspace switch`. It reproduces identically with the merge-base versions of every file this PR touches (including `i18n.tsx`), so it is a pre-existing Linux failure unrelated to this PR.

### Real daemon session verification (the PR's uncovered area)

Real `qwen serve --web` daemon built from PR head, real session, **5 turns typed through the actual browser composer**, `read_file` tool calls with two **parallel** calls on turn 4. The only stub is the model itself (local OpenAI-compatible SSE endpoint) — no browser-level mocking. The daemon's paged transcript replay carried **20 request + 12 tool real `ui_telemetry` timing frames**, which is what the waterfall rendered.

**23/23 browser checks passed:**

- **Waterfall on real data** — per-row bars render from real telemetry; overview and waterfall share the time domain (`data-from`/`data-to` equal) through wheel zoom, active↔real-time mode switches, and reset.
- **Folding** — collapsing a turn: `aria-rowcount` 41→35 with a "6 records collapsed" badge; full-window metrics (elapsed 15.8s · active 15.6s · main model 9.3s) unchanged; expand restores 41/41.
- **Inspector preservation** — inspector pinned to parallel tool `call_4_b` keeps byte-identical input JSON while all turns fold; **"Expand and locate"** reveals the original row (5→14 rows).
- **Overview reveal** — with every turn folded (5 rows), clicking an overview span expands the ancestors and reveals the hidden record; `aria-activedescendant` names a mounted row.
- **Keyboard** — Home/End/ArrowDown follow visible rows and name mounted rows.
- **Responsive** — 480px and 320px panels hide the waterfall while records, folding and selection stay available; 1600×600 short window keeps inspector content and clipboard copy reachable ("Copied displayed content" + exact readback).
- **Before/after on the same session** — rebuilding the client from merge-base `c0ebf08dfd` product files: identical 41 rows / 26 overview spans / identical metrics, but **zero waterfall cells, zero bars, zero fold buttons**.
- **Real-data nuance** — the session's genuine `managed-auto-memory-extractor` subagent records render with "Parent call not located", exercising the PR's ambiguous-parent fallback path for real.

| After (960px panel) | Folded turn + badge | Narrow 320px |
| --- | --- | --- |
| ![after-wide](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr13081/pr13081/linux-529311dc8a/shots/after-wide-960.png) | ![fold](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr13081/pr13081/linux-529311dc8a/shots/after-fold-turn.png) | ![narrow](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr13081/pr13081/linux-529311dc8a/shots/after-narrow-320.png) |

| Inspector survives fold-all | Before (merge-base, same session) |
| --- | --- |
| ![inspector](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr13081/pr13081/linux-529311dc8a/shots/after-inspector-folded.png) | ![before](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr13081/pr13081/linux-529311dc8a/shots/before-wide-960.png) |

Full evidence (11 more screenshots, machine-readable reports, harness for reproduction): [`wenshao/qwen-code` @ `assets-pr13081`, `pr13081/linux-529311dc8a/`](https://github.com/wenshao/qwen-code/tree/assets-pr13081/pr13081/linux-529311dc8a) (pinned commit `d4991739b7`).

<details>
<summary>中文版本</summary>

## Linux 真实环境验证 — LGTM ✅

在 Linux（Debian arm64，Node 24，Chromium 1228 / Playwright 1.61.1）上验证了 PR 头 `529311dc8a`，补齐了 PR 自述中"未验证：真实 daemon 会话、Linux 运行时"的空缺。**建议合并。**

### 构建与测试门禁（PR 头的全新 pnpm 工作树）

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` + 全仓 `npm run build` | ✅ |
| web-shell 类型检查 / lint / 格式检查 | ✅ / ✅ / ✅ |
| 轨迹相关单测（13 个文件） | ✅ **265/265** |
| web-shell 全量单测（399 个文件） | ⚠️ 10445/10446 — 见说明 |
| PR 头的轨迹 Chromium e2e | ✅ **35/35**（与 PR 声明一致） |
| merge-base `c0ebf08dfd` 的轨迹 e2e | ✅ **32/32**（与 PR"基线 32 项"声明一致） |

> 全量单测唯一失败是 `BranchPickerPopover` 的"工作区切换后恢复无焦点"用例。把 PR 触及的所有文件（含 `i18n.tsx`）回退到 merge-base 版本后失败完全一致，属于 Linux 上既有的失败，与本 PR 无关。

### 真实 daemon 会话验证（PR 未覆盖的部分）

使用 PR 头构建的真实 `qwen serve --web` daemon 和真实会话，**通过真实浏览器输入框提交了 5 轮对话**，`read_file` 工具调用在第 4 轮有**两个并行调用**。唯一的桩是模型本身（本地 OpenAI 兼容 SSE 端点），浏览器侧无任何 mock。daemon 的分页 transcript 重放携带了 **20 个请求 + 12 个工具的真实 `ui_telemetry` 计时帧**，瀑布图正是由这些真实数据渲染的。

**23/23 项浏览器检查全部通过：**

- **真实数据瀑布图** — 逐行条带来自真实遥测；概览与瀑布在滚轮缩放、活跃/真实时间切换和重置后始终共用同一时间域（`data-from`/`data-to` 完全相等）。
- **折叠** — 折叠一轮：`aria-rowcount` 41→35，显示"6 records collapsed"徽标；全窗口指标（历时 15.8s · 活跃 15.6s · 主模型 9.3s）保持不变；展开恢复 41/41。
- **检查器保持** — 固定在并行工具 `call_4_b` 上的检查器在折叠全部轮次后输入 JSON 逐字节不变；"**展开并定位**"恢复了原始记录行（5→14 行）。
- **概览定位** — 全部折叠（剩 5 行）时点击概览条带会展开祖先分组并显示隐藏记录；`aria-activedescendant` 指向已挂载行。
- **键盘** — Home/End/方向键沿可见行移动，且指向已挂载行。
- **响应式** — 480px 和 320px 面板下瀑布列隐藏，记录、折叠和选择仍可用；1600×600 低窗口中检查器内容和复制按钮可达（提示"Copied displayed content"，剪贴板读回一致）。
- **同会话前后对比** — 用 merge-base `c0ebf08dfd` 的产物文件重建客户端：同样的 41 行、26 个概览条带、相同指标，但**没有瀑布单元格、没有条带、没有折叠按钮**。
- **真实数据细节** — 会话中真实产生的 `managed-auto-memory-extractor` 子代理记录显示"Parent call not located"，真实触发了 PR 的父引用歧义回退路径。

完整证据（另有 11 张截图、机器可读报告、可复现的驱动脚本）：[`wenshao/qwen-code` @ `assets-pr13081`，`pr13081/linux-529311dc8a/`](https://github.com/wenshao/qwen-code/tree/assets-pr13081/pr13081/linux-529311dc8a)（固定提交 `d4991739b7`）。

</details>
