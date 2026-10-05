## Maintainer verification: real local build on Linux @ `87682bc`

**Verdict: ready to merge.** I found no blocking issues. On every real surface I ran (the CLI, the headless model request, the daemon routes and the failure path), the PR behaves exactly like main. The two new tests catch every broken loop I tried. The speedup reproduces on Linux and is larger than the macOS figure in the description. I have two non-blocking notes at the end.

This also fills the two gaps the automated reviews left open. The triage review said the speedup had not been independently reproduced. The `/review` round did not run the two new tests (it hit its tool budget).

**Setup**
- I used two isolated worktrees: `main@71fefc7` (the PR's merge base) and `PR@87682bc`. Each got `pnpm install --frozen-lockfile`, a full `npm run build` and `npm run bundle`, all exit 0. I checked both bundles: main has the serial `for…of` loop, and the PR has the `batchSize = 4` / `Promise.allSettled` loop.
- Machine: Linux 6.12 (KVM, 16 vCPU), Node 22.22.2. Fixtures sit on ext4/NVMe unless noted. Each run gets an isolated `HOME`, and model requests go to a fake OpenAI endpoint that records them.
- The PR merges cleanly with current `main` (`f2e0690`). No commit since the base touches `packages/core/src/extension/`, where the loop and all three of its callers live.

| Check | main@71fefc7 | PR@87682bc |
| --- | --- | --- |
| `extensionManager.test.ts` | 185 / 185 | **187 / 187** |
| PR's two new tests run against main's serial loop (negative control) | **2 fail** (`loadExtension` called 1×, expected 4×); 185 pass | n/a |
| 10 loop mutants against the full test file | n/a | **10 / 10 killed**; the two new tests alone kill all 10 |
| Real `qwen extensions list`, rich fixture (1153 lines) | sha256 `a56c4c16fd56` | **byte-identical** |
| Real `qwen -p`: request the model sees (243,090 chars, 855 skills, 17 context files in order) | | **identical** (both requests, after uuid/timestamp normalization) |
| Real `qwen serve`: status, `/summary`, `/extensions`, 5× `/:name/details`, 24 concurrent reads | | **all bodies identical**; `details(dupe)` → `2.0.0 b02-dupe-second` |
| Dangling symlink in the extensions dir | exit 1, `ENOENT … stat` | identical |
| ESLint `--max-warnings 0` and Prettier on the changed files | | clean |
| CI | | 14 pass, 33 skipped, 0 fail |

### 1. Real CLI end to end

The fixture has 21 entries, which makes 6 batches of 4. Batch 2 holds two manifests named `dupe`:
- `b00-dupe-first`: version 1.0.0, 300 skills, so it finishes last in its batch.
- `b02-dupe-second`: version 2.0.0, 1 skill.

The serial loop's last-name-wins rule picks `b02`. The fixture also has:
- a malformed manifest
- a linked extension
- an Agent Plugins v1 plugin
- a plain file
- an extension with hooks
- `d00`…`d07`, which shrink in size so each batch finishes in reverse directory order

To prove the comparison can catch a bug, I patched the PR bundle to read each batch's results in completion order instead of directory order. That broken build picks `dupe (1.0.0) b00-dupe-first`, sends the model 1154 skills instead of 855, and reorders the context files. So the loads really do overlap inside the bundled CLI, and reading results in directory order is what keeps the output identical.

![real CLI E2E](e2e-real-cli.png)

### 2. New tests: negative control and mutation matrix

Each mutant replaces only the PR's outer loop. All ten are killed:
- serial, batch 8, unbounded
- `Promise.all` fail-fast: caught by the drain assertion, since the scan settles before the in-flight sibling finishes
- completion-order consumption
- first error by time
- keep scanning after an error
- no null filter
- swallow rejections: two existing fail-closed tests also catch this one
- a sliding pool of 4

![unit tests, negative control, mutation matrix](unit-negctl-mutation.png)

### 3. Performance

Panel A of the figure below. All values are medians. The fixture matches the author's benchmark: 100 extensions × (40 skills, 10 commands, 5 agents).

| Scenario | main | PR | Δ |
| --- | ---: | ---: | ---: |
| Author's `bench-extension-load.ts --runs 10`, tmpfs (3 rounds, interleaved) | 894 ms | 265 ms | **−70%** |
| Same benchmark, fixture on ext4 | 866 ms | 265 ms | **−69%** |
| First refresh in a fresh process, warm cache (n=15) | 991 ms | 358 ms | **−64%** |
| Real CLI `qwen extensions list` wall clock, warm (n=15) | 1.32 s | 686 ms | **−48%** |
| First refresh, cold cache (`drop_caches`, n=8) | 6.07 s | 1.67 s | **−72%** |
| Real CLI wall clock, cold cache (n=8) | 6.60 s | 2.23 s | **−66%** |

- **No extra work.** Each refresh does 9,116 async fs operations on both arms.
- **Bounded pressure.** Peak in-flight async fs operations go from 2 to 4. Peak open fds go from 23 to 26 (22 at idle). Peak RSS is about 190 MB on both.
- **Larger batches add little.** On the uniform fixture, batch 4 takes 357 ms, batch 8 takes 336 ms, and batch 16 takes 328 ms. 4 is a sensible bound.

![benchmarks](benchmark.png)

### Non-blocking notes

1. **How much the barrier keeps depends on extension sizes (panel B).** The barrier waits for the largest entry in each batch before it starts the next one. I swapped only the loop in the same built dist and compared it with a sliding window of 4 that keeps the same guarantees: results in directory order, no new loads after the first rejection, in-flight loads awaited, and the first error in directory order rethrown.
   - Uniform sizes: barrier −64%, pool −62%.
   - Mixed sizes (2×60, 4×15 and 18×2 skills, three shuffles): barrier −23 to −26%, pool −35 to −39%.
   - Worst case (one 400-skill entry in every batch): barrier −5%, pool −62%.

   The design doc accepts this trade-off on purpose, so I would not block on it. If a follow-up switches to a pool, the first new test needs updating: it asserts that no new load starts after 3 of 4 have finished, which pins the barrier itself. My sketch is in `harness/make-variants.py`.
2. **A pre-existing crash, outside this PR's scope.** One dangling symlink in `~/.qwen/extensions/` makes the whole scan fail. `qwen extensions list` exits 1 and `qwen -p` dies with `An unexpected critical error occurred`. Main and this PR behave exactly the same, because the design doc deliberately keeps the set of errors that fail the scan. Skipping the entry with a warning when its `stat` fails would be worth a separate issue.

**Not covered:** Windows (no machine available), macOS (the author covered it), network filesystems, and end-to-end daemon startup time.

Evidence (scripts, fixtures, raw data and transcripts): this directory (`harness/`, `data/`).

