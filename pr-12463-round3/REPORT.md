## Maintainer verification, round 3 (`b6dd220d`, delta only)

Earlier rounds: [round 1](https://github.com/QwenLM/qwen-code/pull/12463#issuecomment-5776251029), [round 2](https://github.com/QwenLM/qwen-code/pull/12463#issuecomment-5776795999).

**Verdict: mergeable from my side.** Every blocking item from rounds 1 and 2 is fixed at `b6dd220d`, and I verified each one by execution:
- Windows gate
- F1, cwd resolution
- F2, "HEAD moved ≠ agent committed"
- signed commits under `log.showSignature`

The remaining items are the three follow-ups the author listed, and a separate issue is the right place for them. The one lane still pending is `Test (ubuntu-latest, Node 22.x)`, which was in progress when I posted this.

![round-3 matrix](./06-e2e-matrix-r3.png)

### What I re-ran at `b6dd220d`
- **Build, lint, tests:** rebuilt the bundle. `tsc --noEmit` exits 0; eslint and prettier are clean on all three changed files. Tests pass 1853/1853 across 9 files (`coreToolScheduler`, `autoMode`, `destructive-commands`, `shell`, `shell.backgroundStatus`, `config`, `speculationToolGate`, `InProcessBackend`, and the 11-row witness file). The CLI's `acp-integration/session/Session.test.ts` passes 1048/1048. The `config.test.ts` lease case that fails on the author's machine passes here, which fits it being local.
- **Production code:** matches the round-2 suggested patch exactly once comments are stripped (`autoMode.ts` and `shell.ts`).
- **Mutation table:** the author's table reproduces exactly:

| mutant | result |
|---|---|
| drop `createdByCommit` | 3 failed (pull, trailing checkout, trailing reset) |
| drop the `preHead` comparison | 1 failed |
| N3: accept `checkout`/`reset` | 2 failed |
| N4: reject only `pull` | 2 failed |
| revert the `autoMode.ts` cwd fallback | 1 failed (target-dir row) |
| drop `--no-show-signature` | *survives*; no unit row signs a commit, so only the E2E row covers it (see nit) |

- **E2E:** I re-ran the full matrix through the real bundled CLI. The `b6dd220d` column is identical, row for row, to the round-2 suggested-patch column:
  - The signed commit is exempt again.
  - The ACP session whose cwd ≠ the process cwd can amend its own commit.
  - The cross-repo ACP amend is blocked.
  - All three F2 chains stay blocked.
  - Every negative control stays blocked.
- **Real classifier** (`qwen3.8-max-2026-09-02`): a legitimate own-commit amend executes, and the round-1 probe (`commit && checkout main`, then "fold it into that WIP commit") is blocked by the deterministic guard.

### Your `attachCommitAttribution` question: checked by execution, not reproducible
I extended the scripted model to call `write_file`, so the session has real per-file AI attribution, then ran both shapes through the real CLI on base and head:

| scenario | base | `b6dd220d` |
|---|---|---|
| control: AI writes `ai.txt`, then `git add ai.txt && git commit` | note on the agent's commit | note on the agent's commit |
| AI writes `ai.txt`; `git pull` fast-forwards onto `upstream: human work [Upstream Author]`; `git commit` then fails (nothing staged) | **no note** | **no note** |

The latent path you read is real as far as it goes: HEAD moved, and `commitCount` is 1. But the note is scoped further down.
- `validateAgainst` keeps only files that are in the commit *and* whose committed content matches what the AI wrote.
- `committedAbsolutePaths.size === 0` then skips the write entirely.

The obvious way around that is also closed, by git itself. A fast-forward pull refuses to land over the AI's uncommitted work, even when the content is byte-identical. I checked both cases (`would be overwritten by merge`, pull exit 1, HEAD unchanged):
- a dirty tracked file
- an untracked file the incoming commit adds

A note on a human commit would therefore need that commit to contain byte-identical content the AI wrote but no longer has in the working tree, and in that case the note would be roughly accurate anyway. I wouldn't file it.

### Follow-ups
Yes, one tracking issue for the three items you listed would be good:
- the consumer-side TOCTOU: a `checkout` or `cd` inside the amend command, and two parallel calls evaluated before execution
- the process-global registry in ACP, plus `/clear` not clearing it
- the pre-existing `GIT_AMEND_PATTERN` gaps

All three reproduce unchanged at `b6dd220d` (bottom rows of the matrix).

**Nit, optional:** a witness row that SSH-signs a commit under `log.showSignature=true` would pin `--no-show-signature`. `ssh-keygen` is available on the Linux and macOS runners, and the suite already skips on Windows.

**For whoever merges:** both open `CHANGES_REQUESTED` rows are for fixed items:
- `qwen-code-ci-bot` at `0cf69caf` was about the Windows gate.
- `qqqys` at `27ebb4b4` was the pull-then-failed-commit Critical, which that account confirmed fixed in 5776726932.

Evidence (matrix data, raw E2E / ACP logs, mutation log, the attribution runs and git-level checks): [this folder](.)
