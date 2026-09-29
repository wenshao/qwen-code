# PR #10954 deep verification (round 9, local, Linux x86_64)

Head `b98dfa1927fc7ff54c2ad2ecaedd3b4b27123744`. The round-8 head was `4ae0857a8f`. Rounds 1–8 ran on macOS arm64 and each listed Linux as not covered. This round ran on Linux x86_64 (Debian, kernel 6.12, Node v22.22.2) with a fresh `pnpm install --frozen-lockfile`, `npm run build` and `npm run bundle`, all exit 0. It used real `qwen serve` daemons, real `qwen --bg` launches through the shipped bin (`scripts/cli-entry.js`), a real supervisor, and the real model **qwen3.8-max** as a positive control. Each harness ran in its own scratch `QWEN_HOME`.

## Delta under test

| Commit | What it is | Audit |
| --- | --- | --- |
| `ec7f7aefcd` | autofix round: 10 files, +339/−17. It covers the stop/peek budget, a repeated `--bg`, the ambiguous dispatch message, merged-row `startedAt`, strict store reads and three doc fixes. | each item A/B-tested below |
| `b98dfa1927` | merge of `main` `76c3dc5be6` (52 commits) | its tree `75f4230b52` equals `git merge-tree --write-tree ec7f7aefcd 76c3dc5be6`, so the merge is mechanical with no hand edits |

`readJsonRecordForConditionalWrite` → `readJsonRecordStrict` in `ec7f7aefcd` is a pure rename, with a byte-identical body. The supervisor's conditional writes are therefore unchanged. The head also merges cleanly into current `main` `2f5a62e6ab`, which is 78 commits ahead.

**Arms.** *head* = `b98dfa1927`. *pre-fix* = head with `ec7f7aefcd` reverted (`git revert -n` applies cleanly) and the bundle rebuilt, so each A/B isolates that one commit. *candidate* = head + the patch below. *split* = merge-base + the route's 8-file closure. Every arm except head is a hard-linked copy with the edited files unlinked first; `git status` on head was clean after every step.

## Finding status

| # | Finding | Round 8 | Round 9 (`b98dfa1927`) | Evidence |
| --- | --- | --- | --- | --- |
| **N1** | `--bg` never completes (no production `ready` producer) | stands, blocking | **stands, blocking, now also on Linux** | 5/5 real launches time out at 15.2 s; argv still `--session-id <id>` only |
| fix 1 (R13-1) | stop/peek time out client-side while the server completes them | open | **fixed** | pre-fix: stop exit 1 after 5.3 s, store ends `stopped`; head: exit 0 after 14.0 s |
| fix 2 | a repeated `--bg` is eaten from the prompt | open | **fixed** | `explain what does` → `explain what --bg does` |
| fix 3 (R10-7) | a dropped connection is reported as a definite failure | open | **fixed** | the supervisor was SIGKILLed mid-dispatch; the message is now "may still have started" |
| fix 4 (R13-3) | a merged row is dated by the session's creation | open | **fixed** | route/ps: 3 h → now |
| fix 5 (R13-4 / F1 store half) | a partially readable store gives a complete-looking 200 | stands (F1) | **fixed** | store cells C2–C4: 200 with the waiting agent missing → 503 |
| fix 8 (R9-1) | the controller recipe | "fixed" in round 4 | **fixed now; round 4 was wrong** | the round-4 recipe delivers to the *managed* session's socket |
| **R13-4 (fix-induced)** | `worker.json` stays on the soft reader | new (bot) | **reproduced on a real daemon** | a live agent → 200 `failed`, no pid |
| **R4-4 (registry half)** | an unreadable registry → a live agent reported `failed` | open (doudouOUC) | **reproduced, reach measured** | 200 `failed`; decides a verdict only when `worker.json` has no pid |
| R7-6 | the launch window is reported `failed` | open (bot) | **confirmed at runtime** | a ~60 ms `failed` flicker, 3/3 runs |
| R15-13 | `ps` silently shortens on a per-entry failure | open (bot) | **confirmed at runtime** | exit 0, empty stderr, the waiting agent missing |
| R14-2 | a dash-leading word declines without naming `--` | open (bot) | **confirmed at runtime** | "Re-run without it." |
| N2 | re-expansion of #10942's `sessions ps` | maintainer call | unchanged (`ps.ts` untouched) | does not arise under the split |
| F3 | no capability tag | stands | stands | `capabilities.ts` has no background entry |
| R6-1 | trust scope | fixed | still fixed (static) | route scoping unchanged since `420ab834`; `server.ts` only moved by merges |

