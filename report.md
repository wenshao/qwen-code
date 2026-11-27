**merge-ready** · 64 passed · 0 failed · 64 total · verified head `35920cc3e5670801c7bb498cc648fbf27b68ad7c` · base `6b0cd79bdb18e31c0ae161ce35c6e04fca05de8e` · the preflight refuses before the artifact directory exists (A/B + guard revert), and the delta's R7-1/R7-2 fixes re-measured green · R6-3's fix is test-side and its suite was still running at the budget cutoff (see *Not covered*)

<details>
<summary>中文摘要</summary>

**结论：merge-ready（64/64 条脚本化断言通过，0 失败）。** 本轮复核 head `35920cc3e567`，相对上一轮验证过的 `637e53e9c4` 只多一个提交 `35920cc3e5`（5 个文件，+516/−14），正是针对上一轮仍未解决的 R7-1、R7-2、R6-3 三个 Critical。

**中心主张已被 A/B 证明。** 用真实 `verify-pr-prepare.mjs`、真实 git 克隆、假 `gh` 外部 peer，七个单元格对比 head、base 与「把 `!own && !sameRepository` 置为 false」的守卫回退臂：外部 fork 带 `--trust-pr-head` 在 head 上 **exit 3 且不建 artifact 目录**，守卫回退后 **exit 0 并建出目录**——这一条就是该 PR 存在的原因。`--execution host` 无批准 exit 2、只读权限 exit 3、未注册评论批准 exit 3，全部在 `mkdir` 之前拒绝；旧的 legacy 命令在 base 与 head 上行为一致（exit 0、建目录、无 `executionApproval`），容器兼容默认没有被破坏。证据图 `01-preflight-ab.png`。

**变异矩阵：三个结构性守卫各自被点名测试杀死，head 对照全绿。** 去掉信任判定 → 恰好 1 条测试红；去掉 in-flight 注册检查 → 恰好 1 条红；去掉 state-root 嵌套符号链接包含 → 恰好 1 条红；关掉发布侧深比较 → check 套件恰好 1 条红。每一条在未变异的 head 上都通过。**顺序这一半只有 harness 钉住**：把批准解析整体挪到 `mkdir` 之后，套件仍全绿，而 harness 显示 exit 3 却留下 `pr42-verify-*` 目录——这是覆盖缺口，不是本次合并条件。

**上一轮遗留：** R7-1（POSIX 祖先目录名含反斜杠）已修——用 `a\b` 祖先复测，check 正常走到缺失文件检查而不是 `could not resolve artifact directory`；R7-2（git < 2.45 上 `GIT_NO_LAZY_FETCH` 静默失效）已修——2.34.1 上 promisor 克隆在读取对象前被拒，exit 3 并给出升级提示；R6-3（文档命令守卫的开词表）的修复只改测试选择器，**其 model-proxy 套件在本轮预算截止时仍在运行，未取得结果**，见「未覆盖」。

**环境注记（非 PR 缺陷）：** 本机 Node 24.13.0 的 `fs.rmSync` 对指向目录的符号链接抛 `ERR_FS_EISDIR`，会让两条新增测试变红；Node 22.22.3（CI 的 `.nvmrc`）与 24.18.1 均正常。建议把该清理改成 `unlinkSync`，但这不是 CI 阻塞项。

</details>

## Previous finding status

The head advanced by one commit since the last report (`637e53e9c4` → `35920cc3e5`), and that commit touches exactly the three files the carried Criticals live in. Rows whose measurements consume `verify-pr-prepare.mjs` are marked **not re-measured** rather than carried on a closure: the delta adds 123 lines to that file, so the previous ignore-file A/B and 80-shape corpus no longer share an unchanged input closure.

