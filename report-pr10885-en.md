## Local end-to-end re-verification at `c682c618` (real daemon + real Web Shell, PR vs merge base)

I verified this PR locally once before, at `bf4e49d` ([comment 5524238558](https://github.com/QwenLM/qwen-code/pull/10885#issuecomment-5524238558)). Ten review rounds and ten fix commits have landed since. The last two commits — `eb86348329` *fix(cron): harden one-shot restoration* and `6ddb06d726` — landed **after the final review round**, and the two review runs since then both timed out, so no round has ever looked at them. This pass re-verifies the feature at the current head and, specifically, whether those last commits close the Criticals that are still standing in the review ledger.

**Setup.** Two worktrees (head `c682c618`, merge base `5014a091ab`), each `npm ci`-built to its own `dist/cli.js`; each running its own `qwen serve` daemon over an isolated `QWEN_HOME` with two workspaces (`--workspace A --workspace B`) and three `modelProviders` entries backed by a scripted OpenAI-compatible server that logs the exact `model` field of every request; Chrome driven through Playwright against the daemon's own Web Shell. Every model assertion below is read off the **wire**, every group assertion off `session-organization.v1.json`, and every schedule assertion off `scheduled_tasks.json` — not off the UI.

**Verdict: merge-ready.** Every feature claim reproduces, on both dispatch paths and in both workspaces. Of the five Criticals still open in the review ledger, **three are closed at this head** — two of them by `eb86348329`, which landed after the last round that could have seen it — and I could not re-open any of them. The other two do reproduce; both fail closed, neither loses data, and I describe their blast radius below. Separately, the one behaviour I flagged in round 1 and would still like fixed is unchanged.

---

## 1. The five Criticals still standing in the ledger

| Ledger entry | Status at `c682c618` | Evidence |
| --- | --- | --- |
| `Session.ts:8845` — a consumed one-shot is silently destroyed when its model fails to apply | **Closed** | Live wall-clock fire (1a) |
| `cronScheduler.ts:903` (R8-1, round 10) — a restored one-shot is re-classified as missed on the first edit or on a restart | **Closed** | Live, with a positive control (1b) |
| `cronScheduler.ts:1375` (R10-1) — `removeCronTasks` advances nothing, so a restore resurrects a deleted task | **Closed** | Durable tombstone observed cross-process; veto pinned by mutation (1c) |
| `cronScheduler.ts:1387` — a restored one-shot re-fires at every future cron match | **Reproduces** | Measured, 4 fires in 4 minutes (F2) |
| `scheduled-tasks.ts:1433` — PATCH rejects the dialog's stale-`groupId` round-trip | **Reproduces** | End to end through the real UI (F3) |

### 1a. A one-shot whose model cannot be applied is restored, not consumed

A durable `recurring: false`, `sessionMode: per_run` task pinned to `coder-model(qwen-oauth)` (a configured provider with no credentials), fired by the real clock:

```
[serve] method: 'session/set_model'  modelId: 'coder-model(qwen-oauth)'
[reconcile] session=91a319f3… target=model action=skipped reason=roundtrip_failed
qwen serve: create_sub_session failed: sub-session model selection failed: coder-model(qwen-oauth)

scheduled_tasks.json after the fire:
  { "id": "iah7aikp", …, "recurring": false, "lastFiredAt": 1788805920000,   ← the fired minute
    "sessionMode": "per_run", "modelServiceId": "coder-model(qwen-oauth)" }   ← still there
sessions: only the controller session — no orphan child, no orphan transcript
```

The task survives with its slot stamped, nothing ran anywhere, and the rollback left no leaked session. That is R8-1's reported input and R2-1's transcript leak, both closed.

### 1b. The restored one-shot survives an edit and a restart — and the missed pass is still armed

Round 10's blocker was that the suppression is process-local, so a prompt-only edit or a session restart would re-classify the restored task as missed, delete it, and deliver a false "missed while Qwen Code was not running" carrier. At this head the durable stamp added in `eb86348329` holds:

```
PATCH { prompt } (prompt only, no cron/enabled change)  → 200
disk +4s (past FILE_DEBOUNCE_MS): task still present, prompt updated, no missed carrier
daemon restart (fresh CronScheduler, empty restored-id set)
disk after load: task still present
```

**Positive control** — the same load must still delete a genuinely missed one-shot, or the result above is vacuous. I hand-injected `ctrlmiss` (bound to the same session, `lastFiredAt: null`, cron slot 10 minutes in the past) and restarted:

```
disk before load: ["das6gfn5", "iah7aikp", "ctrlmiss"]
disk after  load: ["das6gfn5", "iah7aikp"]            ← ctrlmiss removed as missed
```

The missed pass ran and did its job; the restored task is skipped by the new `lastFiredAt >= nextFire - jitter` guard, not by an inert code path.

### 1c. Deletion tombstones are visible across the process boundary

R10-1's entrance B was that the generation counter lived in module-level per-process state, while the DELETE route runs in the daemon and the only reader runs in the spawned `qwen --acp` child. `eb86348329` replaces it with a durable `scheduled_tasks.json.deletions` file. Live, both processes write it:

```
$QWEN_HOME/tmp/<hash>/: scheduled_tasks.json  scheduled_tasks.json.deletions  scheduled_tasks.lock

after the ACP child removed a missed one-shot : {"version":1,"entries":[["ctrlmiss",1]]}
after DELETE /scheduled-tasks/abworti0 (daemon): {"version":1,"entries":[["ctrlmiss",1],["abworti0",1]]}
```

I did not stage the live race itself — the model-selection failure window is sub-second, so it is not reachable by hand. The veto logic is pinned by tests that die under mutation (M2/M3 below), which is what I relied on instead.

---

## 2. The feature

![form before/after](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/01-form-before-after.png)

![form states](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/02-form-states.png)

The Model list is filled from the live daemon; the group list offers ungrouped / existing / **Create a new group…** with name and colour inline; switching **Run in** to *Persistent task session* removes both (5 selects, 6 with the new-group row, → 3), and re-opening the task in **Edit** restores the selection.

![routed run](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/03-routed-run.png)

**Both dispatch paths route, in both workspaces.** `Run now` (the `spawnOrAttach` path) and real wall-clock fires (the ACP `createSubSession` path) are different code; I exercised both. In the **secondary** workspace — the path that gained `runtimeBaseDir` scoping in this round — three consecutive real fires of a `* * * * *` task all went out on the wire as `fake-max` and all three children were written into B's group, with A's organization store untouched:

```
wire models since create : ["fake-max","fake-max","fake-max"]
sessions in B            : 3 × "B minute task · …"  groupId=8b445570…
sessions in A with B's group: []
```

**Validation, persistence and scoping** (all against the live daemon):

| Check | Result |
| --- | --- |
| `POST` per-run + model + group | 201, echoed in the view and written to `scheduled_tasks.json` |
| `POST` persistent + routing (explicit, or `sessionMode` omitted) | 400 `session_routing_requires_per_run` |
| `POST` per-run + unknown / cross-workspace `groupId` | 400 `group_not_found` |
| `POST` per-run + `''` group / 129-char model id / `\n` in model id | 400 `invalid_group_id` / `invalid_model_service_id` ×2 |
| `POST` per-run + **unknown** `modelServiceId` | **201** — no existence check; fails at run time instead |
| `PATCH {modelServiceId: null, groupId: null}` | 200, both cleared in the view **and** deleted from disk |
| `PATCH {sessionMode: "persistent"}` on a routed task | 200, both routing fields stripped from disk |
| Daemon restart | routing fields reload intact |
| Group deleted after the task was created, then a run | run fires, lands ungrouped, daemon logs the reason — fails open |
| Merge-base control | the same three POSTs are all accepted (201) and the fields are silently dropped; the form has no routing controls at all |

**An unusable model now fails closed and says so** — the gap I raised as N2 last round. `Run now` answers `500 scheduled_task_session_dispatch_failed`, the run record carries `sessionDispatchFailed: true`, the Web Shell renders it, and no orphan session is left behind:

![run failure](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/06-run-failure.png)

---

## 3. Findings

### F1 — Choosing a model for one task still rewrites the workspace default for everything else *(unchanged since round 1; the one I would fix)*

![default model leak](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/04-default-model-leak.png)

Three runs on one daemon, nothing else touched:

```
settings.model at start                          {"name":"fake-plus"}
1) run task X — Model = "Workspace default"      wire: fake-plus   settings: fake-plus
2) run task Y — Model = "Fake Max"               wire: fake-max    settings: fake-max  ← rewritten
3) run task X again — X never edited             wire: fake-max    settings: fake-max
```

Step 3 is the problem: the form's own "Workspace default" option stops meaning anything once any routed task fires. The write goes to the **user-scope** settings file, so with `--workspace A --workspace B` a routed task in B changes A's default too, and the interactive composer picks it up on its next load. It repeats on every wall-clock fire, not only on a manual click.

Mechanism (all pre-existing; this PR is what makes it reachable from a recurring unattended job): `spawnOrAttach({modelServiceId})` → `applyModelServiceId` → `unstable_setSessionModel` → `Session.setModel`, whose `persistDefault` defaults to `true`. `acpAgent.setSessionConfigOption`'s `case 'model'` already passes `{ persistDefault: false }` for exactly this reason, so threading a non-persisting variant through is the shape of the fix.

### F2 — A restored one-shot re-fires at every subsequent cron match, forever *(the standing Critical at `cronScheduler.ts:1387`)*

Restoring the one-shot puts it back on disk with its slot stamped, which stops the same-minute loop — but nothing marks it as *attempted*, so the next match of its cron expression fires it again. Measured on a `recurring: false`, `* * * * *`, unusable-model task:

```
t+1min  on-disk=true  lastFiredAt=…807600000   model-selection failures=2
t+2min  on-disk=true  lastFiredAt=…807660000   model-selection failures=3
t+3min  on-disk=true  lastFiredAt=…807660000   model-selection failures=3
t+4min  on-disk=true  lastFiredAt=…807720000   model-selection failures=4
```

Each cycle is a real spawn → model failure → rollback → two tasks-file writes. It is contained — I confirmed **no orphan sessions accumulate** (the session list stayed at the single controller session throughout) — and it stops the moment the model becomes resolvable or the user deletes the task. But one-shots never accrue run history, so the UI shows *nothing at all*: no run record, no error, no trace outside daemon stderr. For a realistic daily one-shot pinned to a model whose provider was later removed, that is one silent retry per day, indefinitely.

The retry does terminate on success. I PATCHed the same task onto a usable model mid-loop:

```
PATCH { modelServiceId: "fake-max(openai)" } → 200
wire on the next match : ["fake-max", "fake-max"]
on disk afterwards     : gone — consumed, exactly once
run session created    : "OneShot recover · 09-08 03:06"
```

So this is a genuine retry, not a runaway. Retrying work that never executed is defensible; retrying it unboundedly, with no backoff and no user-visible signal, is the part I would change — at minimum, record the failed attempt somewhere the UI can show it.

### F3 — A task whose group was deleted cannot be edited at all *(the standing Critical at `scheduled-tasks.ts:1433`)*

![stale group blocked](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/05-stale-group-blocked.png)

Reproduced end to end through the real UI: delete a group that a per-run task uses, re-open the task, change only the prompt, Save →

```
PATCH /scheduled-tasks/1hc45ccg: Group not found: bb4e4ae0-a4d0-4bb2-8ad7-344d0efc1c88
prompt on disk afterwards: unchanged
```

`startEdit` restores `task.groupId` into the picker, and the select renders it as a raw-UUID option, so every subsequent save re-sends the dead id. Name, prompt and schedule edits are all blocked until the user works out that they must set **Session group → No group** first, and nothing says so. It fails closed and loses no data, but it is a dead end reached by deleting a group — an ordinary action. Cheapest fix: on PATCH, treat a `groupId` equal to the task's own stored value as a no-op instead of re-validating it (or have the dialog omit `groupId` when it is unchanged).

### F4 — POST rejects routing on a persistent task, PATCH silently drops it *(unchanged; already on the ledger)*

`POST` with `sessionMode: "persistent"` + `modelServiceId` → `400`. The same combination via `PATCH` → **`200`**, fields quietly discarded. Storage stays consistent, so this is an API-contract nit — but a client is told its write succeeded.

### F5 — The task card still doesn't show where a task routes

The card shows workspace / schedule / *A new session every run* / next run — never the model or the group. With several routed tasks you must open **Edit** on each one. A chip beside *A new session every run* would put it where users scan.

### F6 — One hand-edited invalid entry still fails the whole schedule file *(unchanged)*

`isValidTask` carries a cross-field invariant (routing requires `sessionMode === 'per_run'`) and `readCronTasks` refuses to drop an invalid entry. I injected one such entry by hand: `GET /scheduled-tasks` → `500 scheduled_tasks_read_failed`, and all 11 unrelated tasks vanished from the UI and stopped being scheduled. Removing the entry restores everything. No in-product writer produces the combination, so this is hand-edit / external-writer only.

### F7 — The DELETE route's tombstone write has no test

The daemon's `DELETE /scheduled-tasks/:id` is the writer that makes R10-1's cross-process veto work, and removing its `deletionIds` argument leaves **all 122** route tests green (mutant M4 below). The core side is well pinned; the daemon side is not, so a future refactor can silently re-open the entrance that `eb86348329` just closed. This is the review's own deferred item at `scheduled-tasks.ts:1757`, and I confirmed it is real.

---

## 4. Tests, mutation, build

**Focused suites at `c682c618` — 2,444 passing, 0 failing:**

| Package | Files | Tests |
| --- | --- | --- |
| `core` | `cronScheduler`, `cronTasksFile` | 190 |
| `acp-bridge` | `bridge`, `bridgeClient` | 1046 |
| `cli` | `Session`, `create-sub-session`, `routes/scheduled-tasks`, `standalone-session-service` | 1126 |
| `web-shell` | `ScheduledTasksDialog`, `scheduledTasks.actions` | 82 |

`tsc --noEmit` clean for all four packages; `eslint` clean on the eight changed source files; `prettier --check` clean; and `git merge origin/main` (`f1ed3bc31a`) applies with **0 conflicts**.

**Mutation — 7 of 8 killed.** Each mutant removes exactly one fix component; the test named beside it is the one the review asked for as acceptance.

| Mutant | Removed | Result |
| --- | --- | --- |
| M1 | the durable fired-slot skip in the missed pass | **killed** — `keeps a restored one-shot after an edit and session restart` |
| M2 | the tombstone on `removeCronTasks`' pre-check miss | **killed** — `does not restore after a delete observes the fired task already gone` |
| M3 | durable readback of `.deletions` | **killed** — 3 tests, incl. `shares deletion generations across module instances` |
| M4 | `deletionIds` on the DELETE route | **survived** — 122/122 still green (F7) |
| M5 | the launcher's `modelApplied === false` throw | **killed** — 2 tests |
| M6 | the manual-run `modelApplied === false` throw | **killed** — `fails a per-run dispatch when the selected model is not applied` |
| M7 | the fired-minute stamp on the restored snapshot | **killed** — 4 tests |
| M8 | `restoreOneShot()` on the ACP-child model failure | **killed** — `restores a consumed one-shot when model selection fails` |

**On the red `review-pr` check:** it is the review workflow itself timing out (three `qwen-review-fallback` comments, 21600 s each), not a test failure. Every other lane is green, including `Test (ubuntu-latest, Node 22.x)`, `Real daemon E2E`, `web-shell E2E Smoke` and `Lint & Static`.

---

## 5. What I'd do

**Merge it.** The machinery this PR grew over ten rounds — one-shot restoration, durable deletion tombstones, fail-closed model application — behaves correctly at this head as far as I can drive it, and it is now backed by tests that die when you remove the fix. Three of the five Criticals still open in the ledger are closed at `c682c618`; two of them were fixed in `eb86348329`/`6ddb06d726`, which landed **after** the last review round that could have seen them, and the three review runs since then all timed out. So the residual risk is smaller than the ledger reads.

Filling in the residual-risk inventory the review asked the maintainer for:

| Standing Critical | Attack surface | Attacker dependency | Blast radius |
| --- | --- | --- | --- |
| F2 `cronScheduler.ts:1387` — restored one-shot re-fires | none — self-inflicted by an unresolvable `modelServiceId` | none | one spawn+rollback and two file writes per cron match; no orphan sessions; ends on success or on delete; invisible in the UI |
| F3 `scheduled-tasks.ts:1433` — stale-`groupId` PATCH | none — reached by deleting a group the task uses | none | that one task cannot be edited until its group field is cleared; no data loss |

Neither is exploitable and neither loses data, which is why I do not think either should hold the merge.

Three follow-ups I would like, in priority order:

1. **F1** — thread `persistDefault: false` through the scheduled-task model application. An unattended background job silently changing the human's next interactive model, across workspaces, contradicts the affordance the new form itself offers. This is the one I would most like fixed; it is the same observation I raised in round 1 and it is still open.
2. **F3** — stop the stale-`groupId` round-trip from blocking unrelated edits (treat an unchanged `groupId` as a no-op on PATCH).
3. **F7** — give the DELETE route's `deletionIds` a test, since it guards a fix that only just landed and no test currently notices when it goes away.

F2, F4, F5 and F6 are worth tracking but I would not block on them.
