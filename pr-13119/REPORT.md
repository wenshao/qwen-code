## Maintainer verification — PR #13119 at `d0be922868` (Linux, real bubblewrap, real bundled CLI)

**Verdict: I recommend merging.** On Linux, which the PR lists as not yet tested natively, the missing-file window is gone. On the base commit I reproduced it as a real sandbox escape: an agent shell command started during an unrelated settings save wrote to the host outside the workspace. On this head that never happened, across checkpoint probes, crash injection and 1,200 concurrent saves. The PR's Linux acceptance item is covered here: during saves the admitted policy is retained, workspace writes succeed, and writes outside the workspace fail with `EROFS`. I found no blocking defect. One non-blocking suggestion (S1) comes with a validated patch of +13/−2 production lines. The triage `CHANGES_REQUESTED` review said it could be overruled if the design doc recorded why `atomicWriteFileSync` was not used. `d0be922868` adds that section. My measurements on that tradeoff are in the "core helper" section below.

### Environment

- Linux 6.12 x86_64, ext4, Node 22.22. Real `bwrap` 0.12.0 is overlaid at `/usr/bin/bwrap` in a private mount namespace, so the host is untouched. Policy: `tools.executionSandbox = {backend:auto, filesystem:workspace-write, network:closed}` in User settings.
- Arms: **base** = merge-base `78143fe335`, **head** = `d0be922868`. Each has a fresh `pnpm install --frozen-lockfile`, `npm run build` and `npm run bundle`, all exit 0. The PR merges cleanly with current `main`, which is one unrelated commit ahead.
- Everything was isolated: `QWEN_HOME`, `HOME`, and the System and System-defaults paths all point to scratch locations. A scripted local OpenAI-compatible model drives `run_shell_command`.

### Summary of checks

| Check | Base `78143fe335` | Head `d0be922868` |
| --- | --- | --- |
| Real writer (`qwen -p "/language ui en"`) paused after **every** fs step; independent `qwen sandbox` + `qwen -p` agent at each step | At step #2 (`rename settings.json → .orig`): target absent, `Tool execution sandbox: none`, **agent wrote outside the workspace** | 8/8 probe points: complete target, `bwrap (full)`, outside write `EROFS`, inside write OK |
| Writer `SIGKILL`ed at each step, then a new startup, then an ordinary save | Kill at #2: **policy lost permanently**. The next save recreates `settings.json` without it, and the agent still escapes | 6/6 kill points: complete target with policy |
| Concurrency: compiled writer (300 saves/process) vs 2 reader processes running the real `readOperatorSandboxSettings()` | 1 writer: 186 policy-loss reads, 226 absent reads. 2 writers: 61/600 saves failed, 547 policy-loss, 572 absent, **3 torn JSON reads** | 1 and 2 writers: 900/900 saves OK, **0** absent / torn / policy-loss over ~487k samples |
| Live `SettingsWatcher` (chokidar), 5 external saves | 5 `modified` batches, memory updated | identical, no spurious events from the private dir |
| PR's 6 focused test files | — | 383/383 pass. CI `Test (ubuntu-latest)` passed on this head |
| Negative control: base writer put back under the PR's tests | 7/14 fail, including the real-reader checkpoint test | — |
| Targeted mutants of `write-with-backup.ts` | — | 11/11 behavioural mutants killed. 4 equivalent survivors (see below) |

### Fig. 1 — the security consequence, end to end

The writer is paused at the equivalent point in each arm. On base that is after the target moves away. On head it is after the backup copy and just before publication. A second terminal then starts independent `qwen` processes.

![gap checkpoint terminal](01-gap-checkpoint-terminal.png)

### Fig. 2 — every checkpoint, and a crash at every checkpoint

![checkpoint and crash matrix](02-checkpoint-and-crash-matrix.png)

The base crash row at #2 is the worse form of the bug, as triage suspected: it is not a microsecond race. The next ordinary save sees an empty User scope and writes `settings.json` **without** the policy. From then on every start runs unconfined, and the policy survives only in an orphaned `.orig` that nothing reads.

### Fig. 3 — concurrency, and a publication that keeps failing

![concurrency and persistent failure](03-concurrency-and-persistent-failure.png)

The base two-writer failures come from the shared `settings.json.tmp`/`.orig` paths. The target inode can only be half-written if a writer is still writing into a temp inode that another writer has already renamed onto the target. That is the source of the 3 torn reads. The per-invocation directory on head removes this class of failure.

### Unit tests, negative control, mutation

