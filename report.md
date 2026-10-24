**Verdict: `merge-ready`** — 44/44 scripted assertions passed, 0 unexpected failures. Verified head `0e91638207ed336f834347e8ad865b8cc92719df` (base `968df887a7d6a5fcbf77f17ad54a32308adeaf66`). The central claim is load-bearing: on a contended host lock the base build runs **0** Maven commands and dies with the fatal signature, while the head build runs all **3** and only skips the cache write-back.

<details>
<summary>中文摘要（点击展开）</summary>

**结论：`merge-ready`** —— 44/44 条脚本断言全部通过，9/9 个变异体被测试杀死（含 3 个正向对照）。本次验证 head `0e91638207ed336f834347e8ad865b8cc92719df`。

**A/B 结论**：在"宿主锁被兄弟 job 占用"的真实形态下，base 一条 Maven 都没跑就以 `::error::sdk-java host lock not acquired within` 失败（完全复刻 issue 里的事故），head 则跑完整 3 条 Maven、把写回降级为 `::warning::…write-back skipped` 并以 0 退出；锁占用状态实测为 base `111`（套件期间全程持锁）对 head `000`（套件期间完全不持锁）。详见下面的 *Central claim* 表与 `01-ab-cells.png`。

**变异矩阵**：逐条删除 PR 新增的四个保护/回退赋值、`echo` 改写器、写回过滤器，作者自带测试**全部变红**且红在与改动对应的断言上；三个对照变异（删取锁调用、还原播种旧写法、helper 改成 `exit 1`）同样被杀死，证明测试夹具本身有效。

**Findings（均非阻塞）**：① 播种失败时 step summary 仍写 `host cache present at seed: 1`，与"播种成功"无法区分（已用一个 cp 失败的单元格实测）；② `cp -aln` 让 job 本地仓库与宿主缓存共享 inode，套件不持锁运行，凡 Maven 原地重写的文件（PR 自己排除的 `*.lastUpdated` 等正是这类）会绕过锁改动宿主缓存——后果为推断，未跑真实 Maven。

**未覆盖**：真实 ECS 锁队列、真实 Maven/Java/MySQL 套件（本机无 JDK）；与同时打开的 #15289 在 5 个文件上冲突，落地顺序需维护者决定。

</details>

## Central claim

**Claim:** the self-hosted sdk-java test job no longer holds the per-host lock across its Maven suite; it seeds a job-local repository, runs the suite unlocked, and takes the lock only for the optional cache write-back, where an unacquirable lock skips the copy instead of reddening a suite that already passed.

Each cell executes the step's own `run:` bytes (extracted verbatim from that arm's `sdk-java.yml` by a YAML parser, not retyped) under GitHub's shell contract — `bash --noprofile --norc -e -o pipefail <step.sh>` — in the step's own working directory, with the step's own `env:` expressions resolved. The only edit is the lock budget (`5400` → `6 s`), identical in both arms and both jobs, so a contended cell can reach its timeout inside the round; no assertion depends on the literal value.

| arm | job | host lock | exit | mvn runs | lock held during mvn | `::error::` | write-back |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | test | held by sibling | **1** | **0** | – | **1** | n/a (absent) |
| head | test | held by sibling | **0** | **3** | `111` | **0** | skipped |
| base | test | free | 0 | 3 | **`111`** | 0 | n/a (absent) |
| head | test | free | 0 | 3 | **`000`** | 0 | ran |
| base | test | held, no helper | **1** | **0** | – | **1** | n/a |
| head | test | held, no helper | **0** | **3** | `111` | 0 | skipped |
| head | test | free, suite fails | 1 | 1 | `0` | 0 | ran |
| base | mysql | held by sibling | **1** | 2 | `11` | **1** | blocked before copy |
| head | mysql | held by sibling | **0** | 2 | `11` | 0 | skipped |
| base | mysql | free | 0 | 2 | `00` | 0 | ran (leaks 3) |
| head | mysql | free | 0 | 2 | `00` | 0 | ran (leaks 0) |
| head | mysql | free, gate fails | 1 | 1 | `0` | 0 | ran |

`lock held during mvn` is one digit per Maven invocation, measured by the Maven stand-in taking `flock --nonblock` on the real lock file from a separate process. `111` → base holds the host lock across the whole suite (the starvation source); `000` → the head suite runs completely unlocked.

The two arms therefore differ by exactly the change under test: **0/1 → 1/1** cells run Maven under a busy lock, and the fatal signature disappears while the skip stays observable. Witness: `01-ab-cells.png`.

## Findings

Both are Suggestions; neither is a merge condition. Neither is a defect in a changed line's own intent — they bound what the change can see and what the lock now covers.

### 1. The seed diagnostic cannot distinguish "host cache present" from "seed succeeded" (Suggestion, measured)

`SDK_JAVA_M2_SEED_EXISTED` is computed from `[ -d "${HOME}/.m2/repository" ]` only, and the copy itself is `cp -aln … 2>/dev/null || true`. I ran the head test step with a `cp` stand-in that fails on the seed call and everything else real:

```
exit 0, Maven runs 3
summary: … host cache present at seed: 1
job-local repo entries: []          # the seed copied nothing
```

So on a host whose cache directory exists but whose copy fails (ENOSPC, read-only, a reaped path mid-copy), every Maven run re-resolves through the egress proxy — the exact cost the step's own comment says the seed avoids — and the one diagnostic line a postmortem reads still reports `1`. Reporting "nothing found" and "could not measure" as the same value is the same class the report contract forbids this round: the flag is consumed by a human, so a failed probe reads as a healthy seed.

