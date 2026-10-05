## Real-environment verification, round 3 — #13291 at `6749534e20`

Follows [round 1](https://github.com/QwenLM/qwen-code/pull/13291#issuecomment-5976679027) at `6661312f9b` and [round 2](https://github.com/QwenLM/qwen-code/pull/13291#issuecomment-5992012476) at `e666889e41`. This round covers only the delta: F3, the other changes in `6749534e20`, and the R1-24 question escalated in the [autofix summary](https://github.com/QwenLM/qwen-code/pull/13291#issuecomment-5995067025). The rig is new and runs on Linux x86_64 with Node 22.22.2; rounds 1–2 ran on macOS arm64.

**Verdict: F3 is fixed, and this round's code adds no new defect.** That includes the real ACP restore path, which neither the PR's tests nor round 2 reached. **Before merging, merge `main`:** CI `Lint & Static` is red at a freshness check, not at a lint error. There are two notes below, one for M6 and one with data for R1-24; neither blocks.

- **F3 fixed, through a real ACP `session/load`.** Crashed logs were reopened by a fresh Managed child, followed by one prompt.
  - S14 and S6: on the **first** open, the new head hands the model the committed result (6/6).
  - The old head, and a bundle mutant of the new head with only the re-read disabled, both hand it the orphan placeholder (12/12).
  - Every arm is correct on the second open, and each open leaves exactly one `tool_result` for the call, so nothing is re-recorded twice.
- **Still holds on all arms:** S4 (never settled) blocks with `managed_runtime_outcome_unknown` on both opens and sends 0 model requests. S7 (`results_consumed`) and a clean close reopen normally.
- **The new unit test catches the regression:** `hands the reopen the history its own repair writes` fails on the old head's code (`Received:` no `functionResponse`) and passes on the new head.
- **R2-12 and R2-21/R2-25 preserve behavior:**
  - `tryParseHarnessCheckpointV1` admits `await_runtime` only with **both** an `in_progress` item and a `dispatch` binding (`managed-harness-checkpoint.ts:1014-1016, 1067-1069`), so the deleted message was unreachable.
  - The early return in `restoreRecordedResults` only skips a scan whose result was unused. S4 takes that branch and still blocks with the same reason text. S14 and S6 take the full branch and repair.
- **Lint gate:** `Check lint gate freshness` failed because `scripts/lint.js` changed on `main` (#12650) after this branch's merge base `5ddfacc9d4`, so ESLint never ran on this head. Local checks:
  - `6749534e20` merges cleanly with `main` `dd82140bcd`.
  - On the merged tree, ESLint `--max-warnings 0` passes on all 27 changed TS files (0 errors, 0 warnings), and Prettier passes on the changed non-Java files.
  - Merging `main` and pushing should clear the gate.

### 1. F3 on the real ACP restore path

![f3](r3-01-f3-real-acp.png)

**How the reopen was driven:**

- **Routing:** the arm's own compiled `createAcpSessionBridge` with `select: () => 'managed'` routes `session/load` to a fresh child of the shipped bundle (`dist/cli.js --acp --acp-execution-engine managed`).
- **Restore path:** the child runs its real `loadSession` → `Config` restore → ACP `Session` → `GeminiClient`.
- **Model:** a counting fake model records the tool messages that the prompt after the load carries.
- **Simulated parts:** reopening a Managed log needs two M6 stand-ins. Both are env-gated in a hard-linked copy of `dist/`, and both are identical on every arm:
  1. Skip `assertLegacySessionExecution` in `loadCliConfig`. The design's "Risks for later slices" already assigns this to M6.
  2. Set the writer reclaim policy to `local` instead of `never` (note A).
- **Crash states:** a `--require` preload in the child SIGKILLs it right after a named commit line is fsynced: `recordToolResult` gives S14, `harness:results_ready` gives S6, `harness:results_consumed` gives S7. S4 kills the child while its `sleep` runs. Every crash state was checked on disk.

### 2. Notes

![reopen and R1-24](r3-02-reopen-lock-and-r124.png)

**A. An ordinary Managed child cannot reopen a crashed Managed log.** This is an M6 prerequisite, not a regression: the reclaim policy predates this PR, with the same line on the merge base and on `main`, and the PR does not touch `acpAgent.ts`, `llm.tsx` or the writer lease. Without the reclaim stand-in, every crash-shaped reopen fails with `session_writer_conflict` ("This session is already open in another Qwen process."). That covers S14 and S4 on both heads, and is shown in panel A.

- **Why:** the leftover lock names the dead child's pid, on the same host and in the same pid namespace. [`acpAgent.ts:15418-15424`](https://github.com/QwenLM/qwen-code/blob/6749534e20b5032b6ce3d6bf431211205ad1edb0/packages/cli/src/acp-integration/acpAgent.ts#L15418-L15424) gives ordinary Managed children reclaim policy `never`. Only Conversations children get `local`, and `--acp-execution-engine managed` refuses Conversations provenance ([`llm.tsx:503-513`](https://github.com/QwenLM/qwen-code/blob/6749534e20b5032b6ce3d6bf431211205ad1edb0/packages/cli/src/llm.tsx#L503-L513)).
- **Effect:** two statements hold at the `Config` layer, whose default policy is `local` and where the PR's tests and round 2 ran. They cannot be reached on the shipped ACP host until something reclaims that lock:
  - the M5b design text "an open after the child crashed — first repairs what the log already proves";
  - acceptance item 4's "fresh open of a crashed child's log".
- **Impact today:** nothing registers Managed before M6, so no user is affected.
- **Suggestion:** add a bullet next to the existing `loadCliConfig` one in "Risks for later slices" (EN + zh-CN): the M6 host must decide who reclaims a crashed Managed child's writer lock. This also affects the deferred R3-2 witness: a `Config`-level crash test will pass while the ACP host refuses the same open.

**B. R1-24: data for the decision.** Round 2's line "F2 now refuses before any write" was imprecise, and the reviewer's probe is right.

- **At the head:** on a session's first call, `ensureCheckpoint()` commits the session's initial `before_model` checkpoint before `managedToolDigest()` refuses (panel B, red).
- **That write is the only one:** there is no intent, no item and no ordinal for the refused call.
- **The digest-first variant**, with the two lines swapped in the bundle, writes nothing for the refused call. The same `before_model` checkpoint then lands at the next call's admission.
- **Same visible result:** both orders produce the same set of commits and the same model-visible messages, and both end the turn with `end_turn` (2/2 runs each).
- **Recommendation:** the choice has no runtime consequence. I'd take option (a) and narrow the comment and test name. It carries no risk, and a blocked log keeps reporting its block ahead of the size error, the precedence the reviewer pointed out. Option (b) also checks out on the bundle. Either is fine for merge.

Unchanged from round 2: a refused oversized call still reaches the model as `Managed Tool JSON exceeds size limit.`, not in the "did not run" form.

### 3. Suites and gates (new head)

![suites](r3-03-suites-gates.png)

| Suite | Result |
| --- | --- |
| core `managed-runtime-outcomes` · `managed-session-log` · `managed-tool-protocol` | 27/27 · 55/56 (1 skipped as uid 0; passes in an unprivileged user namespace) · 84/84 |
| core `managed-harness-factory` · `config-session-execution-engine` | 35/35 · 8/8 |
| core `llm-chat` · `execution-tool` · `local-execution-environment` | 548/548 · 23/23 · 9/9 |
| cli `managed-runtime-session-worker` · `.process` (real children) | 78/78 · 5/5 |
| cli `managed-runtime-tool-worker` · `tool-executor` · `attestation-contract` | 49/49 · 2/2 · 81/81 |
| cli ACP `Session.test.ts` · `acpAgent.test.ts` | 1139/1139 · 842/842 |

CI on `6749534e20`: `Test (ubuntu-latest)` and the Java lanes (ubuntu 11/17/21, macOS, Windows) are green, as are Runtime Broker + Managed Agent MariaDB, Real daemon E2E, Integration (no-AK), Serve A/B, Desktop Shell and TUI parity. `Lint & Static` is red at the freshness check described above. Java code is unchanged since round 2.

**PR body:** two items are stale and could be updated.

- The test plan says `managed-runtime-outcomes` has 15 tests; it now has 27.
- "Risk & Scope" still lists recovery of settled-but-unconsumed turns as M6. The design now keeps only blocked-session recovery for M6.

Evidence (harness, bundle patches in `harness/m6-standins.md`, per-run logs, suite JSON): this directory.
