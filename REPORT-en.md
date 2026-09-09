## Maintainer verification — real environment, base vs PR

I built a local verification environment for this PR and ran the change against real
`CoreToolScheduler` / `Config` / tool instances (not only the colocated unit test), plus a
real Qwen Code TUI session. **The fix is correct, minimal and correctly placed; I recommend
merging it.** One caller-side consequence needs a decision before or alongside the merge —
see Finding 1.

### Environment

| | |
| --- | --- |
| base | `10895031e2` (merge-base of `main` and the PR head) at `/root/git/base11483` |
| PR | `5ab8312f3f` at `/root/git/pr11483` |
| both arms | independent worktrees, independent `npm ci` (no shared `node_modules`) |
| runtime | Node v22.22.2, npm 10.9.7, Linux 6.12.63 x86_64 |

---

### 1. The defect reproduces outside the unit test

A standalone harness imports the **built `packages/core/dist`** of each arm, constructs a real
`Config`, calls `config.initialize()` (33 real tools registered), and drives a real
`CoreToolScheduler`. Batch A holds the scheduler busy with a real tool; batch B is then
scheduled with an `AbortController` that was aborted **before** `schedule()` was called.

| hold on batch A | arm | batch B after 6 s | settled after | `requestQueue` |
| --- | --- | --- | --- | --- |
| `write_file` parked in `awaiting_approval` | base | **pending** | — | **1** |
| `write_file` parked in `awaiting_approval` | PR | rejected — `Tool call cancelled while in queue.` | **≤ 1 ms** | 0 |
| `run_shell_command` parked in `executing` | base | **pending** | — | **1** |
| `run_shell_command` parked in `executing` | PR | rejected — `Tool call cancelled while in queue.` | **≤ 1 ms** | 0 |

The `awaiting_approval` variant is the unbounded one the issue describes: the entry is
released only when a human answers the prompt. Holding the prompt for 20 s and then
answering it, base settled batch B at **t+20010 ms** — i.e. exactly when the unrelated
batch was released, not when the caller cancelled.

![R1](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r1-core-ab.png)

**Soak (N = 200 pre-aborted requests while a real tool executes):**

| | base | PR |
| --- | --- | --- |
| rejected immediately | 0 / 200 | **200 / 200** |
| resolved late | **200 / 200** | 0 |
| `requestQueue` peak | **200** | **0** |
| `onAllToolCallsComplete` batches | **201** (200 late `cancelled`) | 1 (the active batch only) |
| active batch outcome | `hold:success` | `hold:success` |
| unhandled rejections | 0 | 0 |

Base replays 200 stale `cancelled` completions into the caller after the active tool
finishes. The PR emits none, and the active call still completes normally — which is the
behaviour the PR's own test plan asks for.

![R6](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r6-soak-ab.png)

---

### 2. The new regression test is non-vacuous

The PR's test file, unchanged, applied on top of base:

```text
FAIL  src/core/coreToolScheduler.test.ts > CoreToolScheduler
      > rejects a pre-aborted queued request without waiting for the active batch
AssertionError: expected 'pending' to be 'rejected'
```

It fails on base for the reason the bug exists, with the exact assertion the issue predicted.

![non-vacuity](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/nonvacuity.png)

---

### 3. Regressions

| suite | result |
| --- | --- |
| `packages/core` `coreToolScheduler.test.ts` (PR) | **407 / 407** |
| `packages/cli` `useReactToolScheduler.test.tsx` + `useToolScheduler.test.ts` (PR) | **33 / 33** |
| full `npm run preflight` on the PR worktree | **69,908 passed / 12 failed / 110 skipped — all 12 also fail on base** |

The 12 preflight failures are environmental, not PR-attributable, and I re-ran every one of
them on the base worktree to confirm: 10 are permission-simulation tests (`... cannot be
removed`, `unreadable owned lock`, `unlink silently fails`, `glob fails`) that a `uid 0`
sandbox defeats, and 2 are `packages/qwen-live/src/manual/qodercli-acp.test.ts`, which drives
a real external `qodercli --acp` binary (fails with `Invalid params: authId` on both arms).
None of them touches the scheduler.