Suggested shape: capture the copy's exit status (`seed_status=$?`) and write `host cache present at seed: <present>/<copied>` (or `unknown`), leaving the behaviour best-effort.

### 2. Hardlinked seed files are writable while the suite holds no lock (Suggestion, mechanism measured, consequence inferred)

`cp -aln` makes the job-local repository share inodes with the host cache. Measured on a fresh seed:

```
com/example/seed.jar  host inode == job-local inode  (nlink 2 on both sides)
write through the job-local path -> host file content changed
```

The suite now runs unlocked, so any in-place rewrite of a seeded file mutates `~/.m2/repository` without the lock, where the base arm held it for the same writes. The PR's own exclusion list is the evidence that such rewrites happen: `*.lastUpdated`, `resolver-status.properties` and `*.tmp` are excluded from publication precisely because they churn, and a seeded one is rewritten in place rather than replaced. Impact is bounded — these are resolver metadata markers, not artifacts, and the write-back itself cannot corrupt anything (`cp -ln -n` never replaces a host file) — so I am **not** claiming the lock's guarantee is restored by that; I am claiming the lock's coverage narrowed for this one file class. The consequence is **inferred**: there is no JDK/Maven on this host, so I did not drive a real resolution. Bounding what does *not* hold: artifact publication is still locked, and a skipped write-back leaves the next job re-resolving rather than reading a truncated file (`03-write-back-delta.png`).

### 3. Overlapping open PR — sequencing note, not a defect (Suggestion)

`#15289` (`fix/cli… autofix/issue-15285`, head `0f9a58a79`) is open against the same lock/write-back code. A trial merge of the two heads conflicts in **5 files**: `sdk-java.yml`, `.size-baseline`, `scripts/tests/sdk-java-workflow.test.js`, and both design docs. Whichever lands second needs a rebase plus a `.size-baseline` regeneration (this PR already re-baselines `sdk-java.yml` at 125,493 bytes). Flagging so the merge order is a decision rather than an accident.

## Verification of the author's own suite

I ran the PR's stated gate at head: `npx vitest run scripts/tests/sdk-java-workflow.test.js scripts/tests/sdk-java-lock.test.js scripts/tests/workflow-size.test.js` → **390 passed, 1 skipped**. Mutation matrix through the same runner, one guard removed at a time in a scratch copy, restored after each run (baseline re-run green: 137 workflow tests, 15 lock tests):

| mutant | result |
| --- | --- |
| M1 remove the test-job write-back skip guard | KILLED (6 skip tests) |
| M2 remove the test-job fallback `lock_status=1` | KILLED (2 fallback tests) |
| M3 remove the mysql write-back skip guard | KILLED (6 tests incl. the once-around-the-write-back pin) |
| M4 remove the mysql fallback `lock_status=1` | KILLED (2 fallback tests) |
| M5 drop the `::error::` → `::warning::` `echo` override (both sites) | KILLED (7 helper tests) |
| M6 drop the `*.lastUpdated` write-back filter | KILLED (`locks only the cache write-back…`) |
| M7 **control** delete the ticketed acquisition | KILLED (as designed) |
| M8 **control** helper `exit 1` instead of `return 1` | KILLED (`returns after a timeout…`) |
| M9 **control** revert the seed to the nesting old spelling | KILLED (`seeds a pre-existing…`) |

9/9 killed, each attributed to the assertion the change exists to pin — the PR's claim that removing "either best-effort guard or either bare-lock fallback assignment" turns the new tests red holds. The three controls establish that the runner can see a difference in this file. Witness: `02-mutation-matrix.png`.

One harness note, because it is the kind of number that would have been wrong: my first M1 mutation ate the next line's block-scalar indentation, so the suite failed at YAML **parse** time with 0 tests collected. That is a red that proves nothing; the matrix only counts a kill when a *named assertion* fails, which is why the first pass reported `UNATTRIBUTED` instead of a kill.

## Not covered

- **The real ECS host-lock queue and the real slave/leg contention** — no self-hosted runner here. The contention cell models the incident's shape (a sibling `flock` with no ticket), not the pool-wide queue.
- **Real Maven/Java/MySQL execution** — no JDK or Maven binary on this host, and the PR itself says CI is the final gate for those. Every Maven invocation is a stand-in recording argv, working directory, and lock state; the `.m2` wiring is exercised as file-tree mechanics, not as resolution.
- **`workflow-size.test.js` re-baseline** — the gate passed; I did not independently recompute that 125,493 is the exact byte length, because the test itself recomputes it from the file.
- **Design-doc parity (EN/ZH)** — read only for consistency with the code, not reviewed for translation completeness.
- **The overlap with #15289 beyond the conflict list** — whether the two fix the same root cause differently was not adjudicated.
- **Per-commit attribution** — the PR carries 9 commits (4 merges); this round verifies the aggregate head diff, not each commit's claim.

## Methodology

Worktrees at `base 968df887` and `head 0e916382` under `tmp/`, sharing the installed `node_modules` by hardlink (lockfile byte-identical to the installed tree, so no dependency confound; neither arm touches `package.json`/`pnpm-lock.yaml`). `extract.py` pulls each lock-bearing step's `run:` and `env:` out of that arm's `sdk-java.yml` with a YAML parser; `ab.mjs` builds one sandbox per cell (`HOME`, `RUNNER_TEMP`, workspace, `PATH` stubs), holds the real lock with a sibling process for contended cells, and asserts in `assert.mjs`. Raw logs per cell live in `cells/<cell>/`, `cells.json`, `mutants.json`, `probe.json`, `assertions.log`. Every number above is generated from those files. Harness scripts: `extract.py`, `ab.mjs`, `mutate.mjs`, `probe.mjs`, `assert.mjs`, `evidence.mjs`.