- The six files listed in the PR pass: `write-with-backup`, `jsonc-editor`, `settings`, `execution-sandbox-settings`, `loadedSettingsAdapter` and `settingsWatcher`, **383/383**.
- 15 targeted mutants of the new writer ran in one vitest pass, each in its own untracked copy. **Killed:** base writer restored, rename-away reintroduced, automatic restore reintroduced, shared working directory, cleanup error rethrown, no success cleanup, recovery copy deleted, no failure cleanup, recovery path not reported, copy failure ignored, and encoding option ignored. **Survived, all equivalent or defence in depth:** `flag:'wx'`, `COPYFILE_EXCL`, `flush:true`, and the directory pre-check. The pre-check is equivalent because `copyFileSync` already refuses a directory target with `EISDIR` and the same cleanup runs.

### S1 (suggestion, non-blocking) — recovery directories accumulate while publication keeps failing

When the final rename fails, the target was never touched by this writer. If no other writer has published since, the retained `settings.json.orig` is byte-identical to the live target and recovers nothing. It is still kept, and the design doc accepts this ("Repeated failed saves … can leave multiple private directories"). A persistently failing environment is easy to reach. With a **single-file bind mount** of `settings.json`, as in container setups, `rename` always returns `EBUSY`. If that file has an older `$version`, **every real CLI start** attempts the normalisation save and fails quietly. Head then left one new directory per start, 3 after 3 starts, each holding a full copy of the settings. Base, and core's `atomicWriteFileSync`, fail the same save and leave nothing.

Suggested fix: keep the recovery copy only when it differs from the current target. That covers the "writer A fails after writer B publishes" case the PR cares about, and the existing test still pins it.

<details><summary>Patch excerpt (+13/−2 production; the EPERM/EACCES tests are updated and one accumulation test is added) — applies cleanly to d0be922868</summary>

```diff
@@ -88,8 +88,12 @@
     fs.renameSync(tempPath, targetPath);
   } catch (error) {
+    // A copy identical to the untouched target recovers nothing; keeping it
+    // would leave one directory per failed save when publication keeps failing.
+    const recoveryRetained =
+      backupCreated && !sameContents(backupPath, targetPath);
     try {
-      if (backupCreated) {
+      if (recoveryRetained) {
         fs.unlinkSync(tempPath);
       } else {
         fs.rmSync(workingDirectory, { recursive: true, force: true });
@@ -97,7 +101,7 @@
     } catch {
       // Cleanup must not obscure the write failure or remove a recovery copy.
     }
-    if (backupCreated) {
+    if (recoveryRetained) {
       throw new Error(
@@ -112,3 +116,11 @@
     // Publication already succeeded; leftover artifacts do not invalidate it.
   }
 }
+
+function sameContents(first: string, second: string): boolean {
+  try {
+    return fs.readFileSync(first).equals(fs.readFileSync(second));
+  } catch {
+    return false;
+  }
+}
```

The full diff, including tests, is in `patch/drop-identical-recovery-copy.diff`.

</details>

How the patch was validated:
- With the patch, the test file passes 15/15. The new or updated tests fail 3/15 on the unpatched head, so they discriminate.
- `eslint --max-warnings 0`, `prettier --check` and cli `tsc --noEmit` are clean.
- A patched bundle was rebuilt and all three scenarios re-run:
  - bind-mount starts: **0** leftovers;
  - checkpoint probes: 0 escapes;
  - two-writer stress: 600/600 saves, 0 anomalies.
- The watcher behaves the same as on head.

Separately, a crash leaves a `settings.json.write-XXXXXX/` directory that later saves never remove. This is by design ("no new scavenger"). I mention it only so the trade-off is explicit.

### On the `atomicWriteFileSync` question (maintainer call)

Measured with the same real saves:

| | Base | PR head | core `atomicWriteFileSync` |
| --- | --- | --- | --- |
| Missing-file window | **yes** | no | no |
| `0600` file after a save | `0644` | `0644` | `0600` kept |
| Symlinked `settings.json` (dotfiles) | replaced by a regular file | replaced by a regular file | written through, link kept |
| Single-file bind mount | `EBUSY`, nothing left | `EBUSY`, +1 dir per failed save (S1) | `EBUSY`, nothing left |
| EPERM/EACCES rename retry | no | no | yes |

- The PR does not regress permission or symlink behaviour. It keeps the base behaviour, as its design doc says.
- The mode-widening and link-replacement gaps predate this PR. They would be a reasonable follow-up, independent of merging this.
- The design doc's argument against core rests on core's `EXDEV` fallback. In the scenarios run here, ext4 and a single-file bind mount, no same-directory rename returned `EXDEV`. The bind-mounted file gives `EBUSY` for all three writers, and neither core option triggered its fallback. The case for merging this PR does not depend on that argument either way.

### Not verified here

- Native Windows replacement and refusal.
- macOS. The author covered it.
- Network filesystems and power-loss durability.

### Reproduce

The harness, raw results and patch are at this directory:

- `harness/checkpoints.mjs`: the paused real-writer probes and crash matrix.
- `harness/stress.sh`: the concurrency runs.
- `harness/bindmount-startups.sh`: the S1 reproduction.
- `harness/ns-bwrap-overlay.sh`: the private bwrap overlay.
