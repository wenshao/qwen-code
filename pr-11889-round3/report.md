## Round 3 verification at `5dbce49dd3` — the delta since round 2, on macOS this time

**Verdict: merge-ready — 119/119 scripted assertions pass, 0 unexpected failures.**

Note on timing: the PR was merged at 2026-10-03 00:11:55Z while this round was running. I verified the round-3 head `5dbce49dd36b` and then proved the landed squash `aa03e7a542` carries it byte-identically, so everything below applies to what is now on `main`: the PR's effective diff at the verified head and the squash's effective diff against its parent are line-for-line equal — **903/903** content lines in `extension-store.ts`, **3117/3117** in `extension-store.test.ts`, zero lines unique to either side, and the three docs identical by blob SHA.

Rounds: [round 1 at `5fd2460104`](https://github.com/QwenLM/qwen-code/pull/11889#issuecomment-5723783044) · [round 2 at `341a0d67b5`](https://github.com/QwenLM/qwen-code/pull/11889#issuecomment-5801595705). This round covers the delta since round 2 — `58b49ad2e9` "refuse a read while a faulted rollback is still owed" plus the two merges of `main` — and re-measures every carried-forward arm at the new head.

<details>
<summary>中文摘要</summary>

**结论：merge-ready —— 119/119 条脚本断言全部通过，无意外失败。** 验证中途该 PR 被合并（00:11:55Z），我随后证明了合入的 squash `aa03e7a542` 与被验证 head 的内容逐行一致（源码 903/903、测试 3117/3117、三个文档 blob 相同），所以本轮结论对 main 上的落地版本同样成立。

- **第 2 轮发现 1（fault 窗口内读到撕裂树）已修复**，且是双层证明：单元层面，回退 `58b49ad2e` 的唯一 hunk 后恰好两个扩展测试变红（`promise resolved "{ version: 2, generation: 1 }" instead of rejecting`）；系统调用层面，arm F 的 A/B 对照显示 head 在窗口内一律以 `ExtensionConflictError` 拒绝，而对照构建（同一构建仅回退该 hunk）照常返回 `OK gen=1`、磁盘上却是回滚从未执行过的树（见下图 01）。
- **第 2 轮发现 2（mtime 测试依赖时钟粒度）已修复**：utimes 钉序在 macOS 上确定性通过（该测试在本机多次运行全绿），且变异体验证它仍然有牙——M04（按实时 mtime 排序）恰好被这一个测试杀死，M20（orderMs 算出但不落盘）恰好被新增的持久化断言杀死。
- **意外收获**：第 2 轮的延后项 M06（windowRefusal 的文案归属）被 `58b49ad2e` 顺带钉住了——该变异体现在恰好被那两个扩展测试杀死。其余延后变异体（M07/M10/M12–M17）状态不变，仍属作者声明的后续批次。
- **承载臂全部复测通过**：win32 加锁 14/14（copy 交换、inode 不变）、win32 未加锁 13/13（rename 路径）、darwin 加锁 6/14（回退确实以 win32 为门槛，失败形状与第 1 轮 Linux 对照逐字节一致）、strict rmdir 11/14、SIGKILL 中途崩溃恢复 11/11、永久 EPERM（chflags uchg）9/9、树形状 8/8、真实 bundle CLI 在锁下 install/update/uninstall 正常（winlock.log 证明 rename 拒绝真实发生）。
- **第 1 轮 N1/N3 已被文档采纳**（读者窗口的"文件短暂不存在"与证据表自相矛盾处均已修正）；N2（首个报错是泛化 AggregateError）、N4（先烧 rename 退避）、N5（proper-lockfile 60s stale 窗口）依旧成立，均非阻塞。
- 门禁：`extension-store.test.ts` 在真实 macOS 进程下 **151/151**（与作者的非 Windows 数字一致，这是 PR 声明的"macOS 未实测"空白上的首个数据点）；`src/extension/` 944 个测试全过（其中 `github.test.ts` 需要在 forks 池下跑，`--pool=threads` 下 `process.chdir` 不可用——是测试池的限制，与本 PR 无关）；prettier/tsc 干净（活性探针验证过）；eslint 干净（但仓库配置不标记模块级未用变量，已实测披露）。
- 未覆盖：真实 Windows 机器、EBUSY（子进程 cwd）形态、完整 packages/core 套件、Node 22（本机为 25.8.0；合并提交上的 CI ubuntu lane 是绿的）。

</details>

### How Windows was reproduced on macOS

A `DYLD_INTERPOSE` dylib (`DYLD_INSERT_LIBRARIES`) sits on `rename` / `renameat` / `renamex_np` / `renameatx_np` (and `rmdir` in strict mode) and, for every path under the extensions root, asks the kernel's own file-descriptor table — via libproc's `proc_listpids` + `PROC_PIDLISTFDS` + `PROC_PIDFDVNODEPATHINFO`, the same information Linux's `/proc/<pid>/fd` exposes — whether another live process holds an open handle on the directory or a descendant. When one does, the call fails with a genuine `EPERM` at the libc boundary and Node surfaces exactly the error string the issue reports. The holder is a live process holding one open directory handle per subdirectory, which is what a recursive watcher attaches on Windows. Nothing in the store, `node:fs` or libuv is mocked; locked arms first re-run the rename as a ground-truth check. Two round-1/2 fixtures have no macOS equivalent and were ported by classification, not by appearance: the read-only bind mount (a non-lock `EROFS` on the restore's first write) became `chmod -R a-w` on the destination (a non-lock `EACCES`; the store classifies only `EPERM`/`EBUSY` as lock-class), and `chattr +i` became `chflags uchg` (verified: unlink fails with `EPERM`, the same code, the same syscall).

