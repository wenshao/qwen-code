## Maintainer verification round 2: real DingTalk + GitHub runs at `4d3e7255a5`

**Verdict: merge-ready.** 96/96 scripted assertions passed, 0 failed, at verified head `4d3e7255a5b3f0594b9709ef103a706bc976f275` (base `99bf4ce86b`). Both round-1 blockers are fixed and re-proven by execution; the round-1 review Criticals (R1-1, R1-2, R1-13) each hold end-to-end, in unit tests, and under mutation. The four deferred review items (R1-10, R1-11, R1-14, R1-15 remainder) are still unpinned — the mutation matrix confirms exactly those sites survive, and nothing else.

<details>
<summary>中文摘要</summary>

**结论：可以合并。** 在核实 head `4d3e7255a5`（base `99bf4ce86b`）上，96/96 条脚本化断言全部通过。

上一轮发现的状态（全部在新 head 上重新实测，未引用旧结论）：

- **B1（Prettier 红）已修复**：head 上全部 18 个改动文件 `prettier --check` 通过；CI Lint & Static 转绿。
- **B2（`allowedGroupUsers` 大小写）已修复**：两个适配器都按维护者补丁的形态做了归一化；端到端 G1 场景（`["Alice"]` 混合大小写）在 head 上从无回复翻转为得到回复，base 上保持无回复。
- **R1-1（空 `allowedUsers` 在解耦群轴下等于不设限）已修复**：新增 S8 场景端到端证明 fail-closed——群里陌生成员可以发起回合，但 `/approve` 被拒；单元测试和变异探针（M20）同样钉住。
- **R1-13（日志 reason 不分轴）已修复**：端到端可见 `group_sender_denied`（S2），私聊轴仍是 `sender_denied`。
- **N1/N3 文档措辞**已按上一轮认可的写法落地；**N4** 变异存活数从 9/19 降到 8/19，减少的正是 autofix 声称已钉住的 M04（存量 loop 授权点）。

核心声明的 A/B 在新 base 上完整重跑：默认行为不变（S0/S3 两臂逐格一致）、两个方向解耦（S1/S2）、非法值 fail-closed（S4）、群消息不再泄漏私聊配对码（S5）、群历史走新轴（S6b）、共享会话批准仍看 `allowedUsers`（S7/S7u/S8）。

遗留说明：4 个评审项（R1-10/R1-11/R1-14/R1-15 剩余）按作者声明推迟到下一轮，变异矩阵确认恰好是这些点未被测试钉住，无其他存活变异。PR 描述里 Risk & Scope 关于 Web Shell 编辑器的旧措辞仍未改（bot 无法编辑 PR 描述，建议合并前手动改一下）。

</details>

### Previous-finding status (round 1 at `1713e95` → re-measured at `4d3e7255a5`)

| # | Finding | Severity | Status at `4d3e7255a5` | Re-measurement |
| --- | --- | --- | --- | --- |
| B1 | Prettier red on 6 files | blocking | **fixed** | `prettier --check` exit 0 on all 18 changed files; CI `Lint & Static` green at this head; gate proven live (planted misformat fails) |
| B2 | mixed-case `allowedGroupUsers` never matches | blocking | **fixed** | Both adapters carry the normalization next to `allowedUsers`; E2E G1 flips NO_REPLY → ANSWERED (Fig 2); mutants M22/M23 killed by the new adapter tests |
| N1 | docs: "Web Shell editor rewrites the config" | non-blocking | **fixed** | overview.md now says the editor keeps both keys (the round-1 endorsed wording); editor closure unchanged between bases, so the round-1 behavioral measurement carries |
| N2 | shared group sessions: group-axis member can't `/approve` | non-blocking | **superseded by R1-1 fix + docs** | S7 re-run: bob still COMMAND_DENIED, alice approves; overview.md now documents it; and the R1-1 hardening (empty `allowedUsers` ≠ unrestricted for group targets) is proven by S8 + M20 |
| N3 | GitHub/GitLab: `open` admits any commenter | non-blocking | **resolved (documented)** | github.md/gitlab.md Security sections state the axis replacement; behavior re-confirmed (G3/G4 head) |
| N4 | 9/19 mutants survive | non-blocking | **improved: 8/19** | Re-ran all 19 at new head: M04 flipped survived → killed by the new stored-loop test; the 8 survivors are exactly the deferred R1-10/R1-14/R1-15 sites plus near-equivalent M03 (Fig 3) |

### Round-1 review Criticals added at this head

| # | Fix | Evidence |
| --- | --- | --- |
| R1-1 | empty `allowedUsers` no longer means unrestricted for decoupled group targets | New E2E S8 (empty `allowedUsers`, `senderPolicy: pairing`, `groupSenderPolicy: open`, shared thread session): bob's turn runs (PERMISSION_PROMPTED), bob's `/approve` is COMMAND_DENIED. Unit test passes; mutant M20 (guard removed) turns it red |
| R1-2 | `allowedGroupUsers` lowercased in `connect()` (both adapters) | E2E G1/G2 at head; M22/M23 killed by the new adapter tests |
| R1-13 | preflight rejection logs `group_sender_denied` on the group axis | E2E S2 shows `REJECTED(group_sender_denied)` for group rejections while DM keeps `sender_denied`; M21 killed by the new assertion |