| #     | finding                                                       | severity   | status at `35920cc3e5`                                                                                                                       |
| ----- | ------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R7-1  | POSIX trust-root traversal split on `\`                       | Critical   | **fixed** — `a\b` ancestor probe: normal artifact errors, no `could not resolve artifact directory` (asserted)                                |
| R7-2  | `GIT_NO_LAZY_FETCH` silently inert on git < 2.45              | Critical   | **fixed** — promisor clone on git 2.34.1 refused before object reads, exit 3, names the version requirement (asserted)                        |
| R6-3  | Documented-command guard is an open word list                 | Critical   | **not re-measured** — fix is test-side (`model-proxy.test.js`, +92/−5); its suite was still running at cutoff; no green/red verdict this round |
| F1/F2 | Missing witnesses for unknown-source and direct-state-root      | Suggestion | not re-measured (prepare changed)                                                                                                            |
| F4    | Four rollback witnesses skipped on the root lane              | Suggestion | **stands fixed** — prepare suite 138 passed / 9 skipped at this head                                                                          |
| N1    | Comment record `basis` leg had no witness                     | Suggestion | not re-measured (check suite passed 214/214 in the earlier head run, before the delta)                                                        |
| N2    | Trusted-checkout pin exhausted its 15 s ceiling               | blocking   | not re-measured                                                                                                                                 |
| S11-1 | `busybox` applet wrappers still run a nested `gh`             | Suggestion | not re-measured (pre-existing, unchanged by this delta)                                                                                       |

## Central claim and A/B

**Claim.** `verify-pr-prepare.mjs` resolves a host/VM execution approval **before** it creates `tmp/verify-context/` or `tmp/pr<n>-verify-*`, and refuses an approval that is not bound to the exact head, round and live registration; a command that omits `--execution` keeps container semantics.

Each cell is a fresh three-commit clone at the PR head, the real `prepare` CLI, and a fake `gh` peer on `PATH` that serves the snapshot, permission, comment and review GraphQL responses. The unit under test is never stubbed. `art` counts `tmp/pr42-verify-*` directories that existed when the process exited.

| cell                               | base `6b0cd79b` | head `35920cc3` | guard reverted (`if (false && !own && !sameRepository)`) |
| ---------------------------------- | --------------- | --------------- | -------------------------------------------------------- |
| legacy (no `--execution`)          | exit 0 · art 1  | exit 0 · art 1  | exit 0 · art 1                                            |
| host, no approval                  | n/a             | exit 2 · art 0  | exit 2 · art 0                                            |
| host, foreign fork + `--trust-pr-head` | n/a         | **exit 3 · art 0** | **exit 0 · art 1**                                    |
| host, own PR + `--trust-pr-head`   | n/a             | exit 0 · art 1  | exit 0 · art 1                                            |
| host, own PR, read-only permission | n/a             | exit 3 · art 0  | exit 3 · art 0                                            |
| host, same-repo PR + `--trust-pr-head` | n/a         | exit 0 · art 1  | exit 0 · art 1                                            |
| host, comment approval, no registration | n/a        | exit 3 · art 0  | exit 3 · art 0                                            |

`01-preflight-ab.png` captures this table as it printed. `n/a` in the base column is the finding, not a gap: the base tree has no `--execution` option at all (`git hash-object` of its prepare equals the base blob; `--execution` → `unexpected argument`), so before this PR a host round was prepared through the same legacy path that now means container.

## Mutation matrix

Each mutant is a copy of the head arm with exactly one clause neutralized; the head and each mutant are separate directories with independently written files (hardlinks broken before every write). “Kill” means the named test went red on the mutant and green on the unmutated head.

| ID  | clause removed                                   | suite / test                                                        | mutant            | head control |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- | ----------------- | ------------ |
| M1  | local-trust eligibility `!own && !sameRepository` | prepare: refuses local trust for another fork                       | 1 failed / 0 pass | 0 failed / 1 pass |
| M2  | in-flight registration requirement `!registration` | prepare: refuses a comment approval replay after completion         | 1 failed / 0 pass | 0 failed / 1 pass |
| M3  | nested state-root symlink containment             | prepare: state-root alias redirecting into the PR clone             | 1 failed / 0 pass | 0 failed / 1 pass |
| M4  | publish deep equality `isDeepStrictEqual`         | check: rejects declaration tampering and a moved head               | 1 failed / 213 pass | 0 failed (head run) |
| M5  | approval resolved before the artifact directory   | **not pinned by the suite** — harness only                          | suite green       | hazard witness below |

**M5 is the coverage gap.** Moving the approval block after `mkdirSync(artifacts)` leaves the prepare suite green, because the suite asserts refusal and artifact absence in separate tests but never asserts their ordering. The harness then shows the consequence: `host, own PR, read-only` exits 3 **and leaves `tmp/pr42-verify-<ts>/evidence/` behind** — the preflight runs, but not before the tree was touched. The PR's title claim is “validated before artifacts are created”; that half is proven by the unmutated A/B (art 0) but has no regression test. Suggest one fixture asserting `tmp/` is absent after every refused host/VM cell.

## Findings

- **Suggestion — two new tests fail on Node 24.13.0.** `lateMutationWitness` cleans up a directory symlink with `rmSync(redirected.artifact)`. Node 24.13.0 throws `ERR_FS_EISDIR` there; Node 22.22.3 (CI's `.nvmrc`) and 24.18.1 unlink it and the tests pass. Measured matrix: 24.13.0 → `ERR_FS_EISDIR`; 22.22.3 → ok; 24.18.1 → ok. This is not CI-blocking; `unlinkSync` would be exact. The two reds were reproduced and then cleared by switching runtimes, so they are not attributed to the PR's logic.
- **Completeness note, not a merge condition — M5 above.** The ordering half of the central claim has no test.

## Not covered

- **R6-3 not re-measured.** `verify-pr-model-proxy.test.js` was started at this head but had not finished when the round hit its budget; no count is quoted. This is the one carried Critical without a verdict at `35920cc3e5`.
- **Environment, not PR.** Two head failures are git 2.34.1 limitations, each proven with a direct command: `git merge-tree --write-tree` is `unknown rev` (< 2.38), and `includeIf "hasconfig:remote.*.url:"` is ignored (< 2.36). CI's newer git runs them.
- **Per-commit attribution.** 58 commits; only the base and head trees were available locally, so the aggregate `base..head` diff was verified, not individual commits.
- **Live GitHub paths.** No real approval comment, permission call or network `gh`; the fake peer served those responses. No untrusted PR code was executed: every battery cell ran the trusted helper tree only.
- **Current main.** GitHub reports `mergeable: true` against live main `3abff7133e` (no conflict); I did not run a local trial merge because the history is not present locally.
- **Windows, AIX-style path shapes, and the CI publish lane.**

## Methodology

`arms/base` and `arms/head` are full trees whose `scripts/` directory is byte-exact at the two SHAs: all 336 blobs hash-match base (`git hash-object` vs the GitHub tree listing), and all 315 unchanged scripts are byte-identical between arms; the 21 PR files were downloaded at each SHA and `cmp`-verified. Everything outside `scripts/`, `packages/cli/src/test-utils/` and `.github/workflows/` comes from a Nov 22 full checkout with its `node_modules`, and the workflow directory was overlaid at the base SHA. Suites ran on Node 22.22.3 because `.nvmrc` pins 22 and Node 24.13.0 has the unrelated `rmSync` regression; running four copies of the same suite as separate processes produced 52 false reds, so every suite in this round ran alone. Raw logs, harnesses and per-cell output are in `tmp/pr18064-verify-20261127-060350/`; the harnesses are `ab-prepare.mjs`, `logs/make-mutants2.mjs`, `logs/final-checks2.mjs`.