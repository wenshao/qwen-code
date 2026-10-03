# Local real-build verification, round 3 (Linux) — head `b8387983`

**Verdict: the feature works end to end on Linux, and the two `main` merges since round 2 change nothing in its behaviour. All five open Criticals reproduce on a real build, and two of them (R10-3, R15-1) trigger on a narrower set of argvs than their threads describe. Nothing I drove crashed or ran a prompt twice. Outside the five threads there is one new defect, N3: when the opt-in folder trust is on, `--bg` reports the session as started, but the worker never submits the prompt.**

126 scripted assertions ran and 125 passed. The one failure is deliberate: it is the N3 reproduction. Build and bundle pass on both arms. `packages/cli` passes 522/522 and `cli-entry` 17/17. eslint is clean on the 17 changed code files and prettier on all 19 changed files. CI on this head is green.

Rounds [1](https://github.com/QwenLM/qwen-code/pull/10943#issuecomment-5925453999) and [2](https://github.com/QwenLM/qwen-code/pull/10943#issuecomment-5952793894) ran on macOS. This round reports only what they did not cover:

- Linux.
- The delta since `ee479d9f`.
- The five threads open now (R14-1, R14-2, R10-3, R15-1, R15-2), driven end to end instead of read.
- The paths round 2 listed under "Not covered".

### Setup

| | |
|---|---|
| Arms | **head** `b8387983` (PR head) and **base** `b3dda468` (`git merge-base` with `main`), each a detached worktree |
| Deps / build | `pnpm install --frozen-lockfile` on head. Base reuses those `node_modules` through `cp -al`, since the lockfiles are identical. `npm run build && npm run bundle` exits 0 on both arms. |
| Entry | The shipped bin `scripts/cli-entry.js` → `dist/cli.js`, not `packages/cli/dist` |
| Isolation | Each scenario gets a fresh `HOME`/`QWEN_HOME`/`QWEN_RUNTIME_DIR`/cwd. The environment is rebuilt from scratch: no proxy variables, no inherited `QWEN_*`/`OPENAI_*`. |
| Approval mode | The scenario homes set `tools.approvalMode: yolo`, because the `ENVPROBE` shell call needs it: in the default mode a worker's shell call would wait on an approval that nothing in the CLI can answer yet. The N3 control home uses no settings at all, which means the default Auto mode, and its worker ran its write normally. |
| Model | The repo's `integration-tests/fake-openai-server.ts`, wrapped so that every request goes to a JSONL ledger together with its `Authorization` and `Host` headers. Replies are keyed on markers in the last user message: `BGWRITE:` → one `write_file`, `ENVPROBE:` → one shell call, `SENDTO:` → `send_message`, `BGHOLD` → the turn is held open. |
| Host | Debian 13, Linux 6.12 x86_64, Node 22.22.2, running as root. A second account (uid 65534) is used for the `/proc` checks. |
| Merge equivalence | `git merge-tree` with current `main` (`1a933f7b`) is clean. 18 of the 19 PR files are byte-identical in the result. `settings.md` differs only by main's docs edits, and main has not changed the parser options since the merge-base. I expect these results to hold for the merged tree, but I did not rebuild it. |

**Delta since round 2** (`ee479d9f` → `b8387983`): two merges of `main`.

- **`cli.ts` / `cli.test.ts`:** main's new `--workspace-recovery-worker` early return at the top of `runCliEntry`, plus its test.
- **`settings.md`:** main's unrelated `tools.freeform` paragraph and table row.

`agent-view/**`, the version intercept and the `--bg` gate are byte-identical. Round 2's mutation results therefore still apply, and I did not redo them. The new main flag gets one row in the matrix below.

### 1. The central claim on Linux, A/B

![A/B](./01-ab-core.png)

- **Base:** `--bg` fails with `Unknown argument: bg` (exit 1) and records nothing. The supervisor's own spawn argv fails the same way, with `Unknown arguments: internal-agent-view-supervisor` (exit 1). 4/4.
- **Head:** 18/18. The launch exits 0 and prints exactly the two documented lines. A cold launch takes **0.75 s**. With the supervisor already running it takes **0.34 s** and reuses that supervisor (same pid).
- **Process tree:** supervisor (ppid 1) → PTY host → worker, with the worker started as `--session-id <id> --prompt-interactive=<prompt>`.
- **The worker ran the prompt:** the file was written, and the ledger shows exactly one tool-call turn.
- **State:** `state.json` reads `working`. On Linux, `worker.json` carries `hostProcStart`/`workerProcStart`/`pidNs`, so round 2's O3 (those fields being `null`) is macOS-only.
- **Bare supervisor argv:** started directly, it serves. The `status` RPC answers and `shutdown` exits 0.

### 2. Entry argv matrix (20 rows × 2 arms)

![matrix](./02-argv-matrix.png)

Each row has its own expectation for each arm, and both arms pass 20/20.

- **Dispatch rows:** every row that should dispatch does, and `launch.json` records the exact prompt.
- **Declines:** every decline names the flag it refused, including main's new `--bg --workspace-recovery-worker`.
- **Parser-owned launches:** both R13-2 argvs fail on both arms with the same parser error, and every launch the parser owns matches base.
- **Exit 0 without a session:** apart from the intended `--version --bg` and `-p … -- --bg` rows, only the two red rows (next section) do this.

### 3. The five open Criticals, driven end to end

**R14-1: environment frozen at the first launch.** Reproduced, 10/10 (Fig. 3).

- **Setup:** shell A exports `sk-shellA-REVOKED` and an endpoint at `127.0.0.1`. Shell B exports `sk-shellB-CURRENT` and `localhost`.
- **Result:** B's `--bg` exits 0 with "Started …", yet B's worker's shell printed A's variables. The model server received B's task with **`Authorization: Bearer sk-shellA-REVOKED`**, at **A's host**. B's key was never sent.
- **Control:** after stopping the supervisor through its shutdown RPC, the next launch from B carries B's key, host and env. No `qwen` command can stop the supervisor, so a user cannot do this. The cause is supervisor reuse.

**R14-2: prompt in a world-readable argv.** Reproduced, 7/7 (Fig. 4).

- **Exposure:** `/proc` here is mounted without `hidepid`. As uid 65534, both `cat /proc/<worker>/cmdline` and `ps -eo args` show `INCIDENT-TOKEN-sk-secret-12345`.
- **Duration:** I re-checked the cmdline 20 s later, after the launcher had exited, and the prompt was still there.
- **Scope:** only the worker's argv carries the prompt. The supervisor's and the host's do not.
- **At rest:** the stored copy is `0600`, and `nobody` gets `Permission denied`. One correction to the thread: `jobs/<id>/` is created without a mode and is `755` here, not `0700`, so the files are what protect it.
- **Prompt size cap:** the same argv channel caps prompts at **16 KiB**. A 20 KiB prompt exits 1 with `Agent View prompt is too large for argv (16384 UTF-8 bytes maximum)`, and the new docs don't mention the cap.

**R10-3: version word in a prompt-led launch.** Reproduced.

- **Result:** `audit -v this --bg`, and the bot's own `document the --version flag --bg`, print `0.24.7`, exit 0, write nothing to stderr and start no session.
- **Narrower than the thread's wrapper example:** the thread writes `qwen "$TASK" --bg`, but a quoted `$TASK` is a single argv word. `qwen "audit -v this" --bg` dispatches normally. The defect needs either an unquoted, word-split `$TASK` or a literal, separate `-v`/`--version` word.
- **Base:** prints the version for `audit -v this --bg` too. What is new is the exit-code contract that `--bg` introduces.

**R15-1: a prompt starting with `help`.** Only partly reproduced.

- **`help me fix --bg -v`:** silently exits 0, as the thread says.
- **The headline example, `help me fix the build --bg`:** this does *not* take the version route. It fails loudly with `Unknown argument: bg`, exit 1, the same as base. The thread's own witness agrees: `STUB main() reached`.
- **So:** the silent case needs a version word. Without one, the defect is that a prompt cannot start with `help`.
- **Related, by design:** a prompt-led argv ending in `help` (`audit help --bg`) is handed to the parser. The parser prints usage and exits 0 with no session.

**R15-2: one session, two `ps` rows.** Reproduced.

- **Result:** two `--bg` sessions produce 4 rows in `sessions ps` and 4 lines in `--json`. Each id appears once as `managed` (`PID -`) and once as `tui` with the real pid.
- **Docs:** "lists it as a `managed` row" covers only half of that.
- This is the same as round 2's O1.

### 4. Carried findings, re-measured

**N2: the PTY-host ready wait has a cliff far below its budget (Fig. 5).**

- **Method:** a `NODE_OPTIONS=--require` preload delays the PTY host's start by N ms, blocking before the host binds its socket.
- **Head:** every N ≤ 2.4 s starts. Every N ≥ 2.8 s fails at **≈3.2 s wall** with `Agent View PTY host did not become ready.` and a `failed/exited` record, including N = 12 s. The code comments a "~15 s wall budget".
- **Positive control:** I made one edit to the same bundle, turning the loop condition `attempt<retries` into a deadline-only loop. With that edit, N = 2.8, 6 and 12 s all start (3.6 / 6.8 / 12.8 s). The 50-attempt cap is therefore what cuts the wait short: probes against a socket that does not exist yet fail in ~1 ms each.
- **What the control does not show:** I did not run the unit suites against that edit. The same loop also serves `connectAgentViewPtyHostProcess` (10 × 300 ms budget), where removing the cap would turn a ~0.5 s probe of a dead host into ~3 s. The fix probably belongs on the spawn path only, or should count attempts by elapsed time.
- **When it bites:** with no injected delay, a whole cold launch takes 0.76 s here, so the cliff only matters on slow or loaded machines. The code is from #7800, but `--bg` is the first user path that depends on it.

**N1: narrowed.**

- **When it breaks:** deleting `QWEN_HOME` while its supervisor runs breaks the next `--bg` only when the socket has fallen back outside the home, which happens with a long home path. Here the socket was `/tmp/qwen-agent-view-0/supervisor-<digest>.sock`, and the next launch exits 1 with `supervisor exited before becoming ready with code 1`.
- **When it recovers:** with a typical short `~/.qwen`, the socket lives inside the home, is deleted with it, and the next launch exits 0.
- **Runs:** 3/3 logged runs gave the same result.

**Still standing, unchanged:**

- `--bg=true` is rejected by the parser with `Unknown argument: bg`, while `--help` lists `--bg [boolean]`.
- The PR body still shows a `STATE working` table and the sentence about being "derived from the option tables". It also still says build and typecheck were not run.

### 5. Paths earlier rounds did not cover, or covered only on macOS (Figs. 6–8)

| Path | Result |
|---|---|
| **Exit 2** (client timeout) | I stalled the supervisor's first store I/O under `jobs/` for 33 s, past the 30 s client cap. The launcher exits **2** at 30.7 s with "may still be starting … Check: qwen sessions ps". The session then really started and the worker wrote its file, so the in-flight claim was true. 6/6. Nit: the message has a double period (`…supervisor response.. Check:`), because `${reason}.` is appended to a reason that already ends in `.` |
| **EPIPE** | `qwen --bg "…" \| true` exits 0 with empty stderr, and the worker still runs. 3/3 |
| **SIGHUP on Linux** | `--bg` was typed into an interactive bash inside a PTY, then the PTY was destroyed. Bash died. The supervisor (now ppid 1), the host and the worker survived, and the session stayed `working`. 4/4 |
| **`send_message` into a `--bg` worker** | Round 2 had only registry-level evidence. Here a second `--bg` session's model called `send_message` to the first worker's `[ref]`, and the tool returned "Sent to w-…". The receiver's own screen, read through the `logs` RPC, shows `Message from another session (w-…): PEERMSG:…` and then its model's reply. 4/4. Scope: the sender needs an inbox. Interactive sessions, ACP sessions and other `--bg` workers have one. In a debug probe, which is not an assertion, a headless `qwen -p` could not send: "cross-session messaging is not active in this session". |
| **Supervisor crash / restart** | After the worker went idle, the supervisor was `kill -9`'d in one run and shut down with `keepWorkers` in another, then a new launch was made. A fresh supervisor starts. The first worker keeps its pid, is not respawned, and its prompt is **not re-run** (the ledger shows 1 turn). 4/4 per mode |
| **Concurrent cold launches** | Three `--bg` launches at once into one fresh home all exit 0 in 0.75 s. There is **one** supervisor, three sessions, and all three ran. 3/3 |

**New finding N3: with folder trust on, `--bg` certifies a session that never starts (Fig. 8).**

- **Setup:** `security.folderTrust.enabled: true`, with the launch directory never trusted.
- **Result:** `qwen --bg "…"` exits 0 with "Started background session …", and the record reads `working`. 25 s later the model has received **zero** requests for the task. The worker's own screen, read through the `logs` RPC, is the "Do you trust this folder?" dialog. Nothing in the CLI can answer it yet, so the task never runs and nothing says so.
- **Controls:** the same home without folder trust ran the task. So did a home with no auth type selected at all, with only `OPENAI_*` in the env.
- **Who it affects:** folder trust is off by default, so this only hits users who opted in.
- **Possible guard:** decline `--bg` with a sentence when folder trust is on and the directory is untrusted.
- **Status:** the bot's round-15 review recorded this exact question as "not explored". The dialog does block the `--prompt-interactive` submission.

**Resident cost.** A finished `--bg` session does not exit: its worker stays at the prompt. On this box an idle worker holds ~262 MB RSS and its PTY host ~56 MB. The shared supervisor adds ~160 MB. All of this stays until it is killed by hand, because no stop command exists yet.

**Not user-visible, but noted.** After the task finishes and the worker idles, `sessionState` still reads `working`. `processState` stays `starting` while the worker runs, because R13-1 advanced only `sessionState`. Nothing in this PR displays either field, and nothing I drove behaved differently because of them, including the restart above. The bot's round-15 review deferred a related note: `working` vetoes the supervisor's reclaim.

### 6. Gates (Linux)

- **Build:** `npm run build` (tsc across all workspaces) and `npm run bundle` exit 0 on **both** arms.
- **`packages/cli` tests:** `vitest run src/cli.test.ts src/agent-view/ src/commands/sessions/ src/config/top-level-options.test.ts` passes **522/522 across 20 files** under the default pool. Round 2 reported 521 on macOS, where it needed a pool workaround; the +1 is main's recovery-worker test.
- **`cli-entry` tests:** `scripts/tests/cli-entry.test.js` passes **17/17**.
- **Lint:** `eslint --max-warnings 0` exits 0 on the 17 changed code files, and `prettier --check` exits 0 on all 19 changed files.
- **CI on `b8387983`:** green. That covers `Test (ubuntu)`, `Lint & Static`, `Integration Tests (no-AK)`, `web-shell E2E Smoke` and the Java lanes. The macOS and Windows `Test` lanes are skipped.

### For the merge decision

The wiring this PR exists for is real and works. Before this PR the supervisor cannot start at all. With it, `--bg`:

- starts, and keeps running after the terminal closes and after a supervisor crash;
- delivers its prompt exactly once;
- can be messaged from another session.

None of the five open threads is a crash or a regression of an existing path. Every argv I tried without `--bg` matches base, except the two internal spawn argvs, which now serve by design. The five threads are contract and design questions on a flag labelled Experimental, and all five are now measured.

If the call is to risk-accept, I would still want these in the merge or right after it:

- **R14-2:** a docs warning, in the spirit of `serve`'s `--token` note, that other local users can see the prompt in the process list. The note should also give the 16 KiB cap.
- **R14-1:** a docs line saying that later `--bg` launches run with the first launcher's environment until the supervisor exits.
- **N3:** document it at least, and ideally decline at launch, before the flag loses its Experimental label.
- **N2:** a follow-up to bound the spawn-path wait by time rather than by attempt count. The control above shows that is the lever.

R10-3, R15-1 and R15-2 can follow as issues:

- **R10-3 / R15-1:** the silent exit 0 needs a separate `-v`/`--version` argv word, either before `--bg` in a prompt-led launch, or anywhere once the prompt starts with `help`.
- **R15-2:** the duplicate `ps` row is cosmetic, apart from double counting in `--json`.

### Not covered

- macOS and Windows. Rounds 1 and 2 covered macOS.
- A real model provider; this round used the fake model only.
- Attach, reply and stop, which belong to #7802.
- An organic slow-host repro of N2. My cliff is synthetic but exact, and round 2 hit it organically during a macOS spawn stall.
- The unit suites against the N2 edit.

### Methodology

- **Harnesses:** scripted, with PASS/FAIL assertions. Every scenario uses a fresh home, and leftover processes are killed by their recorded pids.
- **Reruns:** the core A/B, the base arm of the matrix, N2, send_message and the trigger-shape scenarios were re-run after harness fixes. Every number above comes from a complete run.
- **Fault injection:** a 50-line `--require` preload, scoped by each process's own argv. It either delays the PTY host's start or stalls the supervisor's first store call under `jobs/`.
- **Positive control:** a single string replacement in a hardlinked copy of the head bundle. Head's own file is untouched; the copy is a separate inode, and I checked that.
- **Evidence:** the harnesses, the per-scenario JSON results, the N1 run logs and the raw ANSI transcripts behind every figure are in [the evidence directory](.).
