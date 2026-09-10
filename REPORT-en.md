# PR #11576 — local end-to-end verification

Head `108f07dc42`, base `ac1edef974` (merge-base with `main`). Everything below was run
on Linux against the **built** CLI, not against test doubles: headless `qwen -p`, the real
Ink TUI under tmux, and a real `qwen serve` daemon with the Web Shell, all driven by an
OpenAI-compatible mock that can fail the Goal evidence-checkpoint verifier in each of the
shapes the PR distinguishes. The A/B arm is the same worktree with the PR diff
reverse-applied and rebuilt.

## Verdict

**Recommend merge.** Every behavioural claim in the PR reproduces end to end. Four
findings below; none of them blocks, and F1 is the one worth a follow-up because it lands
on the failure shape the PR's own evidence block advertises.

## 1. The declared checks

| Command | Result |
| --- | --- |
| core `npx vitest run src/goals` | 18 files, **566 passed** — matches the PR |
| cli `GoalPill` + `GoalStatusMessage` + `live-session-model` | 3 files, **86 passed** — matches the PR |
| web-shell `GoalsDialog` + `mappers` + `i18n` | 3 files, **105 passed** — matches the PR |
| `tsc --noEmit` in core, cli, web-shell | clean |
| `prettier --check` + `eslint` on all 24 changed files | clean |

## 2. The stop reason follows the failure shape (real CLI, A/B)

Each arm drives a real Goal until three consecutive checkpoints stall and the runtime
stops it. The mock fails the verifier a different way per arm; the ladder is read back out
of the session journal (`*.ladder` in this branch).

| Arm | `lastCheckpointFailure` on the stopped record | stop reason |
| --- | --- | --- |
| **PR** full claim list (32 claims) | `checkpoint came back with a full claim list (32 claims) while the evidence window overflowed` | `STALLED` — *narrow the objective* |
| **PR** claim cites an unknown source | `InvalidGoalCheckpointError: Goal checkpoint claim 1 cites unknown source e1` | `UNUSABLE` — *the checkpoint model is not returning usable JSON* |
| **PR** provider returns HTTP 500 | `Error: Failed to generate text content (side-query:goal-checkpoint-verifier): 500 mock upstream failure` | `UNREACHABLE` — *resume once the provider is reachable* |
| **PR** verifier never answers (runtime timeout) | `Error: Request was aborted.` | `UNREACHABLE` |
| **base**, all four arms | *(absent)* | the single pre-PR reason, *narrow the objective*, in every case |

All four PR arms still record `limitKind: "evidence_catalog"`, so resume behaves exactly
as before. The base arms are byte-identical to each other — that is the bug #11326
describes.

**A failure that spends no stall is recorded too.** With a window that still had room, a
run reached `turnCount 8` carrying `lastCheckpointFailure` and **no** `checkpointStalls`,
exactly as the PR describes.

## 3. It is visible before the Goal stops

![footer pill and status card before the stop](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-before-stop.png)

At `checkpointStalls = 2` the footer pill reads `checkpoint 2/3 stalled`, and `/goal`
renders `Checkpoint: 2/3 stalled · Error: Request was aborted.` — while the Goal is still
running.

The same moment on base, for comparison — a Goal two stalls from being stopped looks
completely healthy:

![pill A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-pill-ab.png)

And the card after the stop, base above / PR below:

![card A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-card-ab.png)

## 4. The daemon and the Web Shell carry it

Real `qwen serve` on `127.0.0.1:8576`, a session created over `POST /session`, the Goal
driven by `POST /session/:id/prompt`. `GET /goals` returns the two fields inside the
snapshot while the Goal is still active:

```json
{"status": "active", "turnCount": 2, "checkpointStalls": 2,
 "lastCheckpointFailure": "Error: Request was aborted.", "limitKind": null}
```

The Goals view rendered from that daemon — mid-streak above, after the stop below:

![web shell Goals dialog](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/fig-webshell.png)

## 5. `get_goal` and resume

`get_goal` called in the same session after the stop returns both fields in `lastGoal`:

```json
{"active": false,
 "lastGoal": {"status": "usage_limited", "turnCount": 3, "checkpointStalls": 3,
              "lastCheckpointFailure": "Error: Request was aborted.",
              "lastReason": "…the last check failed before the checkpoint verifier answered…"}}
```

`/goal resume` on the evidence-limited Goal clears both fields together with `limitKind`
and `lastReason`, and the next card carries no `Checkpoint:` line:

![resume clears the streak and the diagnostic](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11576/pr-resume.png)

## 6. The new tests are not vacuous — 14/15 mutants killed

One shipped line edited per mutant, only the tests that should notice are run
(`mutate.log` in this branch).