## N1: unchanged, and reproduced on Linux

`r9-02-e2e-n1.mjs` follows the Reviewer Test Plan through the shipped bin:

- **Model control.** `qwen -p "Reply with exactly the word PONG…"` with the same `QWEN_HOME` prints `PONG`, exit 0, in 11.1 s.
- **Launch.** `qwen --bg "…"` exits 1 after 15.2 s with `Could not start a background session: Agent View worker <id> did not report ready before timeout.`
- **The real `launch.json`.** The worker argv is `[node, dist/cli.js, --session-id, <id>]`. The prompt exists only in `initialPrompt`.
- **After the timeout.** The route reports the row as `failed`. `sessions stop` then succeeds, and the route reports `stopped`.
- **Tally.** `r9-08-n1-tally.mjs` ran four more launches: each exits 1 after 15.17–15.24 s. That is **5/5**. Every other launch this round (stop/peek probes, the launch-window runs, the pid-source run) also ended in the same timeout. None succeeded.

The docs still show `# Started background session 0f8e...c31` at `commands.md:775-779`.

![n1](r9-03-n1-linux-launch-window.png)

## The fix commit `ec7f7aefcd`, item by item (pre-fix vs head)

![fixes](r9-01-fix-commit-ab.png)

1. **Stop during a launch** (`r9-03-stop-during-launch.mjs`). A real launch holds the per-session host-setup lock for its whole 15 s ready wait, so N1 makes this reproducible without a fake supervisor. `qwen sessions stop <id>` was issued 1 s in.
   - Pre-fix: exit 1 after 5.3 s, `Timed out waiting for Agent View supervisor response.`. The store then ends `stopped`: the stop landed after the client gave up. This is R13-1 exactly.
   - Head: exit 0 after 14.0 s, `Stopped.`.
   - `peek` returned in 0.5 s on both arms. It is not queued behind the lock, so its larger budget is harmless but not needed for this path.
2. **Repeated `--bg`** (`r9-04-entry.mjs`). For the unquoted `qwen --bg explain what --bg does`, `launch.json` records `initialPrompt` as:
   - pre-fix: `"explain what does"`
   - head: `"explain what --bg does"`

   The quoted form is identical on both arms.
3. **Supervisor killed mid-dispatch.** The supervisor was SIGKILLed 1.5 s into the ready wait.
   - Pre-fix: `Could not start a background session: Agent View supervisor closed before sending a response.`
   - Head: `Could not confirm the background session started: … It may still have started — check qwen sessions ps before re-running.`

   The hedge is accurate. The PTY host and the worker survive the supervisor, and `ps` lists the session as `working` with a live pid. Following the recovery path, a new supervisor started by the next `qwen --bg` lets `qwen sessions stop <id>` terminate both orphans within the 10 s graceful-stop window. I checked this at 3 s (still alive) and 15 s (gone). Nit: the reason already ends with a period, so the sentence prints `response..`.
4. **Merged-row dating** (`r9-05-rows.mjs`). The session was created 3 h ago. Its re-spawned worker is live and registered, and `worker.json` records its pid.
   - Pre-fix: route `startedAt` = the creation stamp, `ps` AGE `3h`.
   - Head: route `startedAt` = the process start, `ps` AGE `1s`.