---

### 4. Mutation matrix

| mutant | core scheduler suite | CLI scheduler suites | verdict |
| --- | --- | --- | --- |
| **M1** remove the guard (= base) | **1 failed / 407** (406 passed) | — | the new test is the only thing that fails, and it does |
| **M2** hoist the guard above `if (this.isRunning() \|\| this.isScheduling)` | **3 failed / 407** | — | the queue-scoping is genuinely protected — see below |
| **M3** change the rejection message | 407 / 407 | 33 / 33 | the message text is pinned by nothing |

M2 is the important one. #11146 warned that moving the check to the top of `schedule()` would
change the idle-scheduler contract; that is not a theoretical concern — three existing tests
fail on that mutant:

```text
× aborts immediately when the parent signal is already aborted before scheduling
× should cancel a tool call if the signal is aborted before confirmation
× pre-aborted signal: terminalizes before validation or execution
```

The PR put the guard in the one place where it does not break them.

---

### 5. Caller audit — every `schedule()` call site

I checked all six production call sites, because the guard only fires when the scheduler is
already busy, and only a *shared* scheduler can be busy:

| call site | scheduler lifetime | can be busy at `schedule()`? | rejection handling |
| --- | --- | --- | --- |
| `agents/runtime/agent-core.ts:2263` | fresh per `processFunctionCalls()` (built at `:1926`, one `schedule()`, no loop) | no | `await` inside `try/finally` |
| `core/nonInteractiveToolExecutor.ts:55` | fresh per `executeToolCall()` | no | `.catch(reject)` |
| `ui/opentui/client-tool-run.ts:108` | fresh per command run (`:85`) | no | `void`, no catch |
| `ui/opentui/live-session.ts:944` | fresh per live turn (`:867`) | no | `void`, no catch |
| `ui/hooks/useReactToolScheduler.ts:229` (normal) | **shared, `useMemo`-lived** | **yes** | `.catch` → dropped when `signal.aborted` |
| `ui/hooks/useReactToolScheduler.ts:246` (full-turn) | **shared** | **yes** | `catch` → synthesises `UNHANDLED_EXCEPTION` |

So the two `void`-without-`catch` OpenTUI sites cannot produce an unhandled rejection from
this guard, and `useReactToolScheduler` is the entire blast radius. That matches the audit
in the issue thread.

---

### 6. Downstream behaviour through the real hook

I drove the **real `useReactToolScheduler`** over a **real `CoreToolScheduler`** held busy by a
real executing call, then scheduled a second request through each caller branch:

| branch | abort timing | base | PR |
| --- | --- | --- | --- |
| normal | pre-abort | no card while busy; late `cancelled` completion after release | **dropped outright** (no card, no completion — the caller swallows it because `signal.aborted`) |
| full-turn | **pre-abort** | no card while busy; late **`cancelled`** completion | **`status: error`, `errorType: unhandled_exception`, card "Full-turn tool scheduling failed. The tool was not executed.", pushed through `onComplete`** |
| full-turn | post-enqueue | **already** `error` / `unhandled_exception` on base | same (`error` / `unhandled_exception`) |

![R4](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/r4-hook-ab.png)

---

### 7. Real TUI session, both arms

I also ran the real `qwen` TUI on each arm against a scripted mock OpenAI-compatible provider,
same script both times: `/approval-mode default` → a prompt → the model calls
`run_shell_command` → **the scheduler parks in `awaiting_approval`**, which is exactly the
`isRunning() === true` precondition this guard is scoped to → `Esc` declines → the turn ends
and the next turn works.

Over the tool-call flow the two transcripts are line-identical; the only diff is the session
start banner and one extra turn I ran on the PR arm. Nothing about the everyday interactive
path changes.

![TUI](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11483/tui-pr-approval.png)

---

### Findings

**Finding 1 — Important, needs a decision. The full-turn caller turns the new rejection into a
synthetic `UNHANDLED_EXCEPTION`.**