### Central claim re-proven: A/B at the new base

Same harness as round 1 (real `qwen serve --channel dingtalk` against a TLS-spoofed DingTalk gateway, scripted OpenAI model; real Octokit against a fake GitHub REST API), now base `99bf4ce86b` vs head `4d3e7255a5`, 11 DingTalk scenarios + 6 GitHub scenarios per arm, fresh daemon per cell. 44/44 scripted cell assertions pass (Fig 4).

![DingTalk A/B matrix](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr12475/pr-12475/r2/01-dingtalk-ab-matrix.png)

- **S0/S3**: arms identical cell-for-cell — default behavior unchanged.
- **S1/S2**: decoupling holds in both directions; S2 additionally shows the new `group_sender_denied` log reason on the group axis only.
- **S4**: `groupSenderPolicy: "pairing"` refuses startup at head, naming the field; base starts (key inert there).
- **S5**: head answers dave in the group while his DM still gets a pairing code; the pairing store holds only the DM-created request. Base leaks the pairing code into the group.
- **S6b**: bob's unmentioned line reaches alice's next prompt only at head (`[hist]`).
- **S7/S7u/S8**: shared-session approvals still follow `allowedUsers`; per-user scope lets bob approve his own turn; empty `allowedUsers` no longer opens approvals to the group axis.

![GitHub A/B matrix](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr12475/pr-12475/r2/02-github-ab-matrix.png)

- **G1**: the B2 repro — `allowedGroupUsers: ["Alice"]` — flips from NO_REPLY (base, and round-1 head) to ANSWERED at this head. G2 (lowercase) also ANSWERED.
- **G3/G4**: `open` admits any commenter including the unmentioned aggregate-lane drive-by — the N3 behavior, now documented in both adapter docs.
- **G5/G0**: keys absent stays quiet on both arms; mixed-case `allowedUsers` works on both.

### Mutation matrix at the new head

![Mutation adjudication](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr12475/pr-12475/r2/03-mutation-matrix.png)

All 19 round-1 mutants re-run at `4d3e7255a5` plus 4 new mutants (M20–M23) targeting the guards this round added. 23/23 outcomes match expectation; all 8 suite controls green (base-pkg 1406, dws 392, github 210, cli 477+150, ChannelBase 715, adapters 193/48). Killed: M01, M02 (the PR-listed pair), M04 (newly pinned), M07, M13–M19, M20–M23. Surviving: M03 (near-equivalent — the Feishu caller reruns full preflight), M05/M06 (group-history filters), M08 (explicit `inherit`), M09/M10 (GitHub lanes), M11/M12 (DWS) — precisely the sites the author deferred to the next round, none else.

### Gates at head

`prettier --check` clean on all 18 changed files (liveness-probed); `eslint --max-warnings 0` clean on the 13 changed `.ts` files; suites: ChannelBase 715/715, GithubAdapter 193/193, GitlabAdapter 48/48, dws 392/392, cli config-utils + channel-settings-store 193/193. CI at `4d3e7255a5`: no failing checks (`review-pr` still pending at report time).

### Notes (non-blocking)

- The PR body's Risk & Scope still carries the old Web Shell editor wording; the docs were fixed but the PR description is a GitHub-side edit the autofix bot can't make. Suggest a one-line manual edit before merge.
- Deferred items R1-10 (aggregate-lane pairing diversion), R1-11 (bot-only allowlist fail-fast), R1-14 (`SenderGate.canPair`), R1-15 remainder (5 unpinned sites) stand as declared; the mutation matrix confirms they are the only unpinned sites.

### Not covered

- Per-commit attribution (the merge commit `98c8d6cbb4` was verified only as part of the aggregate diff).
- Web Shell editor behavior was not re-driven (docs-only change this round; editor closure byte-identical between the two bases).
- DWS and loop-store paths are covered by unit/mutation evidence only; no live DWS daemon was run.
- Windows/macOS runs; whole-repo typecheck (CI covers both).

### Methodology

Two pnpm-installed worktrees (`tmp/pr12475-head`, `tmp/pr12475-base`), full build + bundle each; base `node_modules` hardlinked from head with the realpath of `@qwen-code/qwen-code-core` asserted to resolve inside the base tree; base bundle verified to lack `groupSenderGate`, head bundle to contain it. DingTalk cells ran a real daemon against a fake DingTalk OpenAPI/stream gateway (loopback TLS, throwaway CA, `/etc/hosts` entries removed afterwards) and a scripted OpenAI-compatible model; a probe counts as ANSWERED only if its token reached the DingTalk webhook. GitHub cells ran real Octokit against a fake REST API via `baseUrl`. Every cell verdict above comes from a scripted assertion over the harness result JSON (`check-e2e.mjs`, 44 assertions; `check-mut.py`, 31; `check-gates.mjs`, 15; plus 5 suite-count and 1 gate-liveness checks = 96 total). Raw result JSONs, console logs, harness, and mutation logs are on the assets branch under `pr-12475/r2/`.