| | mutant | verdict |
| --- | --- | --- |
| M1 | classify every non-checkpoint error as `unusable` | KILLED (3 failed) |
| M2 | a check that found room no longer clears the diagnostic | **SURVIVED** — see F3 |
| M3 | a check that proves nothing drops the previous diagnostic | KILLED |
| M4 | stop reason ignores the last failure shape (pre-PR behaviour) | KILLED (4 failed) |
| M5 | a successful non-stalled checkpoint stops clearing the diagnostic | KILLED |
| M6 | `edit` no longer clears the diagnostic | KILLED |
| M7 | the record parser rejects any record carrying the new field | KILLED |
| M8 | the cap measured in UTF-16 units instead of code points | KILLED |
| M9 | `get_goal`'s `lastGoal` summary drops the diagnostic | KILLED |
| M10 | the footer pill never shows the stall streak | KILLED |
| M11 | the ink status card never shows the `Checkpoint` line | KILLED (3 failed) |
| M12 | the OpenTUI card never carries the `Checkpoint` line | KILLED |
| M13 | the web-shell mapper drops the diagnostic again | KILLED |
| M14 | the Goals dialog never renders the `Checkpoint` line | KILLED |
| M15 | the English `goal.checkpointFailed` string drifts | KILLED |

---

# Findings

## F1 — Important. A verifier timeout records `Error: Request was aborted.`, not the timeout

The PR's Evidence block advertises

```text
"lastCheckpointFailure": "Error: Goal checkpoint verifier timed out after 180000ms"
```

That is what a stubbed verifier throwing the timeout directly produces. Through a real
provider it does not survive. `createGoalCheckpointVerifier` aborts its own
`timeoutController` with that `Error` as the abort *reason*, but the abort reaches the
OpenAI SDK first, which throws its own `APIUserAbortError` with the default message; the
reason is dropped. The record — and the `Checkpoint:` line the user reads — ends up saying:

```text
Checkpoint: 3/3 stalled · Error: Request was aborted.
```

Live, with `model.goalCheckpointTimeoutSeconds: 8`, every one of the three checks recorded
that string. It does not say the check timed out, does not name the ceiling it hit, and
does not name the verifier — for the one failure shape whose whole diagnosis is *how long
it waited*. The classification is still right (`unreachable`, correct advice), and the 500
arm's diagnostic is excellent, so this is not a blocker; but it is the shape the linked
incident is about, and it is the shape the PR body promises to explain.

One-line fix, in the `try` that already has a `finally { clearTimeout(timer) }`:

```ts
} catch (error) {
  // The provider's own abort error erases the reason we aborted for.
  if (timeoutController.signal.aborted) throw timeoutController.signal.reason;
  throw error;
} finally {
  clearTimeout(timer);
}
```

Worth noting as a corollary: the diagnostic's `ErrorName:` prefix only carries information
when the thrown class sets `.name`. `InvalidGoalCheckpointError` does; most provider
errors do not, so they all render as a bare `Error:`.

## F2 — Nit. "The Goal status card shows a `Checkpoint:` line" needs one qualifier

`shouldDisplayGoalStateCause` returns `false` for `'checkpoint'` (unchanged by this PR, and
shared by Ink and OpenTUI), so a stalling checkpoint never *pushes* a card. In a Goal that
just works — no terminal proposal, no pause — nothing appears on the card between `create`
and the stop, which is what I observed: three stalls accumulated with no card in the
transcript.

The claim is still true, just on demand: `/goal` renders the card, and it carries
`Checkpoint: 2/3 stalled · …` mid-streak (screenshot in §3), as does any lifecycle card
(`pause`, `resume`, `verifier_reject`). The always-on before-the-stop surfaces are the
footer pill and the Web Shell, both verified. Suggest softening the sentence in the PR
body and in `docs/users/features/goals.md` to say the pill is what changes on its own and
the card shows it whenever it is rendered.

## F3 — Nit. The `'room'` arm's clearing is the one untested line (M2)

`finishCheckpointCheck` sets `health = outcome === 'room' ? 'clear' : failure`. Replacing
that whole expression with `failure` — so a window that turned out to have room keeps a
stale diagnostic instead of retiring it — passes all 171 `goal-runtime` tests.

The scenario is already set up: `resets the stall streak when a check needs no checkpoint
at all` runs two stalled turns (which leave `FULL_CLAIM_LIST_FAILURE` on the record) and
then a quiet turn that takes the `'room'` arm. It asserts the streak is gone but not the
diagnostic. One line kills the mutant:

```ts
expect(runtime.getSnapshot().goal).not.toHaveProperty('lastCheckpointFailure');
```

## F4 — Nit. The duplicated `GOAL_CHECKPOINT_STALL_LIMIT` has no drift guard

`packages/sdk-typescript/src/daemon/types.ts` re-declares `= 3` with a comment saying it
must match core. Nothing enforces it, and the Web Shell renders the `N/3` denominator from
the SDK copy while the runtime stops at core's value — so a drift shows the user a wrong
limit rather than failing a build. The PR is right that this follows the existing
`GOAL_PAUSE_REASON_COMMAND` precedent, which has no guard either; a single equality
assertion would cover both.

---

## Harness

`harness/` in this branch, with a README covering the gotchas. Four are worth repeating:
a mock that keeps issuing tool calls never ends a Goal turn (the run dies on the per-turn
tool-call cap instead); the window has to overflow on *every* turn, because a successful
checkpoint advances the cursor and resets the streak; a claim must cite a real evidence
uuid **and** its real `proofKind`, or a `full_claims` arm silently becomes an `unusable`
one; and `model.goalCheckpointTimeoutSeconds` makes the timeout arm finish in seconds
rather than 3 × 180 s.
