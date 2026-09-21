## Local verification, round 3 (head `81fecd5f`, Linux)

This round's push changes production code: the pseudo-session allowlist (R1-5), a standalone options interface (R1-10), and new first-pass catch-up coverage. So I did not carry rounds 1–2 forward. I rebuilt the change and re-ran it with the real interactive CLI, this time on **Linux**. Rounds 1–2 ran on macOS.

**Verdict: recommend merge.** Every round-3 disposition checks out. The allowlisted name is a real file: `qwen serve` writes it at every start-up. The test-isolation fix (R1-6/7) prevents actual data loss, which I reproduced. I found no blocking defect. CI is fully green on `81fecd5f`. The only thing still blocking is the bot's `CHANGES_REQUESTED` from 02:38. It was about branch state, which is now resolved, so a maintainer approval clears it.

<details>
<summary><b>What I ran against</b></summary>

| | |
| --- | --- |
| Verified tree | `main ec109102e0` + PR head `81fecd5f` merged → `5945a4a7d6`. Merge is clean: `9 files changed, 466 insertions(+), 7 deletions(-)` |
| Arms | **PR**: that tree, built with `pnpm install` (`prepare` builds and bundles). **base**: a separate, pristine worktree of `main ec109102e0`, built the same way. **r2-equiv**: the PR bundle with one line changed in `dist/chunks`, `PSEUDO_DEBUG_SESSION_STEMS = new Set([])`, so it behaves like round 2 for these two names |
| Platform | Linux 6.12.63 x86_64, Node v22.22.2, pnpm 11.24.0 |
| Isolation | Each scenario has its own `HOME`, `QWEN_HOME` **and** `QWEN_RUNTIME_DIR`, on a dedicated tmux socket. This box's real `~/.qwen/debug` had 7 048 entries before the run and 7 048 after |
| Evidence and harness | [`wenshao/qwen-code@asserts:pr-12374/`](https://github.com/wenshao/qwen-code/tree/asserts/pr-12374): figures, raw JSON snapshots, logs, and all scripts |

![the real TUI under test](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/00-tui.png)

</details>

### 1. Real TUI, 17-entry fixture, three arms

The same seeded `runtime/debug` goes to each arm. `general.cleanupPeriodDays = 30`, and the TUI is launched with `--session-id 7777…` and then left idle. The first pass fired **62 s** after launch, on the catch-up path.

![S1 base vs PR](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/01-s1-fixture.png)

| entry (age) | base | r2-equiv | **PR** |
| --- | --- | --- | --- |
| stale `<uuid>.txt` ×2 (60 d, 31 d), stale `<uuid>-agent-Explore-….txt` | kept | removed | **removed** |
| `transcript-replay.txt`, `workspace-mcp-discovery.txt` (60 d) | kept | kept | **removed** ← this round |
| near misses (60 d): `Transcript-Replay.txt`, `workspace-mcp-discovery-old.txt`, `transcript-replay.log`, `notes.txt`, `startup--root-git.txt` | kept | kept | kept |
| `<uuid>.txt` at 29 d, `<uuid>.txt` at 5 min | kept | kept | kept |
| `<uuid>.txt` **directory**; `<uuid>.txt` **symlink** to a 60-day-old file outside the dir | kept | kept | kept, and the target is intact |
| current session's own log (`--session-id`, 60 d) | kept | kept | kept. **Control** without `--session-id`: removed |
| `latest` → a stale log | kept | dangling | dangling, as the description now documents |
| `daemon/` (60-day-old files inside) | untouched | untouched | untouched |
| marker in `QWEN_HOME` | none | `…-204253998b2e41a8` | `.debug-logs-cleanup-402f6a658f87ed2d` = `sha256(<runtime>/debug)[:16]` |

### 2. The allowlisted name is a real daemon file (R1-5)

![S2/S4 real qwen serve](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/02-daemon-writer.png)

- **`workspace-mcp-discovery.txt` is written by `qwen serve` itself.** With `QWEN_DEBUG_LOG_FILE=1`, the daemon creates it at start-up; no session, prompt or MCP request is needed. I restarted the daemon three times with nothing but `/health` polls in between. The file grew 4 808 → 9 616 → 14 424 B, one init block per start, and it is never rotated. On `main` nothing ever removes it.
- I copied that daemon-written dir and aged the `*.txt` files to 45 days. **PR** removed the file and the two stale session logs. **base** kept everything. A fresh copy under **PR** kept everything, so the mtime cutoff does its job.
- **Live writer.** The daemon was still running, the file was 2 h old, and a TUI ran with `cleanupPeriodDays: 0`. The sweep removed the file, and the daemon carried on normally: `/health` returned 200, a new prompt returned 202, and the session logs kept growing. The file is only written while the discovery config is created. A later `POST /workspace/mcp/reload` logs to the process-wide session file instead, so the sweep does not lose any output that would have been appended later.
- **`transcript-replay.txt`: I could not produce it.** `GET /session/:id/transcript` on a real, persisted session returned 200 but did not create the file. `extMethod` binds the target session id before `newSessionConfig` runs, so the fallback is not reachable through that route. Allowlisting it is still harmless: the match is exact and the sweep is gated on mtime.

### 3. A real 7 048-entry debug dir (Linux)

The corpus is this box's real `~/.qwen/debug`: 147 MB, and no file in it is newer than 30 days. I copied it read-only into two isolated runtime dirs with `cp -a`. Each arm then ran a TUI with `QWEN_DEBUG_LOG_FILE=1`, so the product logs its own housekeeping result.

![S3 real corpus](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/03-real-corpus.png)

- **PR** logged `debug-logs: removed=7043 errors=0` in its own session log. The step took about **106 ms**, measured between that line and the preceding housekeeping log line. The dir went from 7 049 entries and 147 MB to 6 entries and 14 MB, and the remaining 14 MB is `daemon/`, whose tree hash is identical before and after. A read-only dry run of the predicate had predicted **7 043**, which matches exactly.
- The survivors are correct. Three are non-session names left by older builds (`startup--root-git-qwen-code.txt`, `startup--root-git.txt`, `test-session-123.txt`). The others are the live session log, `latest` (already re-pointed at the live session), and `daemon/`.
- **base**: the same TUI logged no `debug-logs` line, wrote no marker, and left all 7 049 entries (147 MB) in place.

### 4. Tests: what the round-3 changes actually pin

![test isolation A/B and mutation matrix](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12374/04-tests.png)

- **R1-6/7 is a real data-loss fix, not a hygiene tweak.** I exported `QWEN_RUNTIME_DIR` pointing at a sentinel debug dir and ran the two housekeeping suites, with the production code held at the PR head. With the round-2 test files, **the test run deleted 4 of the 5 sentinel files** (8 tests also fail). With the round-3 test files, all 65 pass and the sentinel is untouched. Before this fix, a developer with `QWEN_RUNTIME_DIR` in their shell would lose real logs just by running `vitest`.
- **Mutation matrix: 12 mutants, 10 killed.** R1-1 (OpenAI marker dropped), R1-5 (allowlist emptied) and R1-10 (`() => true` at the call site) all **survive with the round-2 tests and are killed by the round-3 tests**, so the new tests are what pins them. R1-8 (`rmdir` of the emptied root) was already killed in round 2, where `readdirSync` on the removed root throws `ENOENT`. Round 3's explicit `existsSync` makes that intent visible. Survivors: A1 (allowlist widened to a prefix match) and A2 (case-insensitive match). Both are optional; see below.
- On Linux the suites pass 65/65 as a non-root user. As root, 3 fail: 2 of them fail the same way on `main` (2/53), and all 3 are `chmod`-based `EACCES` cases where root ignores mode bits. That is an existing convention, not a defect in this PR.

### 5. Gates

| | |
| --- | --- |
| CI on `81fecd5f` | all green, including `Test (ubuntu)`, `Lint & Static`, `Integration Tests (no-AK)`, `web-shell E2E Smoke`, and `review-pr`. macOS and Windows `Test` are skipped as before |
| `npm run typecheck` (all workspaces) | exit 0 |
| `eslint` and `prettier --check` on the changed files | clean |
| `npm run generate:settings-schema` | no diff, so the IDE schema matches `settingsSchema.ts` (R1-4) |
| `settingsSchema.test.ts` + `startup-prefetch.test.ts` | 91 passed |

### 6. Non-blocking

1. **File the R1-3 follow-up before it gets lost.** It is not filed yet. It matters more after this round: the new allowlisted file is written by `qwen serve`, but a daemon alone never runs this sweep. It writes `.openai-logs-cleanup-*` and never `.debug-logs-cleanup-*`, which I observed in both daemon runs. A daemon-only user therefore still accumulates this file and every session log.
2. **Frequent daemon starts keep `workspace-mcp-discovery.txt` growing.** Each start appends about 4.8 KB and refreshes the mtime, so anyone who starts the daemon at least monthly never ages it past the cutoff. The amount is tiny and bounded by how often the daemon starts, but no retention rule can fix it. The fix belongs on the writer side (a per-process file, or truncating on init) and can come later.
3. **Optional:** a near-miss fixture (for example `workspace-mcp-discovery-old.txt`) would kill A1 and A2. The real binary already keeps these names (section 1), so this only pins the behavior.

**Not verified:** Windows (never), and macOS in this round. Rounds 1–2 ran on macOS at older heads, and this round's production change is the allowlist plus an options interface, neither of which depends on the platform.

Raw snapshots, mutation JSON, logs and the full harness: [`wenshao/qwen-code@asserts:pr-12374/`](https://github.com/wenshao/qwen-code/tree/asserts/pr-12374).
