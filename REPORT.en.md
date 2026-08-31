## Maintainer verification — real `qwen serve` daemon E2E

Verified at head `702c665c94d66e4cd2aff1853502e6b74d5e6c47` on Linux / Node v22.22.2 (the OS row the PR marks "not tested"), against a **live `qwen serve` daemon** — real HTTP, real spawned ACP children, real uploads through `POST /session/:id/attachments`, real bytes on disk. Harness: isolated `HOME`, two registered workspaces, a mock OpenAI-compatible model, and a second daemon instance dropped to uid 1500 so `chmod 000` produces a genuine `EACCES` instead of being walked through by root.

**Verdict: recommend merge.** 37 of 39 end-to-end checks pass. The 2 that fail are exactly the two Criticals the review bot deferred in rounds 9–10 — both reproduce, and both are fails-closed, workspace-scoped, non-sticky, and only reachable when a storage root is in a *permission/IO fault* state (an absent root is handled correctly). Nothing on the default path changes: with the env unset the layout is byte-identical to before.

### Suites

| suite | result |
| --- | --- |
| `acp-bridge` `sessionAttachments.test.ts` | 76 passed |
| `acp-bridge` `bridge.test.ts` | 836 passed |
| `cli` `session-attachments-root` + `process-env-guard` + `shared-env-keys` + `session-archive` | 132 passed |
| mutation probes on the PR's new logic | **9 planted, 9 killed** |
| full local `npm ci && npm run build` | clean |

### 1 · Migration path

Baseline with the env unset, then a restart with `QWEN_SERVE_SESSION_ATTACHMENTS_ROOT` set — same sessions, resumed by id.

![migration](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/01-migration.png)

- Env unset → bytes land in `~/.qwen/tmp/<projectHash>/attachments/session-<id>/`; nothing is created under the configured root.
- Env set → new uploads land under `<root>/<projectHash>/attachments/session-<id>/` and never touch the default dir.
- A pre-switch attachment still reads back byte-identical through the fallback root.
- A same-name upload after the switch is issued `legacy (1).txt`, and the pre-switch `legacy.txt` still returns its **original** bytes — the no-shadowing guarantee holds against a real HTTP upload, not just in unit tests.
- Two workspaces sharing one configured root get separate `<projectHash>` subtrees.

### 2 · Lifecycle across both roots

![lifecycle](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/02-lifecycle.png)

- `DELETE /session/:id/attachments/:id` removes a fallback-only copy and a configured-only copy alike; the deleted id then 404s.
- `POST /sessions/delete` on a **genuinely persisted** session (`removed:[…]`, not `notFound`) clears the session dir from *both* roots and leaves no `.deleting` tombstone behind.
- `POST /sessions/archive` (again non-vacuous — `archived:[…]`) keeps the attachments, matching the doc.
- `POST /session/:id/branch` copies from both roots into the new session's configured dir — a pre-switch attachment survives a branch.

### 3 · Configuration surface

![config](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/03-config.png)

- A project `.env` containing `QWEN_SERVE_SESSION_ATTACHMENTS_ROOT=<exfil>` is ignored — the upload still lands in the default root and the exfil dir is never created. (Control: the same variable in the daemon's launch env *does* redirect, section 1.) `PROJECT_ENV_HARDCODED_EXCLUSIONS` holds end to end, not just in `fast-path.test.ts`.
- `~/…` expands against the daemon's home; a relative value resolves against the daemon's cwd. Both land the bytes where the resolver says they should.

### 4 · Degraded roots — the two deferred Criticals reproduce

Daemon at uid 1500, `chmod 000` on one root at a time.

![degraded](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/04-degraded.png)

**F1 — `remove()` rejects a fallback-only copy when the *configured* root is unreadable** (the deferred `R7-2`). `DELETE` returns `500 EACCES: … stat '<configured>/session-<id>/legacy-only.txt'` and the healthy fallback copy stays on disk. `sessionAttachments.ts:729-732` probes both roots with `hasAttachment()` before mutating either, and `hasAttachment` rethrows any non-`ENOENT` stat fault — so a degraded *configured* root blocks the unlink of a copy that lives only in the *writable* fallback. `docs/users/qwen-serve.md:724` promises the legacy copy is "removable while the default fallback dir stays writable"; the code additionally requires the configured root to be stat-able. Either widen the doc or let a non-`ENOENT` fault on one root degrade to "unknown" and still attempt the other root's unlink.

**F2 — a stat-denied *legacy* root rejects every new upload** (the deferred write-arm item). `putAttachment` consults `statSizeStrict(<fallback>/<candidate>)` for every candidate name (`sessionAttachments.ts:412-420`), and `statSizeStrict` rethrows non-`ENOENT` — so an unreadable legacy dir returns `500 EACCES` for uploads the perfectly healthy configured root could serve. The occupancy check itself is right; only its failure mode is wrong. Blast radius measured: **every session of that workspace**, sibling workspaces unaffected, and not sticky — restoring the root restores uploads immediately. A bounded "treat a stat fault as occupied, then fall back to a random suffix" would keep the no-shadowing guarantee without failing the write.

Both faults need a *permission/IO* error. An absent legacy dir, or an absent legacy root entirely, is handled correctly (`ENOENT` → free name, upload `201`) — verified in section 2's phase 9.

### 5 · Mutation probes

Nine one-line reversions of the PR's own logic; every one is caught by the suites the PR ships.

![mutation](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/05-mutation.png)

Covers: the fallback root reaching `deleteSessionAttachments`, the fallback-name occupancy check, the `removingNames` filter in `copyFrom` (the R7-1 fix), the orphan-reaper cleanup, `peekDirectory()` vs a forced `directory()` on read, `delete()`'s fallback arm, `remove()`'s fallback arm, the `<projectHash>` isolation segment, and the env-value `trim()`. No survivors.

### 6 · One-way migration limits

![rotation](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10066/06-rotation.png)

Closes a gap listed as "not reviewed": removing the env **and** rotating from configured root A to configured root B both leave the root-A copy unreachable, as a clean `404`, never a crash or wrong bytes. The doc's one-way-migration bullet spells out only the remove-the-env direction — worth adding the A→B rotation sentence, since an operator moving between two volumes is the more likely mistake.

### Observations (not blockers)

- **Where the new orphan-reaper cleanup actually runs.** `deleteDaemonSessionIfOrphan` has four call sites in `routes/session.ts`; three are error-rollback paths and the fourth is the client-disconnect branch `if (!res.writable)`. On Node 22 `res.writable` stays `true` after the peer socket is destroyed — confirmed with a 10-line `http.createServer`, and E2E: a raw socket that sends a complete `POST /session` and then destroys itself leaves the session live and both seeded attachment dirs untouched. That branch is pre-existing `main` code this PR does not touch; flagging it only because it narrows where the newly added cleanup fires in practice.
- **Round-10 `D10-1`** (the reaper's `removal.kind !== 'error'` gate skipping cleanup when the row was removed but a later step errored) is real, but `deleteDaemonSessions` on `main` carries the identical gate — the PR mirrors existing behavior rather than introducing an asymmetry, so it belongs to the same follow-up.

### Not verified

- Windows and macOS.
- A symlinked `runtimeBaseDir` (the `path.resolve` symlink-following question raised in the prior review).
- Concurrency between a remove and a session restore under real load — only the single-process ordering was exercised.

Full logs, screenshots and a Chinese report: [`assets-pr10066`](https://github.com/wenshao/qwen-code/tree/assets-pr10066) on the fork.
