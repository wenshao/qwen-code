## Local real-environment verification, round 2 — #13311 @ `2f2298bc`

This round covers only what changed. [Round 1](https://github.com/QwenLM/qwen-code/pull/13311#issuecomment-5972400753) verified `8daf1f67` on macOS. This round verifies `2f2298bc6e` on Linux and covers:
- round-1 F1 and F2;
- the R1-x fixes;
- the round-2 review suggestions (R2-x);
- the Linux-only failover modes that round 1 could not run.

**Verdict: mergeable.** Round-1 F1 and F2 are closed at this head, and each R1-x fix behaves the way its reply describes. Every open item is non-blocking:
- R2-1, R2-2 and R2-5 from the round-2 review, all reproduced here;
- **N1**, a new pre-existing finding (below). I suggest tracking it as a follow-up rather than gating this PR on it.

| Item | Result at `2f2298bc` |
| :-- | :-- |
| F1 (R4-1 append half) | ✅ **closed.** N=24/28/40 are refused in 0.2–0.3 ms with a typed `ManagedSessionRecordError`, 0 bytes written, 62 MB RSS, and the log reads back. The round-1 head on the same probe: refused after 1.9 s / untyped `RangeError` after 26.5 s / no return within 90 s (card 1) |
| F2 (shared chain one level stricter) | ✅ **closed.** A shared 60-chain at exactly depth 64 is accepted, like its unshared and round-trip copies. 61 is refused in all three forms (card 2) |
| R1-11 / R1-9 / R1-5 guards | ✅ A `turn` payload subject and a self-naming `sourceEventId` are refused before any byte is written. `hook_operation` stays legal. All five single-field subject mismatches are refused (card 2) |
| Real stack, Linux | ✅ 11/11 runs exit 0: `--session-failover` ×3, `--inflight-failover` ×4, `--continuation-failover` ×4, head and base interleaved (card 4) |
| Stricter reader vs real producers | ✅ Those runs produced 275 Session Store transactions (147 head-written, 128 base-written). Replayed through base, round-1 head and this head: 825/825 OK. None of the new refusals fired on a real record (card 4) |
| Test strength of the delta | ✅ 15/19 mutants killed, including every records- and inbox-level witness the replies claim. The 4 survivors are exactly R2-1 ×3 and R2-2 (card 5) |
| R1-6 exhaustiveness | ✅ Adding a 4th subject variant now fails with `TS2322` at `managed-session-records.ts:647`. On the round-1 head the same edit compiled silently |
| Gates | ✅ `src/managed-runtime` + `src/config/managed-session-log.test.ts`: 35 files, 1988 passed / 1 skipped. Core `tsc --noEmit`, ESLint (`--max-warnings 0`) and Prettier are clean on the 5 changed files. CI is green, including *Hosted process fault gates / MySQL 8.4* |
| R2-1 (bound arithmetic, aggregate) | ⚠️ **Reproduced.** The largest single DAG accepted serializes to 49,332,473 real bytes, 5.88× the bound its message names. A 256-event `appendExecution` costs 6.8 s and 1.4 GB. With NUL leaves the same call **aborts the process with a V8 heap OOM**. Base and the round-1 head do the same, so this is not a regression (cards 1, 6) |
| R2-5 (weak matcher) | ⚠️ **Reproduced.** With `expectedSequence: 0` the new authority test still passes. The message matcher detects that, and it passes on the unmodified head (card 5) |
| **N1 (new)** depth write/read asymmetry | ⚠️ Pre-existing since #12302: a record at the depth limit commits, and afterwards the session log can no longer be cold-reopened (card 3) |
| Cost on unshared input | ℹ️ About +20 % on large trees: +55 ms per 7.7 MB record body, +5 ms per 0.9 MB event. Most of it was already in the round-1 head (card 6) |

### N1 — a record at the depth limit commits, then the log cannot be reopened (new, pre-existing, non-blocking)

The write path and the read path count depth from different roots:
- **Write:** depth is bounded from the **event**: `assertJsonValue(value, 'event')` at `managed-session-records.ts:1148`.
- **Persist:** the line wraps that event in the record envelope: `createRecord(MANAGED_SESSION_EVENT_SUBTYPE, event, …)` at `managed-session-authority.ts:2137`, handed to `journal.appendTransaction` at `:2152`.
- **Read:** both readers bound depth on the **line**. `parseManagedSessionRecordJson` → `assertNoDuplicateJsonKeys` (`managed-session-records.ts:1571`) is called from `managed-session-storage.ts:210` and from `http-managed-session-store.ts:1189`.

An event whose deepest object sits at exactly 64 is therefore persisted as a line nested 65 deep, and every later reopen fails.

Reproduced on the real authority (base and head behave the same):
1. A `cancel.requested` with an unshared 60-object chain under `target.shell.first` commits.
2. The next append in the same process commits too.
3. `close()` followed by `LocalManagedSessionAuthority.open` fails with `record exceeds the maximum JSON depth of 64.`
4. With a 59-object chain, the reopen succeeds.

The live writer never notices, so the log is poisoned silently, and the session is lost at the next restart or failover.

Scope:
- **Not introduced here.** Base does the same for unshared input.
- **Latent today.** The only free-form `json` field is `cancel.requested.target` (`managed-session-records.ts:789`), and no production code emits `cancel.requested`.
- **Touches this PR's arithmetic.** The F2 fix now admits the shared form too, and the new test asserts "60-chain accepted at exact 64" at the event level. That shape cannot be read back once it is persisted.

Two possible fixes (neither tested):
- (a) Run the reader's line check on each record before `journal.appendTransaction`, so the writer cannot persist a line the readers refuse.
- (b) Start the event-level walk at depth 2 so it counts the envelope. The 60/61 test pair would then move to 59/60.

Either one fits a follow-up issue. I would not hold this merge on it.

### Before merging (suggested)
1. Update the description per R2-4. It still says "Sharing stays legal" and that a non-activation payload subject stays legal. It does not mention the three refusal classes this head adds: the shared-expansion bound, the `turn` payload subject, and the self-naming `sourceEventId`.
2. Optionally take the one-line R2-5 matcher (`/expands past .* bytes through shared references/`). It passes on the unmodified head (card 5).
3. File N1 and the R2-1 aggregate as follow-ups. Neither is reachable from a production append path today.

### Not covered
- **No hosted append of an N1-shaped record.** Only the local log was driven. The HTTP reader's line parser is shown refusing the same line offline.
- **No cross-version in-process failover** (base owner → head replacement). Cross-version reading was checked by offline replay of the dumped journals.
- **No paid model.** All E2E modes used the script's fake OpenAI server.

### What I ran
- **Arms:** base `5ddfacc9`, round-1 head `8daf1f67` and head `2f2298bc`.
  - Base and head each got their own `pnpm install --frozen-lockfile` + full build + bundle.
  - Round-1 head: dependencies hardlinked from the head, plus core `tsc --build`.
- **Spring jar:** built from the head with a private Maven local repo. `packages/sdk-java` is identical on both arms.
- **Real stack:** `scripts/run-managed-agent-server-e2e.ts` (keep-tmp copy), JDK 21.0.12, MySQL 8.4.11, and each arm's own `dist/cli.js`. Afterwards `qwen_managed_session_journal_tx.record_bytes` was dumped from every kept datadir.
- **Probes:** each arm's built `LocalManagedSessionAuthority` on a real writer lease and JSONL journal, plus its `parseManagedSessionEvent` / `parseManagedSessionRecordJson`.
- **Mutants:** one vitest run over `src/managed-runtime/__mut__/` in a hardlinked copy of the head. Tracked files were not touched.
- **Host:** Linux x86_64, 16 cores, Node 22.22.2.

**Evidence:** the harness, raw logs and all 11 E2E logs are in [this directory](.) (`harness/`, `data/`).

**Card 1 — F1 closed; R2-1 aggregate**
![F1](01-f1-append-path-closed.png)

**Card 2 — F2 closed; new guards**
![F2 and guards](02-f2-and-new-guards.png)

**Card 3 — N1 depth write/read asymmetry**
![N1](03-n1-depth-write-read-asymmetry.png)

**Card 4 — real stack on Linux and journal replay**
![real stack](04-real-stack-linux.png)

**Card 5 — mutation matrix, R2-5, gates**
![test strength](05-test-strength.png)

**Card 6 — R2-1 arithmetic and the memo's cost**
![arithmetic and cost](06-bound-arithmetic-and-cost.png)
