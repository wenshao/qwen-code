## Local runtime verification, round 2 (delta) — PR #12404 @ `8363acf1a8`

This round covers only what changed since [round 1](https://github.com/QwenLM/qwen-code/pull/12404#issuecomment-5761788081) (`f6d25c84ec`).

**Verdict: still recommend merge.**

- **Both hardening items from round 1 are fixed.** I checked them on a real daemon:
  - Non-object elements (§6a) are dropped when a message is recorded, replayed and rendered.
  - The count cap (§6b) works. 257 or more elements are not persisted at all. Round 1's 9,301-element (10.3 MB) record is now 430 bytes.
- **The core claim still holds after the two main merges.** The 4 picker tags survive a refresh and a daemon restart, and the file preview returns 200.
- **One residual in the same class as §6a (non-blocking).** An *object* element whose `label`, `value` or `serialized` is not a string passes every new filter. It gets persisted and then fails to render on every load. This corrects the sandbox triage round's F1 ("not a render exploit"). I tested a one-line fix and suggest folding it in (§2).
- **Minor follow-ups, none blocking:**
  - the live echo is not filtered (§3);
  - a title-input change on the retry path (§4);
  - a test gap at the cap boundary (§5).
- **The ride-along test fix `d9b55cd629` is correct** (§6).

### What changed since round 1

- **`72518f83cb`:** validates annotation elements in three places:
  - when recording (`readDaemonInputAnnotations`: object elements only, at most 256);
  - when replaying (`isObjectRecord`, per element);
  - when rendering (a null guard).

  The same commit also adds the shared `DAEMON_INPUT_ANNOTATIONS_META_KEY`, restores the `/advisor` no-payload pin, and updates the docs.
- **`d9b55cd629`:** test-only, in `git-branch-ops.test.ts`. It is not related to tags.
- **Two merges of main:** `ba27ef0d7d` and `8363acf1a8`.

### How this was tested

- **Builds:**
  - **PR** = `8363acf1a8`: a fresh worktree, then `pnpm install --frozen-lockfile` and `npm run build && npm run bundle`.
  - **main** = the merge base `8f86b4f1a8`, built the same way.
  - **fix** = the PR with one line changed in `composerTag.ts` (§2). Only the Web Shell was rebuilt.
  - **mixed** = the PR daemon serving main's Web Shell. This isolates the replay filter from the render guard.
- **Rig:** the same as round 1.
  - Real `qwen serve` → ACP child → JSONL on disk.
  - The daemon's own Web Shell in Chromium (Playwright).
  - A mock OpenAI-compatible provider.
- **Malformed payloads** go through a raw `POST /session/:id/prompt` with the daemon token. The Web Shell never sends them.
- **Environment:** Linux x64, Node 22.

### 1. Round-1 items: fixed

![non-object elements](01-nonobject-closed.png)

| Raw `_meta.inputAnnotations` | JSONL on the PR | PR, live | PR, after refresh and daemon restart |
| --- | --- | --- | --- |
| `[null, "x", 5, true, [null], valid]` | only the valid element | tag | tag |
| 256 elements | all 256 (31.8 KB record) | tag | tag |
| 257 elements | no `systemPayload` | tag (see §3) | plain text |
| 9,301 elements, 10.3 MB body | no `systemPayload` (430-byte record) | tag (see §3) | plain text, `/load` 200 |
| A record already on disk in the `f6d25c84ec` shape (`[null, "x", 5, true, [null], valid]`) | n/a | n/a | tag, also with main's Web Shell, which has no null guard |

- **On main,** the first row fails live with "This message could not be displayed". Main doesn't persist annotations, so after a refresh it shows plain text.
- **The last row** shows that the replay filter alone protects sessions written by earlier builds.
- **Model input:** `inputAnnotations` appears in none of the model requests logged this round.

**Unit tests at head:**

- acp-bridge: 124/124
- core `chatRecordingService`: 147/147
- web-shell (composerTag, UserMessage, QueuedPromptDisplay, transcriptToMessages): 330/330
- cli `Session.test.ts` + `git-branch-ops.test.ts`: 1,067/1,067

**Mutation testing on the new lines: 11 of 12 mutants killed.**

- **Record side:**
  - element filter off;
  - arrays allowed;
  - cap removed;
  - an all-invalid array returns `[]`;
  - no `structuredClone`;
  - the deferred `/advisor` gate forced to `true`. This one shows the restored no-payload pin works (R1-2).
- **Replay side:**
  - filter off;
  - arrays allowed;
  - `[]` forwarded;
  - the key constant drifted.
- **Render side:** null guard removed.
- The one survivor is in §5.

### 2. Residual (non-blocking): object elements with a non-string field

![non-string fields](02-field-types-open.png)

- **Why these get through:** all three new checks only ask whether an element is an object. None checks the field types inside it.
- **Where it breaks:**
  1. `splitComposerTagContentByAnnotations` copies any truthy `label`, `value` or `serialized` into the tag.
  2. `ReadonlyComposerTag` then calls `.trim()` on them, through `getComposerTagLabel` / `getComposerTagValue` and `isPreviewableFileComposerTag`.

| One element with… | main, live | main, after refresh | PR, live | PR, after refresh and restart |
| --- | --- | --- | --- | --- |
| `reference.value: 7` | `TypeError: e.value?.trim is not a function` | plain text | same TypeError | same TypeError, on every load |
| `reference.label: 5` (kind `mcp`) | `e.label?.trim is not a function` | plain text | same | same |
| `reference.serialized: 5` (kind `file`) | `(e.serialized ?? e.value).trim is not a function` | plain text | same | same |

- **Same change as round 1's §6a:** a live-only failure becomes a durable one, this time through a different field.
- **Contained:** the per-message error boundary catches it, and the rest of the session renders.
- **Reachability:** it needs a raw-HTTP client with the daemon token. The Web Shell composer always produces strings.
- **Correction to the sandbox triage round's F1:** F1 said no persisted shape can make the renderer throw, except a throwing accessor.
  - That round measured `splitComposerTagContentByAnnotations`, which does return normally for these shapes. The throw happens one step later, in the React tag component.
  - Its 11 shapes did not include a non-string `label`, `value` or `serialized`.

**Suggested fix, tested.** The same file already has `isValidComposerTag`, which checks:

- `id` is a string;
- `label`, `value`, `kind` and `serialized` are strings or undefined;
- `removable` is a boolean or undefined.

It already validates the tags on the `parseUserMessageContent` path. Reuse it at `packages/web-shell/client/utils/composerTag.ts:216`:

```diff
     if (
-      !reference ||
-      typeof reference.id !== 'string' ||
+      !isValidComposerTag(reference) ||
       start < cursor ||
```

- **Result:** I changed only this line and rebuilt only the Web Shell. All three cases render as plain text with no error, both on the persisted sessions above after a daemon restart and in fresh live sessions.
- **No regressions:**
  - the 4 picker tags, the file preview and the valid tags in the other cases are unchanged;
  - web-shell tests: 330/330.
- **Coverage:** because the check runs at render time, it covers the live echo, new records, and records written by earlier builds.
- **Optional:** a matching write-side check, option (a) in the triage bot's F1, would also keep these elements off disk. It is not needed for correctness.

### 3. The live echo is not filtered (minor)

`pickUserInputEchoMeta` (`packages/acp-bridge/src/session-control-plane.ts:1215`) still forwards the raw array to live viewers. So a live viewer receives the elements that recording and replay now drop. Both effects below need raw HTTP.

- **Editing that message silently does nothing.**
  - **Steps:**
    1. A viewer is watching a session live while a raw client posts `[null, …, valid]`.
    2. The bubble now renders, thanks to the new guard. On main it failed to render, so this path was unreachable.
    3. The viewer clicks Edit, then Send.
  - **Result:** no request is sent, no toast appears, and the edit box stays open.
  - **Cause:** `mapRestoredInputAnnotationsAfterTextChange` reads `annotation.start` on `null`. That throws a TypeError, which I reproduced in a unit probe. Then `.catch(() => false)` at `MessageItem.tsx:146` swallows it.
  - **Controls:**
    - The same flow with a valid-only message sends, and its one annotation is remapped.
    - The same message, edited after a refresh, also sends.
- **More than 256 elements:** the live view shows tags, but a refresh shows plain text.

Applying the same element filter and cap in `pickUserInputEchoMeta` would make the live view match what is persisted and replayed. That fits a follow-up.

### 4. Session title input (the bot's R1-5): real, but only on the retry path

I configured `fastModel` and captured the title side-query on both builds.

- **First attempt, one annotated prompt:** the input is identical on both builds (`User: TITLECASE summarize @README.md`).
- **When that attempt fails and a later turn retries:**
  - main sends turn 1, the assistant reply and turn 2;
  - the PR sends only turn 1.
- **Why:** recording `displayText` for the annotated turn switches `tryGenerateSessionTitle` into projection mode. The plain turn 2 has no projection, so it is dropped.

This is cosmetic, but the design doc's "session titles … retain their current inputs" doesn't hold on that path. The autofix round left it as a scope decision for a maintainer, with the options posted in its thread. Either option works for me; it doesn't need to block this PR.

### 5. Test gap (minor)

- **Surviving mutant:** changing `value.length > MAX_DAEMON_INPUT_ANNOTATIONS` to `>=` survives, because no test records exactly 256 elements.
- **Runtime:** the boundary is correct. 256 elements are persisted and 257 are dropped (§1).
- **Suggested test:** a 256-element case next to `ignores input annotations beyond the daemon cap` would pin it.

### 6. Ride-along test fix `d9b55cd629`

This commit is unrelated to tags, but it ships with this PR, so I measured it.

- **Setup:** copies of main's fixture and the PR's fixture, run under load (14 busy loops on 16 cores), 40 runs per arm.
- **"Forced tick":** a 1.2 s sleep before `beforeEach`'s `git add`, so the add and the commit land in different timestamp ticks.
- **"Guard removed":** `--no-optional-locks` removed from `isDirtyTree`.

| Fixture | Condition | Control passes | Guarded case passes (guard intact) | Guarded case fails (guard removed) |
| --- | --- | --- | --- | --- |
| main | as is, under load | 78/80 (2 natural flakes) | 40/40 | 40/40 |
| main | forced tick | **0/80** | 40/40 | **0/40 (vacuous)** |
| PR | as is, under load | 80/80 | 40/40 | 40/40 |
| PR | forced tick | 80/80 | 40/40 | 40/40 |

Both claims in the commit message hold:

- The control no longer depends on timing.
- Under a forced tick, the guarded case still catches a removed guard. With main's fixture, that mutant got through.

It's fine to ship this with the PR, or split it out, as the triage round's F2 notes.

### Merge checklist

- **CI at `8363acf1a8`:** 21 success, 21 skipped, 0 failing.
- **Merge:** merges cleanly into current main `5f713a2408`, 9 commits past the merge base. Main's only overlapping change is #12255 in `Session.ts`, in unrelated hunks.
- **Reviews:** chiga0's approval was dismissed by the new pushes. The only current approval is from the CI bot.
- **Recommendation:** merge. Ideally, include the one-line change from §2 first. §3–§5 can be follow-ups.

### Not covered

- macOS and Windows.
- Picker interaction beyond round 1's set.
- A write-side shape check. I only tested the render-side fix.

Figures, raw per-scenario JSON, mutant diffs and results, and the harness: this directory (`data/`, `harness/`).