`useReactToolScheduler.ts:246-282` catches every rejection from the full-turn
`scheduler.schedule()` and builds `status: 'error'` /
`ToolErrorType.UNHANDLED_EXCEPTION` calls, appends them to `toolCallsForDisplay`, and passes
them to `allToolCallsCompleteHandler()` — which commits the group to history and submits the
error as the tool result. There is no `if (signal.aborted) return` there, unlike the normal
branch at `:229`.

This is #11148, and it is **already live on base** for the *post-enqueue* abort timing (row 3
of the table above — I reproduced it on base). What this PR changes is the *pre-abort* timing,
which on base produced a clean, late `cancelled` and on the PR produces the false error. So
this is a widening of an existing caller bug, not a new class of bug — but for that one timing
it is a strict regression: a user cancellation is recorded as a scheduling failure and sent to
the model.

Reachability is narrow: the full-turn branch is the agent-capable vision-bridge path
(`use-llm-stream.ts:1501/1527` sets a `\0`-suffixed override only when
`getDefaultVisionBridgeModel()?.agentCapable`), so it needs a configured agent-capable vision
model, an image turn, a busy shared scheduler and an abort during `resolveForModel()`. I did
**not** manage to construct that exact race in a live TUI session — the evidence above is from
the real hook over the real scheduler.

Options, in the order I'd pick them:
1. Land #11148's caller fix first or in the same train, then this one.
2. Or accept it: the hang this PR removes is unbounded, the affected path is opt-in, and
   #11148 already tracks the caller.

Either way this is a maintainer call, not something to fold into a core-module PR — AGENTS.md
asks for a tight diff here and the PR delivers one.

**Finding 2 — Minor. The dropped request never reaches a completion callback, so per-callId
bookkeeping in `use-llm-stream.ts` is never released.**

`registerToolBatch()` (`:1074`), `continuationOwnersByToolCallIdRef` (`:3192`) and
`interactionOwnersByToolCallIdRef` (`:3200`) are all populated *before*
`scheduleToolCalls()`, and are only deleted on the completion path
(`:1141`, `:4863-4864`, `:5015-5018`). A request that is rejected before enqueue never
completes, so those three entries stay for the life of the session. The soak run shows the
scale is bounded and small (a `Map` entry per dropped call), and this is **pre-existing** —
the abort-after-enqueue rejection has always behaved this way. Worth a note in #11148 rather
than a change here.

Related and worth stating explicitly because it is what keeps this Minor rather than
Important: on base the late `cancelled` completion also produced a `functionResponse` for the
dropped call, and on the PR nothing does. That does not leave a wire-invalid transcript —
`repairOrphanedToolUseTurns` (`core/llm-chat.ts:1815`, re-run inside `sendMessageStream` at
`:3011` and again from `client.ts:2315`) exists precisely to close a dangling
`model[functionCall]`. The PR shifts this case onto that safety net instead of the completion
path.

**Finding 3 — Nit. The regression test could pin a little more.**

It asserts only that the promise rejected. M3 shows the rejection *reason* is pinned by
nothing, even though matching the `abortHandler`'s wording was a deliberate choice in the
issue thread. Two extra assertions would lock the contract this PR establishes:

```ts
await expect(queuedSchedule).rejects.toThrow('Tool call cancelled while in queue.');
expect(onAllToolCallsComplete).not.toHaveBeenCalled(); // the request is dropped, not drained
```

Not blocking.

---

### Recommendation

**Merge.** The change is three lines in the one branch that lacked the pre-abort check, it is
guarded by a test that fails on base for the right reason, the placement is provably the only
correct one (M2), and no suite regresses. Finding 1 is the only thing I'd want settled first,
and it is a decision about #11148's landing order rather than about this diff.

<sub>Harness, mutants and raw logs: `r1-core-real.mjs` (real dist + real `Config`),
`r6-soak.mjs`, and a real-hook probe over a real `CoreToolScheduler`. Every number above is
from a run on this machine, both arms built from scratch.</sub>
