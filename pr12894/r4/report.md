## Real-stack verification, round 4 (head `f415b565`)

**Verdict: `findings`** — 96 of 97 scripted assertions passed. The one failure is a defect this round found in the new code path (F1, non-ASCII stderr). The delta's own claim is proven load-bearing by an A/B against the round-3 head, and no regression appeared in the 177-test core Shell suite, the 27-test turn suite, the 9-test session-store suite, or the 41-test Java publication suite. Three round-3 findings still stand.

Follow-up to [round 1](https://github.com/QwenLM/qwen-code/pull/12894#issuecomment-5865245134), [round 2](https://github.com/QwenLM/qwen-code/pull/12894#issuecomment-5867075542) and [round 3](https://github.com/QwenLM/qwen-code/pull/12894#issuecomment-5869446068). Verified head `f415b565c6eff7b42c56a68312a494394baa77a1` on merge-base `b32f261a` (16 commits reachable, matching the 16 in the PR metadata). Nothing was patched: every measurement below ran against the pushed head, and each mutation was restored and sha256-verified.

How the 97 are counted, so the numbers are auditable: **71** assertions ran on the head arm (54 in the reported-repro sweep, 13 in the sibling sweep, 4 in the CJK alignment sweep — 70 passed, the 1 failure is F1); **13** are control-arm A/B cells that were *predicted* to go red and did (6 + 4 + 3 across the three sweeps), which count as passes; **13** are mutation outcomes checked against a stated prior (MA/MB/MC/MD, M11/M12b/M13 and the two same-file controls expected killed and killed; M17/M18 and B2R/B4R expected to survive and survived). ME and MF had no stated prior, so they are reported as findings rather than counted either way. Gate baselines (core Shell 177/177, turn 27/27, store 9/9, Java 41/41) are cited as gates and not counted as assertions.


<details>
<summary>中文摘要</summary>

**结论：`findings`（有问题需要处理）** —— 97 项脚本化断言通过 96 项。唯一失败的一项，是本轮在新代码路径上发现的缺陷（F1，非 ASCII 的 stderr）。本次增量的主张已由「与第 3 轮 head 的 A/B」证明是有效的；core 的 Shell 测试 177 项、turn 套件 27 项、session-store 套件 9 项、Java publication 套件 41 项均未出现回归。第 3 轮的三个问题仍然存在。

- **增量范围**：`678420df..f415b565` 只有 4 个文件（`shellExecutionService.ts` 及其测试、两份设计文档）。A/B 两臂只差这一个文件，已用 sha256 与各自的 commit blob 逐一核对。
- **A/B 结论**：第 3 轮报告的复现场景（30 000 行 stdout + 最后一行 stderr）在对照臂丢失、在本 PR 保留；共 13 个可见性场景中对照臂丢 9 个、本 PR 只丢 1 个（即 F1）。持久化捕获字节在两臂完全一致。
- **F1（中等）**：8 KiB 的 stderr 环形窗口若从多字节字符中间开始，`decodeBufferedOutput` 会因为切片不是合法 UTF-8 而退回系统代码页，模型看到的是乱码。CJK 有 2/3 的对齐会中招。根因是既有代码，对照臂同样不可读，所以不是本 PR 引入的回归；但本 PR 新增了这个小窗口并继承了该缺陷。已实测一个 6 行的修复（见下）。
- **F2（较小）**：8 KiB 预留是无条件的，纯 stdout 的命令也要付这个代价 —— 56–64 KiB 的输出从「完整渲染」变成「中间省略」，超过 64 KiB 时尾部从 32 768 字符缩到 24 576 字符。两个数字都没有测试钉住（变异体 ME、MF 存活）。
- **F3（较小）**：在 57 344–65 536 字节这个区间，最后一行 stderr 会被渲染两次。
- **F4/F5（沿用第 3 轮，仍存在）**：回退 B2（LocalDateTime）或 B4（FOR UPDATE），41 项 H2 测试仍全绿；M17、M18 仍然存活（同文件的正向对照均被杀死，证明不是采集不到测试）。
- **未覆盖**：本轮**没有**搭建完整的真实栈（MySQL + Spring jar + 内嵌 Broker + 独立 worker + 打包 Harness + TLS OSS 替身 + 故障代理）。原因是第 3 轮发布的 rig 脚本绑定 macOS 路径，且有三件东西从未发布（Spring `loader.path` 上的 `adapter.jar`、TLS 材料生成方式、`sql.sh`）。因此第 3 轮的问题 1（admission 后崩溃无法恢复）与问题 3（绝对路径 `read_file` 终止回合）本轮用**文件闭包**方式复核而非端到端复测；100 MiB / 1 GiB / 4×256 MiB 并发 / 回执后崩溃这些回归也未重跑。真实 OSS、第二台宿主、Windows/macOS 同样未测。

</details>

### Scope of this round

The delta since round 3 is one commit and four files:

```
678420df..f415b565
 docs/design/…hosted-delivery.md        |  5 +-
 docs/design/…hosted-delivery.zh-CN.md  |  5 +-
 packages/core/…/shellExecutionService.test.ts | 44 +
 packages/core/…/shellExecutionService.ts      | 87 +++---
```

**Central claim**: reserving 8 KiB of the 64 KiB preview budget for a stderr-only ring keeps the final stderr line in the model's view when later stdout floods the shared read-order tail. **Secondary claims**: the durable capture bytes are unaffected; the old no-tool/file-only/v2 behaviour is untouched.

### Previous-finding status at `f415b565`

| # | Finding (round 3) | Severity | Status at this head | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Harness crash after `/admissions/prepare` cannot be recovered (`409 hosted_turn_recovery_required`) | blocker before enablement | **stands, unchanged** | File closure: the delta touches only `shellExecutionService.ts`, its test, and two design docs — the cold-load/admission path is byte-identical to the head round 3 measured. The delta now *documents* it: design §8 gained "The current cold-load entry does not perform that new admission… it remains recovery-blocked until a dedicated entry is implemented and verified." Not re-measured end-to-end (no rig this round). |
| 2 | Final stderr line lost from the model's view | blocker before enablement | **fixed** for ASCII and for aligned non-ASCII; **not fixed** for misaligned non-ASCII (F1) | A/B table below, 13 scenarios on a real subprocess |
| 3 | Absolute-path `read_file` ends the whole turn | blocker before enablement | **stands, unchanged** | Same file-closure argument; the delta records it as a deployment gate in design §13 ("Handle absolute Workspace paths passed to `read_file` as a bounded function error or a verified Workspace-relative mapping before enabling the private Shell profile"). Not re-measured (needs real-model trials). |
| 4 | B2 / B4 have no MySQL regression test | cheap, before merge | **stands** — re-measured | Reverting B2 (`LocalDateTime` lease conversion) or B4 (`FOR UPDATE` on the journal read) leaves all **41** H2 publication/runtime tests green |
| M17 | history id random again — nothing pins stable outcome bytes across a restart | coverage gap | **stands** — re-measured | Survived `hosted-workspace-tool-turn.test.ts` 27/27 green; same-file control killed 1/27 |
| M18 | receipt-commit retry removable | coverage gap | **stands** — re-measured | Survived `http-managed-session-store.test.ts` 9/9 green; same-file control killed 7/9 |

Round 3's ten "fixed and re-measured" rows are not re-run end-to-end here; the same file-closure argument covers the TypeScript ones, and three Java ones were re-measured directly by mutant (below).

### Central claim: A/B against the round-3 head

Both arms are worktrees of this repo, `head` at `f415b565` and `control` at `678420df`, differing by exactly one file — asserted, not assumed:

```
head     packages/core/src/services/shellExecutionService.ts  ce440f4fc0a1be4c…  == git show f415b565:…
control  packages/core/src/services/shellExecutionService.ts  7e1efaea5fe2d19a…  == git show 678420df:…
```

Harness (`harness/s9-stderr-preview.mts`, `s9b-stderr-siblings.mts`, `s9c-cjk.mts`): the **real** `ShellExecutionService.execute` on the child_process path — the only path a `rawCapture` sink can take, since `tools/shell.ts:2781` passes `rawCapture ? false : getShouldUseNodePtyShell()` — driving a **real** `/bin/sh` subprocess at the **production** 64 KiB budget (`tools/shell.ts:2784`). The capture sink is the single stand-in: it records byte-exact stdout/stderr and delays stdout writes, which is what reproduces the mechanism — `captureData()` pauses that stream's pipe and only feeds the preview rings after `rawCapture.write()` resolves, so a slow stdout publication lets an unpaused stderr line enter the rings first and the later stdout flood evict it.

| Scenario (real subprocess, 64 KiB budget) | control `678420df` | head `f415b565` |
| --- | --- | --- |
| 30 000 stdout lines (1 158 894 B) + final stderr line, exit 3, stdout sink 20 ms/chunk — **round 3's reported repro** | **lost** (`errLineOccurrences=0`, preview 65 631 chars) | **kept** in `[Recent stderr]` (preview 57 520 chars) |
| same, stdout sink immediate (0 ms) | kept | kept |
| 10 000 lines, 20 ms/chunk | **lost** | kept |
| 3 000 lines (≈116 KB), 20 ms/chunk | **lost** | kept |
| 1 500 lines (54 393 B — fits the complete window) | kept | kept |
| 200 KiB stderr + 61 KiB stdout | **lost** | kept |
| one single 20 480 B stderr line + 61 KiB stdout | kept | kept, block bounded at 8 207 chars |
| 1 MiB stdout + short final stderr line | **lost** | kept, rendered exactly once |
| 2 000 interleaved stdout/stderr pairs | **lost** | kept |
| stderr with no trailing newline | **lost** | kept |
| ANSI-coloured stderr | **lost** | kept, escapes stripped |
| CJK stderr, 8 KiB window **aligned** (29-byte marker) | **lost** | kept, decodes correctly |
| CJK stderr, 8 KiB window **misaligned** (27-byte marker) | unreadable | **unreadable — mojibake** (F1) |
| durable capture: stderr sha256, both streams `finish(complete=true)`, stdout > 1 MiB | exact | exact, identical sha256 |

Control lost the line in **9 of 13** visibility scenarios; head keeps **12 of 13**. Witness, live re-run of the reported repro on both arms: `01-ab-reported-repro-base-loses-head-keeps.png`.

### Correction to round 3's framing

Round 3 reported this as "the final stderr line of outputs **over 1 MiB** is missing". That size framing is wrong, and it matters because it implies safety below 1 MiB. Measured on the control arm: at **116 KB** (3 000 lines) with a 20 ms stdout sink the line is already lost, and at **1.16 MB** with an immediate sink it is kept. The trigger is **per-stream backpressure ordering**, not total size: the loss needs the stdout publication to be slow enough that stderr enters the rings first. The design doc's own wording ("later stdout cannot bury an error line") is correct; my round-3 "over 1 MiB" threshold was not.

### Findings

**F1 — non-ASCII stderr renders as mojibake in `[Recent stderr]` (moderate).** `decodeBufferedOutput()` asks `getCachedEncodingForBuffer()`, which returns `utf-8` only when `isUtf8(buffer)` is true and otherwise falls back to the system code page / chardet. A ring window that starts inside a multi-byte character is not valid UTF-8, so it decodes as a legacy code page. Measured with CJK stderr of 39 027 bytes and a 27-byte marker (window start ≡ 1 mod 3):

```
head     [Recent stderr]\n■≥И■≥И■≥И■≥И…      markerFound=false   blockCjkDecoded=false
head     (29-byte marker, window aligned)    错错错错错…            markerFound=true
control  (no [Recent stderr] block)                              markerFound=false
```

For 3-byte characters 2 alignments in 3 are broken; for 4-byte emoji 3 in 4. **The cause is pre-existing** — the control arm is equally unreadable on the same input, and the combined read-order tail has the same property — so this is not a regression this PR introduces. What the PR adds is a second, much smaller window that inherits it, which is why the fix does not deliver for non-ASCII output as often as it appears to. Reproduce: `tsx harness/s9c-cjk.mts --tree ./head`.

Measured minimal fix — 6 lines, drop the leading continuation bytes before decoding:

<details>
<summary>suggested patch (measured, not eyeballed)</summary>

```ts
/**
 * A ring-buffer window can start inside a multi-byte character. Such a slice is
 * not valid UTF-8, so decoding it would fall back to the system code page and
 * render garbage; drop the leading continuation bytes instead.
 */
function dropPartialLeadingUtf8(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && i < 3 && (buf[i] & 0xc0) === 0x80) i++;
  return i === 0 ? buf : buf.subarray(i);
}

// at the assembly site:
const stderrPreview = dropPartialLeadingUtf8(
  stderrTail?.read() ?? Buffer.alloc(0),
);
```

</details>

Three measurements with that patch applied to a scratch copy of this head:
1. **hostile fixture goes clean** — T1 misaligned CJK: `blockCjkDecoded=true`, no mojibake, marker found (`FAIL` → `PASS`);
2. **zero collateral** — the 13-assertion sibling sweep is 13/13 and the result JSON differs in exactly **one** row out of 13 scenarios, the S3 `blockSample` note changing from `■≥И…` to `错错错…`; every ASCII and aligned-CJK fixture is byte-identical;
3. **suite counts unchanged** — `shellExecutionService.test.ts` 177/177 green with and without the patch, so the suite pins nothing along this axis; the fixture that would pin it is a misaligned-window CJK case asserting the marker text survives.

Witness: `03-cjk-window-alignment-head-vs-base-vs-fix.png`.

**F2 — the 8 KiB reservation is unconditional, so stdout-only runs pay for it and nothing pins the new numbers (minor).** `completePreviewBytes` moved 65 536 → 57 344 and the read-order tail 32 768 → 24 576, whether or not the command writes any stderr. Measured on stdout-only runs (`04-preview-band-shift-56k-threshold.png`):

| total bytes | control `678420df` | head `f415b565` |
| --- | --- | --- |
| 56 320 | complete (56 320 chars) | complete |
| 57 344 | complete | complete |
| 58 368 | **complete (58 368)** | **middle omitted → 57 441** |
| 61 440 | **complete (61 440)** | middle omitted → 57 441 |
| 64 512 | **complete (64 512)** | middle omitted → 57 441 |
| 65 536 | **complete (65 536)** | middle omitted → 57 441 |
| 66 560 | omitted, tail 32 768 | omitted, tail 24 576 |
| 1 048 576 | omitted, tail 32 768 | omitted, tail **24 576** |

So outputs in the 56–64 KiB band lose their complete rendering, and everything above 64 KiB loses 8 KiB of recent tail — for a run that wrote nothing to stderr and therefore gains nothing. This is the tradeoff the design doc states, so it is a cost to accept deliberately rather than a bug; two notes for that decision. First, the numbers are unpinned: mutants **ME** (`completePreviewBytes = maxBufferedOutputBytes`) and **MF** (tail capacity back to `max - previewHeadBytes`) both leave all 177 tests green, so a future refactor can move the preview budget again silently. Second, the reservation could be made to cost nothing in the common case — the stderr ring only needs its own 8 KiB when stderr was actually seen, and the combined tail could keep 32 KiB whenever `stderrTail` is empty at assembly time.

**F3 — the final stderr line can be rendered twice (minor).** In the 57 344–65 536 band the stderr line is still inside the read-order tail *and* is repeated in `[Recent stderr]`: measured `markerOccurrences=2` on head versus `1` on control (scenario S4, 61 503 total bytes). Above that band the tail has been flooded and it is rendered once (S5, 1 MiB: `markerOccurrences=1`). Cosmetic, but it spends up to 8 KiB of the 64 KiB budget showing the model the same bytes twice.

**F4 — B2 and B4 remain unpinned (carried, stands).** Re-measured by reverting each fix in a scratch copy and running the 41-test H2 suite: B2R (`Timestamp lease = (Timestamp) head.get(…)`) → 41/41 green; B4R (drop `FOR UPDATE`) → 41/41 green. Both fixes are load-bearing on MySQL and invisible to every automated suite in the repo.

**F5 — M17 and M18 remain unpinned (carried, stands).** Both survive at this head with their same-file positive controls killed, so the survival is a coverage gap and not a harness that failed to collect the file:

| mutant | file | suite | result | same-file control |
| --- | --- | --- | --- | --- |
| M17 history id random again | `hosted-workspace-tool-turn.ts` | turn, 27 tests | **SURVIVED** (27 passed) | killed 1/27 (`uses only the original Shell publication after Broker truncated`) |
| M18 receipt commit not retried | `http-managed-session-store.ts` | store, 9 tests | **SURVIVED** (9 passed) | killed 7/9 |

Witness for the whole matrix, including the Java re-measurements: `02-mutation-matrix-delta-and-carried.png`.

### Mutation matrix for the delta itself

Baseline unmutated: `shellExecutionService.test.ts` **177/177 green**. Every killed mutant failed exactly one test — the new `keeps recent stderr visible after later stdout fills the preview tail` — so the delta has no blast radius on the other 176, and the new test is the only thing pinning it.

| mutant | change | result | classification |
| --- | --- | --- | --- |
| MA | full revert of the delta | **killed** — `expected 'HEADxxx…' to contain '[Recent stderr]\nERR: 42'` | the new test is non-vacuous |
| MB | `stderrTailBytes = 0` | **killed** | reservation pinned |
| MC | drop the `[Recent stderr]` marker | **killed** | rendering pinned |
| MD | feed the stderr ring from stdout | **killed** | stream selection pinned |
| ME | `completePreviewBytes` not shrunk | **survived** (177 green) | coverage gap — see F2 |
| MF | `previewTail` capacity not shrunk | **survived** (177 green) | coverage gap — see F2 |

Round 3's Java kills were re-measured at this head and still hold: **M11** (never fence expired `OPEN` grants) → 1 error; **M13** (range bounds not checked as integers) → 1 failure; **M12** → see the note below. Baselines: Java 41/41, turn 27/27, store 9/9, core Shell 177/177.

**Note on M12.** Round 3's M12 mutation reassigns `bytes`, which does not compile at this head (`local variables referenced from a lambda expression must be final or effectively final`), so my first re-run "killed" it with a compile error — a red that proves nothing. Re-run as **M12b**, digesting a re-serialised copy in a new local, it is killed properly: `ToolPublicationStoreTest.finishPreservesTheSubmittedTerminalBytes` fails with `expected: "ddb09734…" but was: "4cffb067…"`.

### Not covered

- **The full real-stack rig was not brought up this round** (MySQL 8.4 + the Spring jar with the embedded Broker + separate worker processes + the packaged Harness + `AliyunToolPublicationObjectStore` against the TLS OSS double + the fault proxy). The rig published with rounds 1–3 is pinned to macOS paths (`/Users/wenshao/…`, `~/Install/mysql-8.4.7-macos15-arm64`), and three pieces it needs were never published: the `adapter.jar` on Spring's `loader.path`, the TLS material generator (`hosts` file + `trust.jks` + certificate for `oss-cn-hangzhou.aliyuncs.com`), and `sql.sh`. Rebuilding those plus the fault matrix did not fit this round's budget. I did build both halves of the stack — `pnpm install --frozen-lockfile` (7 m 21 s) and `mvn install`/`package` for `runtime-broker` + `managed-agent-server` (49 MB boot jar) — so the jar for a future round exists.
- Consequently: findings **1** and **3** are re-measured by file-closure argument, not end-to-end; round 3's regressions (100 MiB + 5 MiB exit 7, 1 GiB ×2, four Sessions × 256 MiB concurrently, crash after the receipt commit) were **not** re-run. The durable path was instead re-measured at the core seam: byte-exact stderr sha256, `finish(complete=true)` on both streams, and > 1 MiB of stdout captured, identical on both arms.
- **This reproduces the mechanism, not the trigger.** The harness replays the per-stream pause/resume ordering with a delayed sink; it does not drive the real HTTP segment POST, the OSS PUT, or the SQL catalog. Round 3's end-to-end observation stands as the trigger evidence.
- Fidelity note on thresholds: my injected 20 ms stdout delay makes the loss appear at 3 000 lines, where round 3's real stack kept it. The A/B is valid (identical harness, one-file difference) but the *size* at which the loss appears is a property of my delay, not of production.
- The MySQL integration profile was not run, so F4 proves B2/B4 are unpinned by H2 — it does not prove MySQL would catch a revert.
- Round 3's TS mutants **M10**, **M14**, **M16**, **M19** were not re-run (M14's file is the one the delta rewrites; MA/MB/MC/MD/ME/MF all exercise its new logic instead).
- Not run: repo-wide `npm run lint`, `npm run typecheck`, `npm run bundle`, the full core/CLI/Java suites, the runtime Broker suite. Only the targeted suites named above.
- No real private OSS bucket, no second host, no cross-host replay — as in rounds 1–3. Linux aarch64, Node v24.14.0 (rounds 1–3 used Node 22), JDK 21, Maven 3.9.0. Windows and macOS not tested.
- Concurrency incident, disclosed: the first launch of my TS mutation runner was left running and mutated `http-managed-session-store.ts` while a second instance executed, which produced one bogus `ANCHOR NOT FOUND` and left the tree dirty. I restored it with `git checkout --`, verified the tree clean, and re-ran both M17 and M18 serially; the numbers above are from the serial re-runs, each with `pre-run tree clean: true` / `post-run tree clean: true`.

### Methodology

Linux aarch64, 12 cores, Node v24.14.0, JDK 21, Maven 3.9.0. Two git worktrees of this repo — `head` at `f415b565` and `control` at `678420df` — with the head's `node_modules` hardlinked into the control (`cp -al`), and the file under test sha256-verified against each commit's blob so the arms differ by exactly one file. Three TypeScript harnesses drive the real `ShellExecutionService` against real `/bin/sh` children at the production 64 KiB budget with a byte-recording capture sink (`harness/s9-stderr-preview.mts`, `s9b-stderr-siblings.mts`, `s9c-cjk.mts`, generators in `harness/gen.py`); mutations were applied by `harness/mut4.sh`, `mut4-ts.mjs`, `mut4-m17.mjs`, `mut4-m18.mjs`, `mut4-java.sh`, `mut4-java-m12b.sh` and the candidate fix by `harness/candidate-fix.sh`, each restoring and sha-verifying the source afterwards. Raw per-arm logs are in `results/` (`s9-{head,control}.log`, `s9b-*`, `s9c-*`, `mut4*`, `candidate-fix.log`, `java-gate.log`, `install.log`, `maven*.log`), the images in `evidence/`, and prior rounds' rig in `prior/`.
