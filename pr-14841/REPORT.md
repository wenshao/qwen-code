## Maintainer verification: real-stack A/B at `55fb2f3`

**Verdict: mergeable as is.** The new diagnosis is correct, and it reaches the default path. I found no blocking issue. The writer side is a separate matter: there, the drop note this PR adds never fires, and the follow-up planned in this thread would undo the PR's effect on that path. Details are under *Planning the follow-up* below.

**Setup.** I built two real CLI bundles on Linux x64: the merge-base `6ec1b83` and this head `55fb2f3`. Main has not touched `packages/core/src/memory/` since the merge-base, so this head is also the merge result for this code. Each run used a fresh `HOME` and git project and talked to a loopback fake OpenAI server. I read the project-tier `MEMORY.md` block straight out of the **HTTP request body** the CLI sent, so what's quoted below is the text the model receives. No real model was involved.

The author's earlier TUI round already covered the hand-written fixture and the controls on macOS. I re-ran those on Linux and spent most of the time on the path that round didn't exercise: a `MEMORY.md` that qwen itself regenerates from topic files.

### 1. Hand-written index: fixed as described

![wire A/B](./fig1-wire-ab.png)

| Scenario (hand-written `MEMORY.md`) | base `6ec1b83` | head `55fb2f3` |
| --- | --- | --- |
| 170 entries × 150 units, all legal (25,669) | `index entries are too long` + `Keep index entries to one line at most 150…` | `too many index entries (170)` · `Dropped 5 of 170 entries: "Topic 165", "Topic 166", "Topic 167", +2 more` · `prune or merge entries` |
| 250 lines × 150 units (line cap and char budget) | per-line advice | `Dropped 85 of 250 entries` (35 by budget + 50 by line cap) ✔ |
| 3-entry in-budget control | no warning | no warning |

### 2. Default path: the writer trims first, so the reader names nothing

![writer path](./fig2-writer-path.png)

In the interactive TUI, a memory write calls `refreshMemoryAfterManagedWrite`, which calls `rebuildManagedAutoMemoryIndex`. The writer runs the same `trimIndexToBudget` and appends its own 126-unit `INDEX_TRUNCATION_NOTICE`. By the time the reader sees the file, the body is already ≤ 25,000 units. I drove that path for real: seed topic files, ask the TUI to remember one more fact (the fake model answers with a `write_file` into the memory dir), then start a fresh session and capture its request.

| Run | topic files | listed | dropped by writer | what the model gets at head | entries named |
| --- | --- | --- | --- | --- | --- |
| 202 files | 202 | 171 | 31 | `25124 UTF-16 code units … too many index entries (171) … prune or merge entries` ✔ | **0** |
| 201 files | 201 | 170 | 31 | no reader warning; the file is 24,989 units, so the writer's own `Keep index entries concise and move detail into topic files.` passes through, **identical on both arms** | **0** |
| 181 files, 147-unit lines | 181 | 168 | 13 | same as the row above, identical on both arms | **0** |

I then fed synthetic stores through the real writer → reader functions from the built head dist. Over 5,247 random over-budget stores, **every** reader warning carried the corrected cause and lever. **None** named an entry, even though the writer had dropped 416,446 entries across those stores. The 201- and 181-file rows only happen when the writer's lines are nearly uniform in length. They did not occur in the random census, but they are reachable.

So the cause and lever fix lands on the default path. The drop note only fires for a `MEMORY.md` the writer did not regenerate. That happens with hand-edited files, and with headless `-p` sessions, where the post-write rebuild never runs: the rebuild is wired only into `use-llm-stream.ts` and the ACP `Session.ts`. A headless save in this rig wrote the topic file and left `MEMORY.md` untouched. One more detail: the writer sorts newest-first by mtime, so what it drops is the **oldest** memories, and it drops them silently.

The 25,020-unit figure in #14834 sits inside this band: at most 25,000 of body plus the 126-unit notice. For that report, this PR fixes the wording but names nothing.

### Planning the follow-up

Earlier in this thread, the "~126-unit notice edge" was treated as a state where nothing was lost. Two fixes were floated: gate the lever on `dropped.length > 0`, or exclude the notice from the count. On the writer path, entries **were** lost; the writer dropped them before the reader ran. And this band is not an edge. It is where every writer-generated over-budget index lands.

I simulated "exclude the notice from the count" against head's reader. On 1,997 out of 1,997 writer-generated over-budget stores, the reader goes silent and the model is back to the writer's `Keep index entries concise…`. The real 202-file `MEMORY.md` above does the same. Gating the lever on `dropped.length` would drop `prune or merge` in that same state. I'd do the follow-up on the writer side instead: carry the drop count and names, or at least the count, in the notice the writer stamps, and give that notice the same count-vs-length wording this PR gives the reader.

### 3. Correctness and test strength

![evidence](./fig3-evidence.png)

- **Writer output unchanged.** I ran a differential fuzz of head vs base `trimIndexToBudget` over 20,000 random indexes (BMP/CJK/emoji, 0–260 lines, lines up to 26k units): 0 mismatches. `trimIndexToBudgetDetailed` had 0 violations of "every input line lands in exactly one of `content` / `dropped`, in index order".
- **Tests.** The three touched test files pass at head: 90 passed, 1 skipped. The full `src/memory/` suite passes on this box: 1101 passed, 2 skipped, 0 failed; `recall-scan-latency` passed here. As a negative control, the PR's `prompt.test.ts` against base `prompt.ts` fails exactly the 3 new tests and passes the other 45.
- **Mutation sweep.** 7 of 8 mutants were killed. The survivor removes `overLineCap` from `dropped` on the budget path, i.e. when the line cap and the char budget are both exceeded. Behaviour is correct at head (the 250-line row above), but no test pins it.

### Non-blocking suggestions

1. **Surrogate split in drop-note names.** `droppedEntryName()` cuts at 59 code units without the back-off that `truncateIndexField()` in `indexer.ts` applies for exactly this reason. A dropped title with 😀 straddling the cut puts a lone surrogate on the wire. Raw request bytes: `"AAAA…A\ud83d…"`. Python's strict UTF-8 re-encode of that body fails with `surrogates not allowed`. I did not test a real provider. The fix is the same two-line guard.
2. Pin `Dropped 85 of 250 entries` for the combined line-cap + char-budget case, which kills the surviving mutant.
3. Optional: the description says the warning tells the reader "which memories just went invisible this session". That holds for indexes the writer didn't regenerate. A note scoping it to that case would set expectations.

**Not covered.** No real model; the fake provider proves only the payload qwen-code sends. Linux only; the logic is pure string handling, and CI's lint/static, unit and integration jobs are green at `55fb2f3`. The census uses synthetic topic docs fed through the real writer function rather than real user stores.

The figures, harness, raw data and wire excerpts for every scenario are in this directory (`harness/`, `data/`).