5. **Strict store reads** (`r9-01-store-matrix.mjs`, real daemon per cell). The contrast is on the pre-fix arm, where cells C2 (B's `state.json` corrupt; B is the waiting agent), C3 (EISDIR) and C4 (corrupt roster) answer 200 with B silently missing or the name lost. On head, all three answer 503 `background_agents_unavailable`. C1 (healthy), C6 (empty session dir) and C10 (no `jobs/`) stay 200 on both arms.
6. / 7. **Docs.** The real `ps --json` line for a record-less failed session carries no `pid`/`startedAt`, which matches the now-conditional wording.
8. **Controller recipe, run literally.** The harness ran bash with real `jq` 1.7 and a `qwen` shim pointing at the arm's bin. Unix-socket listeners at both sessions' `ipcPath` record which one receives the message.
   - The current recipe `select(.managed == false and .ipcPath)` delivers to the interactive session.
   - **Correction to my round 4:** I marked R9-1 fixed with the recipe `select(.ipcPath) | .ipcPath | head -1`, but that store had no managed session with its own registry record. When a managed worker registers with `ipcPath` (the case the current docs call out), that recipe resolves the managed session's socket. The listener received the controller's message there. The current docs close this properly.

**Mutation claims of `ec7f7aefcd`, re-run.** Each mutant ran on its own hard-linked copy:

| Mutant | Killed by |
| --- | --- |
| route default back to soft reads | both real-store 503 cases |
| `startedAt` precedence swapped back | the merged-row dating case |
| every `--bg` skipped again | the repeated-`--bg` case |
| `stop` loses its 30 s budget | the stop-budget case |
| ambiguous-dispatch branch disabled | both new dispatch cases |

All five claims hold.

## Still open at this head: R13-4 (fix-induced) and R4-4 (registry half)

![open](r9-02-open-findings-candidate.png)

`r9-01-store-matrix.mjs` builds each store with the arm's own store writers. Where a live registry record is needed, it comes from a child process that registers itself through core's `registerSession`. Each cell then starts a real daemon.

| Cell | pre-fix | head | candidate |
| --- | --- | --- | --- |
| C7 live agent, its `worker.json` corrupt (R13-4) | 200 `failed`, no pid | **200 `failed`, no pid** | 503 |
| C8a control: pid only in a live registry record | 200 `running` + pid | 200 `running` + pid | 200 `running` + pid |
| C8b same store, `$QWEN_HOME/sessions` unreadable (ENOTDIR) (R4-4) | 200 `failed` | **200 `failed`** | 503 |
| C9 registry unreadable, `worker.json` has the live pid | 200 `running` + pid | 200 `running` + pid | 503 (cost of the simple probe) |
| C5 a stray regular file `jobs/notes.txt` | 200 | 503 (ENOTDIR) | 503 |

**How far R4-4 reaches** (`r9-07-pid-source.mjs`, sampled every 20 ms through a real launch):

| From launch start | `worker.json` | Registry |
| --- | --- | --- |
| ~271 ms | host and worker pids recorded | no record yet |
| ~1017 ms | same | the worker's own record appears |

So the registry decides a verdict only when `worker.json` has no pid for a live worker. That is the C8 shape: the pid-less dispatch window, or an unreadable `worker.json`. It is narrower than "a degraded registry reports live agents as failed" in general, but it is real, and the route publishes it as a 200.

**Candidate: +76/−5, 3 files, applies cleanly to `b98dfa1927` and to the split** (`candidate.patch`):

- `supervisor-store.ts`: in a strict listing, `worker.json` is read strictly too, and the comment now says why the worker file is different from launch/activity.
- `background-agents.ts`: the default `listRecords` first `readdir`s `getSessionRegistryDir()`. Any error other than ENOENT throws into the existing 503 path. `listLiveSessions` keeps its never-throws contract for its interactive callers.
- Three route tests:
  - worker file unreadable → 503
  - registry unreadable → 503
  - registry missing → 200 (the ENOENT control)

Results:

| Check | Result |
| --- | --- |
| candidate route suite | 18/18 |
| the same test file on head | 16/18: both 503 cases fail with `expected 200 to be 503` |
| mutant: drop the strict worker read | kills exactly the worker case |
| mutant: drop the registry probe | kills exactly the registry case |
| route + `server.test.ts` + `agent-view/` + `commands/sessions/` | 1828/1828 |
| cli `tsc`, eslint, prettier | clean |
| real daemon | C7 and C8b → 503; the C8a control stays 200 |

Trade-off: C9 turns into a 503 although head's answer there was correct. If that matters, the probe could fail only when reconciliation flips a row. I did not measure that variant.

## Observations at runtime (non-blocking)

- **R7-6.** `r9-06-launch-window.mjs` polled the route every 5 ms through a real launch against a warm daemon. The new agent reads `failed` at 111–170 ms while the store still says `starting/starting`, then `running` + pid until the timeout. This happened in 3/3 runs. The window is ~60 ms on this box, but a polling client such as the planned Web Shell panel can catch it.
- **R15-13.** On store C2, `qwen sessions ps` through the bin prints only agent-A, exits 0 and writes nothing to stderr. The waiting agent-B is silently omitted, while the route answers 503 on the same store. The sentence at `commands.md:874-877` promises a stderr reason. The PR's goal that the CLI and the route "cannot describe one session two different ways" no longer holds for a partially readable store.
- **All-or-nothing 503.** Strict reads turn any single bad entry into a route-wide 503 until someone repairs it: a stray regular file in `jobs/` (ENOTDIR) or one corrupt file among durable, never-reaped finished sessions. `ps` and the pre-fix arm keep listing. This is consistent with the documented contract, but worth a conscious choice. Two options are skipping non-directory entries, or listing with an explicit "incomplete" marker.
- **R14-2.** `qwen --bg tune the -O2 flag` prints `qwen --bg runs only the prompt and does not honor -O2. Re-run without it.`. The `--` spelling that works (`qwen --bg -- "-O2 tune the flag"` dispatches `-O2 tune the flag`) is not mentioned.

## The route-only split (the review suggestion), measured

![gates](r9-04-merge-gates-split.png)

The *split* arm is merge-base `76c3dc5be6` plus exactly these 8 files from head. The other 23 PR files are reverted to the merge-base.

- `background-agents.ts` and its test
- `managed-rows.ts` and its test
- `supervisor-store.ts` (strict reads)
- `presentation.ts`
- `server.ts` (wiring) and `server.test.ts`

| Check | Result |
| --- | --- |
| size | +1432/−7 (production +493) vs the PR's +3765/−196 over 31 files |
| cli `tsc --noEmit` | clean |
| route + managed-rows + `ps` + `agent-view/` + `server` + `cli` tests | **1802/1802**, including `main`'s own `ps.test.ts` 24/24; N2 does not arise, because `main`'s `ps.ts` is untouched |
| real daemon, the same 11-cell store matrix | **11/11 identical to head** |
| `qwen --help` | no `--bg` |
| candidate patch | applies unchanged |

What the split still carries is the route's own liveness logic in `managed-rows.ts`: R13-4 and R4-4 above (both closed by the candidate), R7-6, and R4-6 (pid identity).

## Gates

| Check | Result |
| --- | --- |
| 10 PR-affected test files | 218/218 |
| `src/serve/server.test.ts` | 1357/1357 |
| `src/agent-view/` | 321/321 |
| cli `tsc --noEmit`, eslint (`--max-warnings 0`), prettier on the 31 files | clean |
| merge into current `main` `2f5a62e6ab` | clean |
| PR checks at `b98dfa1927` | 26 pass, 35 skipping |

## For the merge decision

- **As the whole stack: do not merge while N1 stands.** Nothing in this round's delta touches it, and it now reproduces on Linux as well. The (a)/(b)/(c) choice from round 8 is unchanged.
- **The fix commit is good.** All eight items do what they say on real builds, and its five mutation claims hold.
- **If you take the route-only split that doudouOUC suggested,** it builds and passes on its own. I would fold in the +76/−5 candidate first, which closes R13-4 (fix-induced) and doudouOUC's R4-4 condition. I would be comfortable tracking the ~60 ms R7-6 flicker, R4-6 and the all-or-nothing 503 as follow-ups. That call belongs to the owner.

## Not covered

- macOS and Windows this round (rounds 1–8 ran on macOS).
- Options (a)/(b) were not re-measured.
- R16-2: control commands facing a transport-ambiguous failure after a mutation. That needs a lock held past 30 s or a connection dropped after the server acts.
- EACCES/EIO/EMFILE themselves. I ran as root, so `chmod` is no barrier; EISDIR, ENOTDIR and corrupt JSON stand in for "cannot read".
- Real `peek`/`answer` flows, which N1 makes unreachable.
- Held bot threads not named above.

## Files

- `harness/`: every script used (`lib.mjs`, `e2e-lib.mjs`, `r9-01` … `r9-08`).
- `fig/`: builds the figures from the recorded JSON and renders them with xterm.js.
- `data/`: every recorded result.
- `candidate.patch`: the candidate fix.
