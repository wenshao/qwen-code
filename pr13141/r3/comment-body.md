## Local verification, round 3: PR #13141 @ `2a702c316d`

Follows up on [round 1](https://github.com/QwenLM/qwen-code/pull/13141#issuecomment-5929521158) (`1e1f1970b3`) and [round 2](https://github.com/QwenLM/qwen-code/pull/13141#issuecomment-5931338773) (`c7eac4daf2`). The only new commit is a merge of `main`, and it is not inert — see *What changed since round 2*.

**Verdict: merge-ready** — 139/139 scripted assertions passed, 0 failed. Verified head `2a702c316d3766a54b302267cbcbfd2e8bb9565c`, base `47463b79a7dcf1559d03fd06611e39c7a2dec7d5`, trial-merged into current `main` `fb843d6ce70b774c01b0be07b64b0687082785e4` (clean, tree `25b5e8b89f78638c33ee7fb6a8dad6291d88d2ed`). Maintainer-driven local round on macOS 26.6.2 arm64, Node v24.18.1, pnpm 11.24.0 via corepack. Each arm built in its own worktree with `@qwen-code/qwen-code-core` realpath-asserted to resolve inside that arm.

<details>
<summary>中文摘要</summary>

**结论：merge-ready** —— 139/139 条脚本断言全部通过，0 失败。这是第 3 轮，接续第 1 轮（`1e1f1970b3`）和第 2 轮（`c7eac4daf2`）。

- **本轮为什么要重测**：新 head 只比第 2 轮多一个提交——把 `main`（`47463b79a7`）合进分支。这次合并不 inert：它带进来 20 个提交（合计 262 个文件、+37711/−3842），其中 `feat(managed-agent): implement durable Hosted Hooks (H2)` 和 `Hosted Turn takeover and G1 failover` 都动了帮助文本所描述的同一个 Broker，Java 侧改了 56 个文件（+4178/−377）。所以第 2 轮的结论不能直接沿用，我在新 base 上重建了两臂并重跑全部检查。
- **A/B 结论（核心主张）**：base 的 `serve --help` 两行仍是 "Reserved … not implemented and rejects startup"，head 换成新文案；24/24 条断言通过，且 5 个 issue 明确要求「不要动」的 `--experimental-managed-*` 兄弟行在两臂逐字节相同（见 `01-help-before-after.png`、`02-help-ab-assertions.png`、`07-gates-isolation-merge-lint-flakes.png`）。
- **PR 不改任何运行时行为**：把 head 的两段字符串回退成 base 原文后重新打包（该 `serve.ts` 与 base 逐字节相同），与 head 产物对比 1195 个文件，唯一差异是 `esbuild.json`；承载这两段字符串的是代码分割出的 chunk（**不是** `cli.js`）：该 chunk 从 29811 增至 29843 字节，正好 +32 = URL 串 +17、token 串 +15；`esbuild.json` 里 `serve.ts` 的输入体积同样 +32（47289→47321），两处独立互证；`cli.js` 体积不变且根本不含这两段字符串。残差全部解释清楚（见 `03-bundle-control-head-minus-pr.png`）。15/15 个运行时探针单元（S1–S9 + H1–H6）在两臂结果完全相同（见 `04-truth-matrix-base-vs-head.png`）。
- **本轮新问题——「for Workspace tool turns」还准确吗**：H2 Hooks 是同一对参数的**第二个消费者**（缺 Broker 时抛 `Hooks require a Hosted Workspace profile.`）。但决定性单元 H4 证明：即使给了 Broker 参数、只要没有 Workspace tool profile，hook catalog 仍被拒（`invalid_hosted_hook_catalog`）。所以 Hooks 严格嵌套在 tool profile 之内，帮助文本让用户配的参数对 Hooks 也够用，**不会误导任何人少配**。三个 profile 常量本身就叫 `hosted-workspace-{files,shell,mcp}/1`，措辞与代码一致。属非阻塞观察，非缺陷（见 `06-hook-scope-probe.png`）。
- **测试承载性**：M0 对照组绿（1 passed | 77 skipped），M1–M9 **9/9 全部被杀**，每个都是引用了 expected/actual 的断言失败，不是编译或 import 断裂（见 `05-mutation-matrix-9of9.png`）。
- **单元门**：`serve.test.ts` 在真实 40 列与 250 列 pty 中均 **78/78**（第 1 轮的宽度依赖问题保持已修复）；`serve` + `fast-path` + `hosted-harness-profile` + `run-qwen-serve` 在 head 与合并树上均 **709/709**。prettier 与 eslint 干净，且两个门都做了「植入违规→确认报错→移除」的活性证明。
- **第 2 轮遗留的 CI 红灯**：本轮合并带进了 #13094（放宽托管 runner 的 recall-scan 计时门），已静态确认；该测试在 head 与 base 各 7/7 通过，`workspace-agents` 在 head 连续 3 次全文件运行各 6/6 通过。
- **需要更正的一处**：机器人在本 head 上的最新评审顶着 `**[Critical]** Blocking finding(s) follow.`，但正文自己声明「verifier 被时间预算杀掉，5 条发现全部未验证，6 条仍带 unverified 标记，反向审计未开始」；整个 PR 上 inline 评审评论数为 **0**，那些发现从未落地成可核对的评论。不应把这个横幅当成已确认缺陷。
- **CI 独立佐证**：`Test (ubuntu-latest, Node 22.x)` 已在本 head 上**成功完成**（2026-10-02T15:27:10Z）。解析它上传的 junit 报告：`serve.test.ts` 78 个用例 0 失败，PR 新增的那个 testcase 确实在报告中且无 failure/error 子节点；四个相关套件在 CI 上是 78+114+19+498 = **709**，与我本地的 709/709 完全一致；第 2 轮的两个 flake（`routes/workspace-agents` 6/6、`recall-scan-latency` 7/7）在 CI 上也都是绿的。整个 CI 测试运行 cli 38136 / core 33983 / web-shell 10602，**0 失败 0 错误**（见 `08-ci-junit-corroboration.png`）。
- **仍然挡着合并的**：`reviewDecision` 依旧是 `CHANGES_REQUESTED`（来自机器人在 `5703841150` 上的评审），需要维护者 dismiss。撰写时 CI 为 24 通过、1 待跑（`web-shell E2E Smoke`）。关键是 `Test (ubuntu-latest, Node 22.x)`——唯一会执行新单测的 CI job——已于 2026-10-02T15:27:10Z **成功完成**（耗时 54 分钟，第 2 次尝试），所以第 1 轮「CI 还没跑过这个测试」的保留意见在本 head 上已不成立。
- **未覆盖**：Java 端 `HostedPublicWorkspaceIT`（本轮未跑，理由见下）、真实模型、Windows/Linux 原生运行、仓库级全量测试与 typecheck。


![ci junit corroboration](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/08-ci-junit-corroboration.png)


![gates isolation merge lint flakes](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/07-gates-isolation-merge-lint-flakes.png)


![hook scope probe](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/06-hook-scope-probe.png)


![mutation matrix 9of9](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/05-mutation-matrix-9of9.png)


![truth matrix base vs head](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/04-truth-matrix-base-vs-head.png)


![bundle control head minus pr](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/03-bundle-control-head-minus-pr.png)


![help ab assertions](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/02-help-ab-assertions.png)


![help before after](https://raw.githubusercontent.com/wenshao/qwen-code/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3/01-help-before-after.png)

</details>

## What changed since round 2

Round 2 verified `c7eac4daf2`, whose branch base was `6310dd38d5`. This head is exactly one commit later — `2a702c316d`, a merge of `main` (`47463b79a7`) into the branch, which is the fix round 2 predicted for the CI timing gate. The merge is **not inert**, so nothing was carried forward. Measured as `c7eac4daf2..2a702c316d`:

| | |
| --- | --- |
| Commits the merge brought into the branch | **20** |
| Total file delta | **262 files, +37711/−3842** |
| Java file delta | **56 files, +4178/−377** |
| Of those commits, touching the Broker's own subsystem | `feat(managed-agent): implement durable Hosted Hooks (H2)`, `feat(managed-agent): Hosted Turn takeover and G1 failover E2E`, `fix(managed-hooks): bound Hook admission and cold restore cost`, `feat(web-shell): show and answer Hosted tool approvals in the Managed panel` |
| The PR's own effective diff at the new base | unchanged: `serve.ts` (+2/−2) and `serve.test.ts` (+19), 21 insertions / 2 deletions |

Because the merge changed the code the help text *describes*, round 2's runtime numbers are stale as evidence about this tree. I rebuilt both arms at the new base and re-ran every measurement.

## Previous-finding status

| # | Finding (round) | Severity | Status at `2a702c316d` |
| --- | --- | --- | --- |
| R1-1 | The first commit's test was width-dependent and failed at *every* width, because the test parser never calls `.wrap()` so yargs rendered at min(80, columns) | Critical (bot blocker) | **fixed** (in `1e1f1970b3`). Re-measured here, not quoted: 78/78 in a real **40-column** pty and 78/78 in a real **250-column** pty, driven through `TIOCSWINSZ`, with the child's observed width confirmed separately |
| R1-2 | The PR's test killed only 4/9 mutants; its title promised "does not declare them unimplemented" but only the word "Reserved" was checked | Suggestion | **fixed** (in `c7eac4daf2`). Re-measured here: **9/9 killed**, M0 control green, all 9 kills are assertion failures quoting expected-vs-actual. Witness: `05-mutation-matrix-9of9.png` |
| R1-3 | Help does not mention that a non-loopback Broker URL must be HTTPS | Non-blocking | **stands.** Re-measured: S7 refused with `Managed Runtime Broker URL must use HTTPS outside the loopback interface.`; S8 (`https://`) listens. The startup error states it clearly; the help does not |
| R1-4 | Dated design docs still describe the older "rejects startup" state | Non-blocking, recommend leave | **stands.** Still exactly 2 files: `docs/design/2026-09-25-managed-agent-review-corrections.md`, `docs/design/2026-09-26-hosted-harness-no-tool.md`. Both are dated historical records; I agree with leaving them |
| R1-5 | On `main`, `/files/rewind` also uses the Broker, yet "Workspace tool turns" stayed accurate | Note | **stands, and the set is now larger** — see R3-1 |
| R2-1 | CI red on `1e1f1970b3`: `workspace-agents.test.ts` `ENOTEMPTY … rmdir …/agent-host`, also failing on 3 unrelated PRs | Environmental | **resolved.** Re-measured locally: 6/6 on 3 consecutive full-file runs. And green **on CI** at this head: `routes/workspace-agents.test.ts` = 6 tests, 0 failures |
| R2-2 | CI red: `recall-scan-latency.test.ts` timing gate; the branch lacked #13094 | Environmental | **fixed by this merge, confirmed on CI.** #13094 (`93efe3558a`) is reachable from base `47463b79a7` and the gate now reads `RUNNER_ENVIRONMENT === 'github-hosted'`. 7/7 on head and 7/7 on base locally (an A/A control), and **7 tests, 0 failures on CI** at this head |
| R2-3 | The bot's `CHANGES_REQUESTED` on `5703841150` needs a dismiss | Merge gate | **stands.** `reviewDecision` is still `CHANGES_REQUESTED`; the bot's latest review on this head (2026-10-02T05:04:40Z) is `COMMENTED`, which does not clear it |
| R2-4 | CI on `c7eac4daf2` had not finished | Status | **superseded.** At this head: 24 checks pass, 1 pending — and `Test (ubuntu-latest, Node 22.x)`, the only CI job that runs the new unit test, completed **success** at 2026-10-02T15:27:10Z |

## Central claim and A/B proof

**Central claim**: `qwen serve --help` described two *working* options as reserved, unimplemented, and startup-rejecting; after this PR it states their private-Broker purpose and their pairing/scope. Nothing else changes.

Witness: `01-help-before-after.png` (the PR's own Test Plan step 1, run verbatim on each arm), `07-gates-isolation-merge-lint-flakes.png`.

| Cell group | Base `47463b79a7` | Head `2a702c316d` |
| --- | --- | --- |
| `--managed-runtime-broker-url` / `-token` rows | `Reserved … not implemented and rejects startup.` | `Private Broker … required together with {token,URL} for Workspace tool turns.` |
| "Private Broker" present anywhere in help | **absent** | present on both rows |
| `[string]` type hint on both rows | present | present |
| The 5 sibling `--experimental-managed-*` rows | `Reserved experimental … not implemented and rejects startup.` | **byte-identical to base** |
| Every other option row in `serve --help` | — | **byte-identical to base** |
| Help line count | equal | equal |

24/24 assertions (`ab-help.mjs`). Witness: `02-help-ab-assertions.png`. The two arms' help differs *only* on lines mentioning the Broker options.

The old text was already false on base: **S2 (URL + token) listens on the base build too**, and reaches the tool-profile gate — so the Broker path was implemented before this PR. The PR moves the text to match behaviour that already existed.

## The PR contributes exactly two strings to the shipped artifact

A naive base-vs-head bundle diff is **confounded at this head** and I am not presenting it as evidence: across 1195 files it reports 62 differing names per side — **59 Vite content-hashed `web-shell` assets**, 2 masked esbuild chunk entries, and 1 `esbuild.json`. That churn is the 20 merged `main` commits, not this PR — the PR touches no `web-shell` source at all (`DIFF/3`).

The clean control is a **head-minus-PR** build: I reverted the two strings in head's `serve.ts` (confirmed **byte-identical to base's `serve.ts`** afterwards), re-bundled, and compared that bundle to head's. Witness: `03-bundle-control-head-minus-pr.png`.

| Comparison | Result |
| --- | --- |
| Files in the bundle census | 1195 |
| Files differing after normalization, head-minus-PR vs head | **1** — `esbuild.json`, the build manifest |
| Mapped help-string hits | **2** — exactly the two descriptions |
| Which output carries the strings | a code-split chunk, **not** `cli.js`: `chunks/chunk-5RTXTG7R.js` → `chunks/chunk-TDMHGISC.js` |
| That chunk's size | 29811 → 29843 bytes, **+32** |
| Accounted for by the two strings | URL **+17**, token **+15** = **+32**. No residue |
| `serve.ts` input size in `esbuild.json` | 47289 → 47321, **+32** — the same delta, independently, on the input side |
| `dist/cli.js` | same size (12745 B), contains no help strings; differs only in the hash-named chunk it imports, which normdist masks |
| Remaining `esbuild.json` lines | content-hash chunk renames, which follow from that chunk's content changing |

So the entire footprint of this PR in the shipped artifact is 32 bytes inside one code-split chunk, plus the hash renames that follow from it.

## Do the new claims match runtime behaviour?

Both arms were driven through the real CLI (`scripts/cli-entry.js` → the bundled `dist/cli.js`), with real loopback HTTP against the real Harness. **15/15 probe cells are identical on base and head** — the strongest form of "no behaviour change", since it is measured rather than inferred from the diff. Witness: `04-truth-matrix-base-vs-head.png`.

| Help-text claim | Deciding cell | Observed on **both** arms |
| --- | --- | --- |
| "for `--profile hosted-harness`" | S6 | refused: `Hosted Harness options require --profile hosted-harness.` |
| "required together with token / URL" | S3, S4, S5 | URL only, token only, and URL + blank token all refused: `Hosted Runtime Broker requires both URL and token.` (exit 1) |
| "required … for Workspace tool turns" (first half: tool turns need it) | S1 | Harness **listens** without the pair, but all three tool profiles get `400 hosted_tool_profile_unavailable` |
| "required … for Workspace tool turns" (second half: not required to start) | S1 | a no-tool Session is *not* refused as tool-profile-unavailable |
| …and with the pair, tool turns proceed | S2 | no profile is refused as unavailable |
| (old text) "not implemented and rejects startup" | S2 | **listens on base too** — the old claim was false before this PR |
| untouched sibling still rejects | S9 | `Experimental Managed Gateway and Runtime worker modes are not implemented.` |

36/36 assertions (`compare-truth.mjs`).

## Round 3's own question: is "Workspace tool turns" still the complete scope?

The merge made this worth asking, and rounds 1–2 could not have asked it. **Hosted Hooks (H2) are a second consumer of the same two flags**: `hosted-harness-session.ts` throws `Hooks require a Hosted Workspace profile.` when `brokerOptions` is absent, and constructs `new HostedHookSession(brokerOptions, …)`. `hosted-runtime-recovery.ts` (takeover / G1 failover) takes `brokerOptions` too.

So does the help under-describe? I drove a valid hook-catalog pin through the real gate on both arms (`probe-hooks.mjs`, H1–H6, 6/6 on each). Witness: `06-hook-scope-probe.png`.

| Cell | Config | Result (both arms) | What it decides |
| --- | --- | --- | --- |
| H1 | no pair, files profile + hook catalog | `400 hosted_tool_profile_unavailable` | no pair ⇒ no hooks |
| H2 | no pair, hook catalog, **no** tool profile | `400 invalid_hosted_hook_catalog` | no pair ⇒ hooks refused outright |
| H3 | pair + files profile + hook catalog | `400 invalid_managed_session_store` | **both** the tool gate and the hook gate pass; only the unconfigured store stops it |
| **H4** | **pair present, hook catalog, no tool profile** | **`400 invalid_hosted_hook_catalog`** | **decisive: hooks are unreachable without a Workspace tool profile** |
| H5 | pair + files profile, no hook catalog | `400 invalid_managed_session_store` | control: H3 passed because the hook gate passed, not because hooks were ignored |
| H6 | pair, empty body | `400 invalid_managed_session_store` | control: a no-tool Session still clears the tool gate |

H4 bounds the observation to a nit. Line 1444 re-checks the same condition on the **load** path (`hookCatalog !== undefined && (!toolProfile || !brokerOptions)` → `409`), so there is no create-or-resume route to a hook-bearing session that is not also a tool-profile session. A reader who follows the help sets both flags, and Hooks then work. Nothing is under-configured.

The wording is also consistent with the code's own vocabulary: all three profiles are literally `hosted-workspace-files/1`, `hosted-workspace-shell/1`, `hosted-workspace-mcp/1`, and "private Broker" is established project terminology, not a term this PR invented — **12 occurrences across 7 files** in `docs/design/` and the Java README (10× `private Broker`, 1× `Private Broker`, 1× `private broker`), the count identical on base and head since the PR touches no docs. E.g. *"public HTTP server and private Broker listener must not share exposure rules"* (`2026-09-19-managed-agent-spring-server.md`).

`/files/rewind` (R1-5) was re-measured rather than carried forward, and still holds: the route refuses when `!session.toolProfile || session.toolProfile === HOSTED_MCP_PROFILE || !brokerOptions`, then builds `new HostedWorkspaceBroker(brokerOptions, …)`. It is a Broker consumer that is also strictly tool-profile-scoped, like Hooks.

## Independent corroboration from CI's own test-results artifact

My local runs are not the only execution of this test. `Test (ubuntu-latest, Node 22.x)` (job 110878145206) completed **success** at 2026-10-02T15:27:10Z on head `2a702c316d`, and its test-results artifact carries junit XML for every suite. Parsed by `ci-junit.mjs`, 17/17 assertions. Witness: `08-ci-junit-corroboration.png`.

| Suite | CI | Local (this round) |
| --- | --- | --- |
| `src/commands/serve.test.ts` | **78 tests, 0 failures** | 78/78, at 40 and 250 columns |
| `src/serve/fast-path.test.ts` | 114, 0 failures | included in the 709 below |
| `src/serve/hosted-harness-profile.test.ts` | 19, 0 failures | included in the 709 below |
| `src/serve/run-qwen-serve.test.ts` | 498, 0 failures | included in the 709 below |
| the four together | **78 + 114 + 19 + 498 = 709** | **709/709** on head *and* on the merged tree |
| `src/serve/routes/workspace-agents.test.ts` (R2-1) | **6, 0 failures** | 6/6 three times consecutively |
| `src/memory/recall-scan-latency.test.ts` (R2-2) | **7, 0 failures** | 7/7 on head and base |
| whole run: cli / core / web-shell | 38136 / 33983 / 10602 tests, **0 failures, 0 errors** | not run locally (repo-wide gate out of scope) |

The PR's own testcase appears in CI's report with no `<failure>` or `<error>` child:

```xml
<testcase classname="src/commands/serve.test.ts"
          name="serve command args &gt; documents Hosted Runtime Broker options and does not declare them unimplemented"
          time="0.010397986">
</testcase>
```

Each per-file total was also cross-checked against the reporter's own `<testsuites>` root element, so a parsing regex that silently under- or over-counts cannot pass — an earlier loose sweep of mine did exactly that and reported double the true cli total.

## Corrections

- **The bot's `[Critical]` banner on this head is not a confirmed defect.** Review `5388475258` (2026-10-02T05:04:40Z, on `2a702c316d`) opens with `**[Critical]** Blocking finding(s) follow.` and then discloses: *"Not reviewed: verification — the verifier was killed by the review time budget before ruling on any finding; all 5 findings remain unverified"*, *"6 finding(s) still carried the `— [unverified]` tag"*, and *"Not reviewed: reverse audit"*. The PR has **0 inline review comments** in total, so none of those findings was ever posted in a checkable form. Its single "unresolved, please confirm" item is the triage-lifecycle note that CI on `c7eac4d` was not green — which the bot itself observes is superseded by the move to `2a702c31` carrying #13094, and which I re-measured above (R2-2). This is a correction to the review record, not a request to change code.
- **The issue's second acceptance criterion was never explicitly evidenced in rounds 1–2.** It asks that *"Help, the Managed Agent deployment README and the actual option consumers agree."* Measured now: `packages/sdk-java/managed-agent-server/README.md` is **byte-identical on base and head** and already said *"Configure the Harness's deployment-owned `--managed-runtime-broker-url` and `--managed-runtime-broker-token` options to reach this Broker."* The README never called them unimplemented — the **help text was the outlier**, and this PR is what brings it into line. Criterion met without a README edit.

## Findings

No blocking findings. Non-blocking, in descending order of interest:

1. **The scope phrase enumerates one consumer of several (nit).** At this base the pair also backs Hosted Hooks, MCP sessions (`HostedMcpSession(brokerOptions, …)`), `/files/rewind`, and takeover recovery. Bounded by H4: every one of those requires a Workspace tool profile, so the help cannot lead a reader to under-configure. A wording such as "…for Workspace tool turns and the Hosted features that ride them" would be more complete but is **not** required, and I would not block on it — the current text is accurate as far as it goes and matches the profile names in code.
2. **HTTPS-only for a non-loopback Broker URL is still absent from help (R1-3, stands).** The startup error is clear, so a misconfiguration is caught loudly rather than silently.
3. **Two dated design docs still describe the pre-implementation state (R1-4, stands).** Historical records; recommend leaving them, as round 1 did.

## Not covered

- **Java end-to-end (`HostedPublicWorkspaceIT`) — deliberately not re-run this round.** Rounds 1 and 2 ran it (2/2 with the flags; 0/2 with a shim stripping only the two flags; 2/2 with the shim's stripping disabled as a control). I did not repeat it because (a) the head-minus-PR bundle control proves the PR's entire contribution to the shipped artifact is 32 bytes of help text, so no end-to-end behaviour can differ from base; and (b) the merge changed **56 Java files (+4178/−377)**, so re-running it would measure `main`'s new H2/failover code rather than this PR. CI's own Java lanes cover that code and all 8 pass at this head: `Hosted process fault gates / MySQL 8.4 / Java 21`, `Runtime Broker and Managed Agent MariaDB / Java 21`, `Real daemon E2E / Java 11`, `ubuntu-latest / Java 11`, `ubuntu-latest / Java 17`, `ubuntu-latest / Java 21`, `macos-latest / Java 21`, `windows-latest / Java 21`.
- **Repo-wide test totals were not reproduced locally.** CI ran 38136 (cli) + 33983 (core) + 10602 (web-shell) tests with 0 failures and 0 errors; I ran only the affected suites locally and read those totals from CI's junit artifact instead. `Test (windows-latest…)` and `Test (macos-latest…)` are skipped by the workflow, as on previous heads, so the new test has executed on ubuntu only.
- **Node version deviation.** This round ran Node **v24.18.1**; `.nvmrc` pins 22 and CI runs Node 22.x. No Node 22 was available on this machine (there is no `~/.nvm` installation at all). The change under test is help text rendered by yargs from terminal width, not Node version, and the pty runs controlled width explicitly — but the deviation is disclosed rather than glossed.
- **Repo-wide gates not run**: full `npm run test`, `npm run typecheck`, and `npm run lint` across all workspaces. I ran the affected suites, and prettier/eslint scoped to the two changed files with a live-gate proof for each.
- **Windows and Linux** not run locally (the author tested Windows; CI runs ubuntu and windows).
- **No real model** was used. The probes stop at the admission gates, which is where every claim in the help text lives; the help text makes no claim about model behaviour.
- **The hook probe reproduces admission-gate behaviour, not a full Hook execution.** H3 shows the catalog is *accepted* and the session proceeds to the next missing dependency (a session store). It does not drive a hook to completion through a real Broker and Runtime — that is what the Java IT covers, and it is out of scope for the reason above.

## Methodology

Three git worktrees outside the repo (`/Users/wenshao/pr13141-r3/`): base `47463b79a7`, head `2a702c316d`, and a trial merge of head into current `main` `fb843d6ce7` (`25b5e8b89f`). Each installed with `corepack pnpm install --frozen-lockfile` (prepare runs the workspace builds), then `pnpm run bundle`; `@qwen-code/qwen-code-core` was realpath-asserted from both the root and `packages/cli` to resolve inside that same arm, so no arm silently loaded another's code. Both arms ran the *same* harness files unmodified. Runtime probes spawned the real CLI through the shipped entrypoint with a scrubbed env and a temp `HOME`/`QWEN_RUNTIME_DIR`, waited for the real `listening on http://127.0.0.1:<port>` line, then made real `fetch` calls against `/capabilities` and `/session` with the Harness protocol version and boot-id headers; the head-minus-PR control was produced by reverting the two strings, re-bundling, and restoring (verified: the arm's working tree is clean afterwards, and `serve.ts` was byte-identical to base's before the rebuild). Width-sensitive test runs used a real pty with `TIOCSWINSZ`, validated first by confirming the child reports the forced `process.stdout.columns`. Assertion counts in `assertions.json` are summed by `aggregate.mjs` from each harness's own JSON output, not hand-tallied. Harnesses live in `harnesses/`, raw per-cell output in `logs/`, images in `evidence/`.

---

Evidence (harnesses, per-cell raw output, junit extracts, mutation ledger, this report): [`assets-pr13141` @ `631cabc2`, `pr13141/r3/`](https://github.com/wenshao/qwen-code/tree/631cabc298419b35188a1b80eadfc17b4ec2ed47/pr13141/r3)

Advisory evidence for human reviewers — not a review, an approval, or a merge decision.