![interposer self-test](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/07-interposer-selftest.png)

### Previous-finding status at `5dbce49dd3` (re-measured, not carried on faith)

| # | finding (round) | severity | status at `5dbce49dd3` | evidence |
| --- | --- | --- | --- | --- |
| R2-1 | A read inside a fault's window served `OK gen=1` over a tree the rollback never touched | was blocking | **fixed** — head refuses with `ExtensionConflictError`; the control build (same tree minus `58b49ad2e`) still serves the defect | arm F A/B below + mutant `nofix` |
| R2-2 | `falls back to mtime order when a stack claims one generation` raced the filesystem clock | was blocking | **fixed** — `utimes` pin is deterministic here; mutants M04 and M20 are each killed by exactly this test | mutation matrix below |
| M06 (deferred) | `windowRefusal` ignoring `rollbackHeld` | non-blocking deferral | **now pinned** — reverting it turns exactly the two extended tests red; the deferral is closed as a side effect of `58b49ad2e` | mutation matrix |
| M07, M10, M12–M17 (deferred) | various unpinned lines | non-blocking deferral | unchanged; not re-run (author's declared follow-up batch) | — |
| N1 | concurrent reader can find a file *missing*, not just mixed | docs | adopted; re-measured at head on a 52.7 MB tree, two runs: 43 mixed + 12 `ENOENT`, and 26 mixed + 7 `ENOENT`, of 35,000 samples each (windows 6 ms and 3 ms) | figure 06 |
| N3 | design doc contradicted its evidence table on directory removal | docs | adopted (`…:88` now reads "block directory rename, not directory removal") | doc read |
| N2 | first contact on a defeated rollback is a generic `AggregateError` | non-blocking | **stands** — reproduced again in the blocked-rollback arm (second op onward names the directory) | `logs/blocked-rollback.log` |
| N4 | every copy-mode swap burns the full rename backoff first | non-blocking | stands (locked update 551 ms here; the delta vs round 1's 383 ms is my interposer's scan cost) | `logs/B-store-win32-locked.log` |
| N5 | ~60 s `ExtensionStoreBusyError` after a kill (proper-lockfile stale window) | pre-existing | stands (the F/G arms pay the 61 s wait every run) | arm logs |
| N6 | `qwen extensions update` exits 0 on a failed update | pre-existing | not re-tested this round (needs a failing-update CLI run) | — |

### 1. The central delta: a read inside a fault's window (arm F, syscall-level A/B)

Same rig as round 2: `SIGKILL` a copy-mode update mid-flight (journal owes a rollback), then make the restore fail with a genuine non-lock errno (`EACCES` from `chmod -R a-w`; ground truth probed before each run). The control is the **same build with only the `58b49ad2e` hunk reverted** — the two dists differ in exactly `extension-store.js` (+map).

![arm F](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/01-arm-f-fault-window-head-vs-nofix.png)

| after the fault | nofix control (round-2 state) | **`5dbce49dd3`** |
| --- | --- | --- |
| 1st read | raw `EACCES` | raw `EACCES` |
| reads inside the 5 s window | **`OK gen=1`** — while disk holds a tree the rollback never ran (this run: manifest `2.0.0`, 200/200 v2; the snapshot names generation 1) | **`ExtensionConflictError`** (unresolved-transaction text) |
| update inside the window | raw `EACCES` | `ExtensionConflictError` |
| window lapses, fault still present | — (kept serving) | restore retried, raw `EACCES` again, window re-stamped |
| fault cleared + window lapses | heals to v1 (200/200) | heals to v1 (200/200) |
| update after heal | `OK gen=2` (4.0.0) | `OK gen=2` (4.0.0) |

The cell comparison is scripted (`harness/check-fg.mjs`, 20/20 across F and G), so the expected control failures count as passes in the ledger.

The matching unit-level proof: reverting the same hunk in the source turns exactly the two tests the fix extended red, failing on the intended assertion — `promise resolved "{ version: 2, generation: 1 }" instead of rejecting` (the author reproduced the same signature pre-patch). The revert breaks no import, compile or fixture; it fails the behaviour the test exists to catch.

### 2. Superset gate (arm G): unchanged by the fix, as the author claimed

![arm G](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/02-arm-g-held-prune-head-vs-nofix.png)

Restore completes under the holder, the prune of the v2-only `added-dir` is refused (strict `rmdir` of a held directory), and then: reads serve the restored v1 (200/200 v1 bytes, manifest `1.0.0`) **plus the disclosed residue directory**, the journal sits `blocked:true, held:true` inside its window, an update of that destination is refused with `ExtensionDirectoryLockedError` naming the directory, and after the holder lets go the prune completes and the journal clears. Identical at head and on the nofix control — the fix is scoped to the fault class only. (One harness note: the round-2 kill trigger needed `added-dir` to exist before the `SIGKILL`; APFS readdir order made that racy, so the setup now waits for it explicitly.)

### 3. Carried-forward arms, all re-measured at `5dbce49dd3`

![store arms ledger](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/03-store-arms-ledger.png)

| arm | result at `5dbce49dd3` | matches |
| --- | --- | --- |
| B: win32 + lock | **14/14** — copy swap (destination inode unchanged, read off the fs), stale file pruned, uninstall clean, no residue | round 1 |
| D: win32, no lock | **13/13** — rename path | round 1 |
| C: darwin + lock | **6/14** — the fallback never engages off win32; the failure shape is the round-1 Linux control's | round 1 |
| E: win32 + lock + strict `rmdir` | **11/14** — update still succeeds; uninstall degrades to `ExtensionDirectoryLockedError` naming the directory, tree intact | round 1 |
| SIGKILL mid-copy, then recover | **11/11** — journal survives, recovery restores 300/300 v1, store usable after | round 1 |
| permanent `EPERM` (`chflags uchg`) | **9/9** — deferred in the window, self-heals after release | round 1 |
| tree shapes (exec bit, symlink, kind change, dropped dir) | **8/8** through the copy path | round 1 |

Expected control failures are encoded per-arm in `harness/summarize.mjs`; 83/83 assertions pass, 0 unexpected.

### 4. The real CLI under the lock (this also closes the PR's "macOS not exercised" gap)

![CLI](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/05-cli-e2e-under-lock.png)

The bundle from this head (`npm run build && npm run bundle`), an isolated `QWEN_HOME`, the holder process, and the interposer: `install` OK → `update` reports `1.0.0 → 2.0.0` exit 0 (the `winlock.log` names the refusing holder's pid/fd for every refused rename — the lock really engaged) → dropped file pruned, added file present → `uninstall` OK exit 0 → `extension-store/rollback` and `transactions` both empty. The PR body's before/after table reproduced on macOS.

### 5. Mutation probes at this head

![mutations](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11889/pr-11889-round3/04-mutation-probes.png)

Each mutant ran against the full `extension-store.test.ts` (151 tests); the failing sets below are exact and scripted (`harness/check-cli-mutants.mjs`):

| mutation | killed by | reading |
| --- | --- | --- |
| `nofix` — revert `58b49ad2e` | exactly the two extended tests | the fix is load-bearing and its tests are non-vacuous |
| M04 — sort by live mtime | exactly `falls back to mtime order…` | the `utimes` pin is non-vacuous |
| M20 — `orderMs` computed but never persisted | exactly the same test, via the new persistence assertions | the author's addition pins M19/M20 as claimed |
| M06 — `windowRefusal` ignores `rollbackHeld` | exactly the two extended tests | round-2 deferral closed incidentally |

### 6. Gates

- `extension-store.test.ts`: **151 passed / 0 skipped** under a real macOS process — matches the author's non-Windows number and adds the platform the PR matrix marked ⚠️.
- `src/extension/`: 944 tests, all passing — 943 under `--pool=threads` plus `github.test.ts` 158/158 under the default forks pool (its `process.chdir` is unsupported in worker threads; a pool artifact of my run, not this PR).
- `prettier --check` on all five changed files: clean (liveness: a planted format break was reported).
- `tsc --noEmit -p packages/core`: clean (liveness: a planted type error was reported).
- `eslint --max-warnings 0` on the two TS files: clean — but note the repo config did **not** flag a planted module-level unused variable, so this gate is narrower than it looks.
- Landed-content identity with squash `aa03e7a542`: see the opening paragraph. CI at the merge commit: `Test (ubuntu-latest, Node 22.x)` ✅, `Lint & Static` ✅, E2E macOS+Linux ✅; the Windows/macOS unit lanes are skipped on this path, as before.

### Not covered

- A real Windows machine (none here; CI's Windows lane skips this path — the model reproduces the property the fix rests on, not the OS).
- The `EBUSY` child-cwd uninstall shape the PR body itself declares out of scope.
- Round-1's arm A on the merge-base (covered in round 1; this round's control is the same-build-minus-fix, which isolates the delta more sharply).
- The full `packages/core` suite beyond `src/extension/`; Node 22 (this machine runs 25.8.0 — the repo's stated floor is `>=22`, and the merge commit's ubuntu lane ran 22.x green).
- Per-commit attribution across the 17 commits (the aggregate diff plus the delta were verified; the merges were verified content-identical at the boundary that matters).
- N6 (failure exit code) not re-run; M07/M10/M12–M17 not re-run (declared follow-up batch).

### Methodology

macOS 15.7.9 (x86_64), Node v25.8.0. Worktree of `5dbce49dd3` installed with the repo-pinned pnpm (`--frozen-lockfile`, workspace links realpath-verified into the tree) and built in full. The control dist is the same tree rebuilt with only the `58b49ad2e` hunk reverted; the two dists differ in exactly `extension-store.js{,.map}`. Every arm drives the compiled `dist/` against the real filesystem with the interposer refusing renames based on live kernel fd state; every check is a scripted comparison (`harness/summarize.mjs`, `check-fg.mjs`, `check-cli-mutants.mjs`) where expected control failures are encoded as expectations. Harness, raw logs, figures and the interposer source: [wenshao/qwen-code@`assets-pr11889`/`pr-11889-round3`](https://github.com/wenshao/qwen-code/tree/assets-pr11889/pr-11889-round3). Local archive: `tmp/pr11889-verify-20261003-080456/`.
