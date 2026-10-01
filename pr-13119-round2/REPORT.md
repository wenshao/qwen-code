## Maintainer verification, round 2 — PR #13119 at `a8beb51cd5` (delta since round 1)

**Verdict: still recommend merging.** S1 from [round 1](https://github.com/QwenLM/qwen-code/pull/13119#issuecomment-5918187683) is fixed. The production change in `a8beb51cd5` matches my round-1 patch line for line; only the comment wording differs. I rebuilt this exact commit (fresh `pnpm install --frozen-lockfile`, `build` and `bundle`) and re-ran the round-1 harness on it rather than reusing my patched arm. On Linux, with the real bundled CLI and real bubblewrap:

- A save that keeps failing no longer leaves directories behind.
- A recovery copy that differs from the live file is still kept and is never rolled back over it.
- The central claim from round 1 is unchanged.

I found nothing blocking. The three `/review` suggestions on this head ([review](https://github.com/QwenLM/qwen-code/pull/13119#pullrequestreview-5374744598)) are test hardening. I executed each one, and two of them need a correction before being applied as written (details below).

### What changed since round 1

- `a8beb51cd5` touches only the catch path of `write-with-backup.ts` (+15/−3), its test file and the two design docs. The success path is byte-identical to `d0be922868`.
- CI is green at this head: `Qwen Code CI` (run 36773502303 attempt 2, including `Test (ubuntu-latest)` and `Lint & Static`), `SDK Java` and `tui-parity`. Classify PR skipped `Test (windows-latest)` and `Test (macos-latest)`.
- The PR merges cleanly into current `main` (`310f4ba3ab`, 9 commits past the base). The merged tree has no leftover import of the old `writeWithBackup.js` filename.

### Results at `a8beb51cd5` (Linux 6.12 / ext4, Node 22, bubblewrap 0.12.0)

| Check | Round 1 head `d0be922868` | Round 2 head `a8beb51cd5` |
| --- | --- | --- |
| **S1 repro.** `settings.json` is a single-file bind mount, so every rename fails with `EBUSY`. `$version: 3` makes every start attempt a normalisation save. Three real `qwen sandbox` starts. | 1 → 2 → 3 private dirs, each an identical copy | **0 → 0 → 0**. The sandbox reports `bwrap (full)` on every start. Base `78143fe335` also leaves 0. |
| **Differing copy.** The real writer is paused right after its backup copy. Writer B rewrites the bind-mounted file in place. The writer is released and gets `EBUSY`. Run once through the CLI startup save and once through the compiled writer called directly. | Copy kept; target keeps B's bytes | **Same.** The copy holds the pre-B bytes, the target keeps B's bytes and nothing is rolled back. The error names the copy path (verbatim in Fig. 1). |
| The real writer is paused after every fs step. At each step an independent `qwen sandbox` and a `qwen -p` agent run. | 8/8 confined | **8/8.** Target complete, `bwrap (full)`, writes outside the workspace fail with `EROFS`, writes inside succeed. |
| `SIGKILL` at each step, then a new start, then an ordinary save | 6/6 keep the policy | **6/6** keep the policy, 0 escapes |
| Stress: compiled writer against 2 processes calling the real `readOperatorSandboxSettings()` | 900/900, 0 anomalies | **900/900** saves. **0** absent, torn or policy-lost reads over 470,205 samples. |
| The PR's six focused test files | 383/383 | **386/386** (writer tests 17/17) |
| Mutants of `write-with-backup.ts` | 11/11 behavioural mutants killed | **20 of 21 killed.** Of the 9 new mutants of the comparison, 8 are killed and 1 is equivalent (comparing UTF-8 strings instead of bytes). Negative control: the round-1 writer fails 3/17 under the new tests. |

**Fig. 1 — the S1 reproduction before and after the fix (real terminal output, the same script for both arms)**

![bind mount persistent failure](01-bindmount-persistent-failure-terminal.png)

**Fig. 2 — the round-1 matrix re-run on the `a8beb51cd5` build, plus mutation of the new code**

![rerun matrix](02-rerun-matrix-a8beb51cd5.png)

These comparison mutants were killed:

- keeping every copy (reverts the fix);
- treating every copy as identical;
- treating an unreadable input as identical;
- comparing the staged file instead of the backup;
- leaving the directory behind in the identical case;
- still naming a removed copy in the error;
- comparing sizes only;
- comparing even when no backup was made.

The four equivalent survivors from round 1 (`wx`, `COPYFILE_EXCL`, `flush` and the directory pre-check) are in unchanged code, so I did not re-run them.

### The `/review` suggestions on `a8beb51cd5`, executed

| Item | What I ran | Result |
| --- | --- | --- |
| **R1-2**: the failure-path cleanup `try/catch` has no test | Removed that `try/catch`, then ran `write-with-backup.test.ts` | **Confirmed.** All 17 tests stay green. |
| **R1-3**: the assertions at `loadedSettingsAdapter.test.ts:543` and `:552` (`existsSync(target + '.orig')`) can no longer fail | Dropped the post-publication `rmSync`, then ran the adapter tests | **Confirmed.** All 23 stay green. Retargeting the assertions to `readdirSync` works: 23/23 on the clean head, 21/23 under the mutant. **Correction:** the suggested `toEqual(['settings.json'])` at `:543` fails on the *clean* head for `existing: false` (22/23), because the rollback correctly restores absence and leaves `userHome` empty. Use `existingFile ? ['settings.json'] : []` there. |
| **R1-1**: the watcher guards for `settings.json.write-*` are unpinned | Ran `settingsWatcher.test.ts` against both example mutants. Then probed the surviving one with live, real chokidar: 8 saves, each followed 30 ms later by an in-place external edit. | **Partly confirmed.** Widening `:173` to `startsWith` is **already killed**: 2/47 tests fail (`should ignore .tmp files`, `should ignore .orig files`). Dropping `&& changedPath === dir` at `:169` does survive (47/47). With real chokidar that mutant has **no effect on ordinary saves**: 0 `demoteScope` calls on both arms and 8/8 edits picked up. Each save's private dir exists for about 0.3 ms, and chokidar never registers it. A private dir that lived 800 ms before deletion did trigger 1 demote, against 0 on the clean arm, and the next edit was still picked up. That case corresponds to a retained copy, or a crash leftover the user later deletes. The per-save churn described in the review did not reproduce. The suggested test is still cheap hardening. |

None of these blocks the merge. If the author wants to fold them in, a reasonable minimal set is the R1-2 test, with `unlinkSync` added to the mock factory, and the R1-3 `readdirSync` retarget with the `existing: false` correction.

### Still open, non-blocking

- **Crash leftovers are never reclaimed.** The [sandboxed verification](https://github.com/QwenLM/qwen-code/pull/13119#issuecomment-5919142046) raised this at `d0be922868`, and the author deferred it ("no scavenger"). Fig. 2 shows it: 5 of the 6 kill points leave one `settings.json.write-XXXXXX/` directory, and it survives the next ordinary save. With S1 closed, a leftover now requires a SIGKILL, an OOM kill or a power loss during a save. On this host a save takes 0.27 ms at p50 and 0.6 ms at p99 (base: 0.016 ms). I would treat a sweep of stale `${target}.write-*` siblings as a follow-up; it's a maintainer call.
- That sandboxed verification is marked "❌ not passed". Its own report states that all four red assertions are base-arm control expectations, so none of them is a defect in this PR.

### Not verified

- Native Windows replacement and refusal. This remains open, as the PR states.
- Network filesystems and power-loss durability.

### Reproduce

The evidence is in this directory:

- `harness/bindmount-r2.{sh,mjs}`: the S1 and differing-copy scenarios, in a private mount namespace.
- `harness/demo-bindmount.sh`: generates Fig. 1.
- `harness/mutants2.py`: the mutants of the new code.
- `harness/review-mutants*.py` and `harness/watcher-r2.mjs`: the `/review` items.
- `data/`: raw results.

The checkpoint, kill and stress harnesses are unchanged from [round 1](https://github.com/wenshao/qwen-code/tree/d6c714baac31c082ff4ef5ac8b230193f2e9e23b/pr-13119/harness).
