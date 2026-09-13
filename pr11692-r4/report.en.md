## Round 4 verification — `6645d55`: the bounds, the qualified partial-result wording, and the new tests

Scoped to what changed since [round 3](https://github.com/QwenLM/qwen-code/pull/11692#issuecomment-5654368701) at `2176e5a`: three commits, 9 files, +125/−12. There is no new merge of `main` (the merge base is still `bc7a186`) and no lockfile change.

**Verdict: merge-ready. Nothing new to fix.**
- **Bounds.** Round 3's suggestion is implemented correctly, and every write path now enforces the range.
- **Wording.** The qualified R1-1 sentence matches the runtime on every branch I could construct.
- **Tests.** Each of the five new tests fails when the code it guards is broken.

### What changed

| Commit | Change |
| --- | --- |
| `01ec3e4d25` | `minimum: 1, maximum: 600000` on `tools.webSearch.timeoutMs`, plus a witness test |
| `cecf8ced39` | The partial-result promise is qualified on all four surfaces (R1-1). `MAX_WEB_SEARCH_TIMEOUT_MS` is exported from core and the schema uses it (R1-2). Three core tests are added (R1-3/4/5). |
| `6645d558ad` | The two constants are added to two exhaustive core mocks |

**Round 3's live data still applies.** The runtime search path is untouched: `web-search-dashscope.ts` has no change, and the only non-test line changed in `web-search.ts` turns the cap into an export. So round 3's live Token Plan matrix still describes this head, and I did not spend the key re-running it. Instead I re-ran the timeout shapes on both heads with the fake upstream; the results are below and identical.

### Build and tests — Linux, head `6645d55`

| Step | Result |
| --- | --- |
| `packages/core`: `web-search.test.ts` + `config.test.ts` | **873 passed** (round 3: 869, plus the 4 new tests) |
| `packages/cli`: `config` + `settingsSchema` + `settingsUtils` + `acpAgent.worktree` + `facade` | **700 passed** (5 files) |
| `npm run generate:settings-schema` | **no diff** |
| Bundled CLI | The runtime description reads `default 120000, max 600000`, as returned by the daemon's `GET /workspace/settings`. So the module-scope import of the core constants resolves in the bundle and renders no `undefined`. |

### The bounds, on every write path

**Boundary sweep through `/config` on the real bundled CLI:**

| Value | `6645d55` |
| --- | --- |
| `700000` | rejected — `Value must be <= 600000` |
| `600001` | rejected — `Value must be <= 600000` |
| `600000` | saved |
| `1` | saved |
| `0` | rejected — `Value must be >= 1` |
| `-5` | rejected — `Value must be >= 1` |
| `1.5` | saved (`integer` was left out on purpose in round 3) |
| `90000` | saved |

**The other write paths, on both heads:**

| Write path | `6645d55` | `2176e5a` |
| --- | --- | --- |
| `/settings` dialog | `700000` not saved; `90000` saved | `700000` saved |
| daemon `POST /workspace/settings` (scope `user`) | `700000`, `600001`, `0` → **400 `invalid_value`**; `600000`, `1.5`, `90000` → 200 | every value → 200 |
| daemon `POST /workspaces/:workspace/settings` (scope `workspace`) | `700000`, `0` → **400 `invalid_value`**; `90000` → 200 | every value → 200 |

Round 3 checked the daemon route by reading only. Here it is driven against a real `qwen serve` on both arms.

![/settings on the round-3 head vs 6645d55](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11692/pr11692-r4/01-settings-bounds-before-after.png)

### R1-1 — the qualified wording against the runtime

The budget is 3 s, and the fake upstream goes silent after the listed events. Both heads get the same bytes.

| What arrived before the upstream went silent | 6645d55 | 2176e5a |
| --- | --- | --- |
| a narration delta only; the search call still in flight | `Web search timed out after 3s.` — the narration is dropped | identical |
| one `web_search_call` with status `failed`, plus narration | `Web search timed out after 3s.` | identical |
| extractor page text (13,145 chars) completed; the search call still in flight | `Web search timed out after 3s.` — the page text is dropped | identical |
| control: a search call completed, plus a page read | `Did 1 search in 3.0s (partial result)` — 7,438 chars, labeled | identical |

- **The first and third rows are exactly the case the new wording describes:** "if the budget expires before the first search call finishes, the tool reports a timeout error instead".
- **The control is the "once at least one search call has completed" case.**
- **A wording nit, not worth a respin.** A `failed` search call has finished, but the runtime counts it as no search (second row). "Completed successfully" would be exact.

### Mutation checks — the five new tests discriminate

Each mutation was applied on its own to the `6645d55` tree. I re-ran the owning suite, then restored with `git checkout` and confirmed the tree was clean. Unmutated, the suites pass 118/118 (core) and 59/59 (cli).

| Mutation | Killed by |
| --- | --- |
| R1-3: the timeout arm moved above partial salvage | *salvages the partial result when the budget expires after a search ran* |
| R1-4: plain `slice` instead of `sliceAtCharBoundary` | *does not split a surrogate pair when salvaged page text is truncated* |
| R1-5: the automatic path skips `resolveWebSearchTimeoutMs` | *normalizes an out-of-range budget on the automatic path* |
| R1-5: the env-declared path skips it | *normalizes an out-of-range budget on the explicit and env-declared paths* |
| R1-5: the explicit path skips it | the same test |
| schema `maximum` hand-copied as `500000` | *should bound tools.webSearch.timeoutMs to the runtime contract* |
| schema `minimum` dropped | the same test |

Each mutant failed exactly one test, the one that claims the property.

### Observations — no action needed

1. **`/settings` rejects a value silently.** After Enter the row just shows no value; the validation-failure branch clears the edit without saying why. This applies to every bounded field and predates this PR. `/config` and the daemon do report the reason.
2. **The daemon's descriptor carries no `minimum`/`maximum`.** `GET /workspace/settings` returns only `category`, `description`, `key`, `label`, `requiresRestart`, `type` and `values`. A Web Shell form therefore cannot pre-validate the range and relies on the server's 400. Same for every bounded setting, and pre-existing.

### Not verified

- A live Token Plan re-run: the runtime path is unchanged since round 3.
- Windows.
- The Web Shell settings form UI. The daemon route was driven directly.

CI on `6645d55` at the time of writing: 24 passed, 24 skipped, and `review-pr` still running. The automated review's CHANGES_REQUESTED was filed against `01ec3e4d25`; all five of its findings are addressed by `cecf8ced39` and exercised above.
