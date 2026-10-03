<!-- PR #10916 maintainer verification, round 2, head 3fb6a1f042; posted as a PR comment -->

## Maintainer verification, round 2 (delta only) @ `3fb6a1f042`

Round 1 was [5918529257](https://github.com/QwenLM/qwen-code/pull/10916#issuecomment-5918529257) at `965900af`. This round covers only what changed since then and what round 1 left open.

**Verdict: round 1's blocker is fixed, but this is still not mergeable as-is.**
- **Fixed and verified in real sessions:** R6-1 (round 1's blocker), R11-1 and R11-2. Each has a negative control.
- **Must be fixed before merge: R7-1.** Round 1 did not evaluate it. I reproduced it end to end and it is reachable. A verified 11-line patch is below.
- **Still needs a maintainer ruling: item 2 from round 1.** Productive headless runs still end with exit 1 and no answer. This round measured a fourth case in a real session: unrelated shell timeouts.

### Setup

| Arm | Commit |
|---|---|
| `main` | `origin/main` `a011f66944` |
| `pr` | `3fb6a1f042` merged with `a011f66944` → `09741fcd71` (clean merge) |
| `pr + fix` | `pr` + [`fix-r7-1-agent-history.patch`](harness/fix-r7-1-agent-history.patch) |
| negative controls | a copy of `pr`'s built bundle with exactly one fix reverted |

- Each arm had a real `pnpm install --frozen-lockfile` and `npm run build && npm run bundle`.
- The harness is the same as in round 1. The model is a scripted OpenAI-compatible fake server.
- Everything else is real:
  - shell, `git` and the file tools
  - a stdio MCP server
  - background agents, teammates and a SubagentStop hook
  - headless `qwen -p --approval-mode yolo`
  - the TUI (node-pty + xterm.js)
  - `qwen --acp`

### Fixed since round 1

| Item | Fix | Real session on `pr` | Negative control | Unit test |
|---|---|---|---|---|
| **R6-1** (round 1 blocker): a mid-turn steer reached the model twice after a halt | `cd82572d25` (patch B, applied unchanged) | TUI, 3 of 3 runs: the steer appears **once** in every request after the halt, `[0,0,0,0,0,1,1,1,1,1]`. This is identical to round 1's patch-B arm. Round 1's `pr` sent it twice from the halt on (Fig. 1). | round 1's `pr` arm | Removing the `accept()` makes `settles a steer carrier written by the halt …` fail (1/480) |
| **R11-1**: an MCP payload that quotes ` with response: ` collapsed distinct failures | `56bd035e48` | A real stdio MCP gateway returns three **different** upstream failures that all end in `… with response: 502 Bad Gateway`. `pr` answers after 8 requests, exactly like `main`. | With `lastIndexOf` restored, the same session halts at request 5 with exit 1 | Reverting the split fails 1/173 |
| **R11-2**: the agent-runtime streak outlived a prompt | `56bd035e48` | A real background agent gets 2 identical errors, then answers. `send_message` starts a new prompt, which gets 1 more identical error. Result: `completed` on `pr` and on `main`. | With the immediate-drain `clearToolErrorStreaks()` removed: `failed`, `Agent terminated with mode: LOOP_DETECTED` | See below |

The R11-2 unit tests only cover one of the two clears:
- The post-wait clear (`agent-core.ts:1411`) is covered: removing it fails 1/76.
- The immediate-drain clear (`agent-core.ts:1385`) is **not** covered. If I delete it, `src/agents/runtime` stays green (1376 passed). This confirms the item deferred in round 12. Right now the only test that catches it is this round's S13 session.

The detector still fires where it should:
- S1 (the issue shape) halts at request 5; `main` makes 14.
- An MCP dead end (varied args, one identical payload) halts at request 5; `main` makes 8.

![Fig. 1: R6-1 fixed. The steer is recorded once before the halt notice, and the follow-up request carries it once.](fig1-tui-steer-once.png)

### Still open

**1. [Fix before merge] R7-1 reproduced end to end, through a SubagentStop hook.**

How a halted subagent gets a second send on the same chat:
- The halt breaks out at `agent-core.ts:1353`, before `currentMessages = toolCallResult.messages` at `:1356`. The results of the halting round are never written to the chat.
- `runSubagentStopHookLoop` (`agent.ts:2026`; the same code is in `background-agent-resume.ts:1944`) does not check the terminate mode. When a user's SubagentStop hook blocks, it calls `subagent.execute()` again on the **same** chat (`agent.ts:2090`).
- That send runs `repairOrphanedToolUseTurns` (`llm-chat.ts:5801`), which fills the missing results with `ORPHAN_TOOL_USE_REPAIR_REASON`.

What I ran (S12, Fig. 2):
1. A foreground subagent runs `git log` and `git status`. Both fail with exit 128.
2. Its third round runs `write_file notes.txt`, which **succeeds** (the file is on disk), and `git branch -a`, which is the third identical exit-128 failure. The guard halts the subagent.
3. A user SubagentStop hook blocks once: "confirm that notes.txt was saved".
4. In the continuation request, both calls from step 2 are paired with `Tool execution result was not recorded — likely interrupted by network failure, abort, or process exit. Treat as failure and retry if needed.`

On `main`, the same request carries `Successfully created and wrote to new file` and the real `git` output. In other words, the model is told that a write which succeeded was lost and should be retried.

The halt is this guard's:
- In a run with `--telemetry-outfile`, the halt is logged as `loop_detected` with `loop_type: repeated_tool_error`. Its `prompt_id` is the subagent's (`…#general-purpose-call_l0`).
- S12 halted in 2 of 3 `pr` runs. In the third, round 2 hit the `Output: (empty)` glitch (item 3), which reset the streak, so the guard never fired.

![Fig. 2: R7-1 on main, pr, and pr + fix](fig2-r7-1-wire.png)

These paths do **not** reach a second send on the halted chat. I measured or traced each one:
- **Team teammate (measured):** `TeamManager` only delivers to IDLE agents (`TeamManager.ts:2076`). After the halt the teammate is FAILED (`agent-interactive.ts:425`). The leader's `send_message` gets `Teammate "worker" is no longer active and cannot receive messages.`
- **Agent-view composer (traced):** queued messages for a FAILED agent are dropped (`AgentViewContext.tsx:203`).
- **`send_message` to a background agent (traced):** after LOOP_DETECTED the agent is marked failed (`agent.ts:4031`), so `send_message` returns `Cannot send messages to stopped tasks` (`send-message.ts:343`).

So the trigger the R7-1 thread describes, queued teammate messages, does not seem reachable today. The hook path is.

This break-before-record shape already existed for the #9450 stateful-read halt at the merge base (`agent-core.ts:1340`). This PR makes the halt always on for ordinary failures, which is why it fixed the same gap on the client side (`client.ts:4676`). The agent runtime needs the same fix.

The fix records the round's results before breaking, mirroring `client.ts`:
```diff
           if (terminateMode === AgentTerminateMode.LOOP_DETECTED) {
+            // This round's calls already executed — files were written,
+            // commands ran — but breaking here skips the send that would put
+            // their results into history. Record them, as the client-side
+            // halt does (client.ts), so the model's functionCall turn stays
+            // paired: left dangling, a later send on this chat (a blocking
+            // SubagentStop hook continues it) runs the orphan repair, which
+            // tells the model those calls were lost to a crash and should be
+            // retried — including the ones in this batch that succeeded.
+            for (const content of toolCallResult.messages) {
+              chat.addHistory(content);
+            }
             break;
           }
```
How I verified it:
- **S12 with the patch:** the continuation request carries the real results (Fig. 2).
- **New unit test:** the halting round's `functionResponse` is written to history.
- **Negative control:** reverting only the `agent-core.ts` hunk makes the new test fail (1/77).
- **Wider suites:** `src/agents/runtime` + `loopDetectionService` + `client` all pass (2030 passed, 7 skipped).
- **Static checks:** core `tsc --noEmit`, `eslint --max-warnings 0` and prettier are all clean.
- **Applies cleanly** to `3fb6a1f042`.

The patch only makes the history truthful. Whether a SubagentStop hook should be allowed to continue a run the guard halted is a separate question that I have not ruled on.

The patch with its test is in [`harness/fix-r7-1-agent-history.patch`](harness/fix-r7-1-agent-history.patch).

**2. [Needs a ruling before merge; unchanged since round 1, plus one new case] Productive headless runs still end with exit 1 and no answer (Fig. 3).**

Re-run at this head, each still exits 1 on `pr` while `main` returns the answer:
- **S3b:** a user deny rule on `run_shell_command(npm *)`.
- **S8:** silent exit-1 probes.
- **S4:** an edit → re-run loop.

**Newly measured this round, S10:** three *different* commands each hit the same explicit shell `timeout: 3000`. This is Entrance B of the R1-1 [thread](https://github.com/QwenLM/qwen-code/pull/10916#discussion_r3944127927); the author confirmed the mechanism there, and this is its first run in a real session.
- The error the model sees is `Command timed out after 3000ms before it could complete.` (`shell.ts:2978`). It does not identify the command.
- So the three timeouts fingerprint identically, and `pr` exits 1 at request 5. `main` finishes with its summary.
- A command does not need an explicit timeout to hit this. Without one, every foreground command gets the same 120000 ms default (`shell.ts:2415`), so any three unrelated commands that each run longer than 2 minutes produce the identical message.
- Round 12 deferred the same failure mode again, as a probe at `loopDetectionService.ts:836`.
- The scheduler-level timeout (`coreToolScheduler.ts:479`) carries no tool identity either. I did not run that one.

There is still no headless off-switch and no threshold setting. My round-1 recommendation stands. Either or both of:
- (a) **Stop counting evidence that is not an error message:** policy denials (`not_started`), timeouts, and silent exit-1 answers.
- (b) **Ship a threshold setting**, with 0 = off.

![Fig. 3: headless A/B at this head](fig3-headless-ab.png)

**3. Unchanged; follow-ups, not re-argued here:**
- **ACP:** I replayed S1 through a real `qwen --acp` session. It runs 14 requests and ends with `end_turn`, the same as `main`. The guard is still not wired into ACP or the daemon.
- **R4-2 (quoted digest):**
  - S7 runs **different** failures (exit codes 1–4) whose output each quotes a digest line. One of four `pr` runs halted after three requests.
  - The other three runs hit the intermittent `Output: (empty)` shell glitch from round 1. Across the four runs, 5 of 15 commands came back empty under load, and an empty result resets the streak. The glitch was also seen on `main` and is not caused by this PR.
- **Visible change:** the `Full output sha256:` line on every failed shell result is still visible and still undisclosed.

### Gates

| Check | Result |
|---|---|
| Full `packages/core` suite, both arms | `main` 34,095 passed / 6 failed; `pr` 34,134 passed / 6 failed (+39 tests). The **failure set is identical**: 6 root-user / timing environment tests. |
| Focused core suites on `pr` | 11 files, 1926 passed (loopDetection, client, agent-headless, agent-core, shell, truncation, finalizer, loggers, qwen-logger, log-to-span, scheduler) |
| `packages/cli` `nonInteractiveCli` on `pr` | 180 passed, 1 skipped (`main` has the same skip) |
| CI at `3fb6a1f042` | Green. `Test (windows/macos)` and `Integration Tests (CLI)` were skipped. |

### Not verified

- The scheduler-level timeout, end to end.
- R11-2's post-wait branch end to end. It needs a monitor-held background agent; its unit test covers it.
- Windows, macOS, OpenTUI and a `qwen serve` daemon run.

### Evidence

Everything is in this directory:
- the new scenarios, the MCP server and the hook script
- the R7-1 patch
- the figure sources
- `data/results.json` with per-run outcomes and the tool results the model saw

Round 1's harness is unchanged in `pr-10916/`.
