## Local runtime verification — PR #12404 @ `f6d25c84ec`

**Verdict: recommend merge.**

- Every claim in the PR body reproduces on a real daemon and the real Web Shell, with a clean A/B against the merge base.
- Model input is byte-identical between the two builds.
- One small hardening is worth folding in before merge: a one-line null guard. I tested the fix (§6a). It is not a blocker.
- On the triage bot's three open questions:
  - (a) A `[null]` element: **confirmed**. The PR turns a live-only render failure into a durable one.
  - (b) Oversized arrays: history **stays readable**.
  - (c) Offset misalignment with attachments: **can't happen from the Web Shell**.

### How this was tested

- **Two builds from one worktree:**
  - **PR** = `f6d25c84ec`.
  - **base** = the PR's 5 production files restored from merge base `065dd351c8` (`git show 065dd351c8:<file>`), then a full `npm run build && npm run bundle`.
  - Rebuilding head afterwards gave byte-identical changed chunks and Web Shell assets. So the two builds differ only in those 5 files.
- **Runtime:** real `qwen serve` → ACP child → JSONL on disk, with the daemon's own Web Shell in Chromium (Playwright). A mock OpenAI-compatible provider records every request body.
- **Tags come from the real `@` picker** (Files / Extensions / MCP resources), not from hand-built metadata:
  - a linked probe extension, `browser-kit`;
  - a stdio MCP server, `o2-docs`, with 0 resources, which gives `@mcp:o2-docs`.
- Each build has its own runtime dir. Every "restart" is a real daemon process restart.
- **Environment:** Linux x64, Node 22.22.2.

### 1. Core claim: tags survive a refresh and a daemon restart

![tags A/B](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/01-tags-ab-light.png)

| | Base | PR |
| --- | --- | --- |
| Live, just sent | 4 tags. Extension and MCP tags are 22 px tall, 0 px right padding, 4 px radius, monospace, `--secondary` background | 4 tags. All are 28 px / 8 px / 8 px, sans, `--background`, the same as file tags |
| Browser refresh (idle session) | **0 tags**, raw `@…` text | 4 |
| Daemon restart + reopen | 0 | 4 |
| JSONL user record | no `systemPayload` | `systemPayload.inputAnnotations` holds the 4 annotations exactly as sent |

- On base, tags are already lost after a plain refresh of an idle session, as the PR body says.
- The long label is truncated (`src/very-long-module-name-for-tag-tr…`).
- After the restart, clicking the restored `README.md` tag sent `GET /file?path=README.md&maxBytes=262144` and got 200. The preview shows the fixture content. Base has no clickable tag at that point.

![file preview](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/02-file-preview-after-restart.png)

Dark theme: [01-tags-ab-dark.png](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/01-tags-ab-dark.png)

### 2. Model input is unchanged

- I compared the main-turn request on both builds, after normalizing runtime paths, timestamps and UUIDs.
- `messages` is identical: 39,781 bytes on each.
- The string `inputAnnotations` appears in neither request.

### 3. Offset alignment

Every case below came from the real composer. Each was checked live, after a refresh and after a daemon restart. All pass on the PR:

- **Tags + attached text file.** The client appends `\n\n@attachment:///notes.txt`, and replay strips it as a suffix.
- **Tags + image.**
- **Leading spaces.**
- **Multi-line** (Shift+Enter), with the tag on line 2.
- **CJK and emoji before the tags** (UTF-16 offsets).
- **The same file tagged twice.**

Why the triage bot's misalignment can't happen from the Web Shell:
- The client only ever appends the attachment token.
- `stripGeneratedAttachmentTokens` only strips a suffix.
- So offsets computed on the composer text stay valid.

### 4. Compatibility

- **Old history on the PR daemon:** a base-written session renders as plain text, with no errors. Nothing is inferred from the text.
- **Rollback:** a PR-written session on the base daemon renders as plain text, with no errors. The extra field is simply ignored.

### 5. Other consumers that now work

![edit after restart](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/03-edit-after-restart.png)

- **Editing a restored message.** After a restart I edited "Review" to "Recheck".
  - PR: all 4 annotations are remapped (+1 offset), and the tags survive a reload.
  - Base: the edited prompt goes out with 0 annotations.
- **Server-queued prompts.**
  - The queue panel reuses `ReadonlyComposerTag`, so it gets the unified style too.
  - After the queued prompt runs, its tags survive a reload: PR 3 → 3, base 3 → 0.

![queued chips](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/05-queued-chips.png)

### 6. Hardening (non-blocking)

**(a) A `[null]` element becomes a durable render failure.**

I sent a raw `POST /session/:id/prompt` with `_meta.inputAnnotations: [null, valid]`. This needs the daemon token; the Web Shell never sends this.

- **Live view:** both builds show "This message could not be displayed." The error is `TypeError: Cannot read properties of null (reading 'type')` in `splitComposerTagContentByAnnotations`. This live path already fails on base.
- **After a reload:**
  - Base recovers and shows plain text.
  - PR fails the same way on every load, because `[null]` is now on disk.
- The per-message error boundary contains it. The rest of the session renders.

![null annotation](https://raw.githubusercontent.com/wenshao/qwen-code/asserts/pr-12404/04-null-annotation-durable.png)

**Suggested fix, tested:** in `packages/web-shell/client/utils/composerTag.ts:209`, add a null check to the existing `annotation.type` guard.

```ts
if (!annotation || annotation.type !== 'reference') continue;
```

- With only this line changed, both persisted sessions render, and the valid `README.md` tag is kept.
- It also fixes the live path.
- A case next to the existing `composerTag` tests would pin it.

**(b) Oversized arrays.** The write path has no count or size cap. The sibling field `attachmentReferences` is capped at 256.

- **4,501 annotations (5 MB):** persisted, `/load` returns 200, and the message renders normally.
- **9,301 annotations (10.3 MB, right at the request-body limit):** accepted and persisted. After a restart, the first view shows only the assistant reply:
  - `/load` puts the huge record past the first page.
  - The next backward `/transcript` page has 0 events and `hasMore: true`.
  - Scrolling up follows the cursor, and the message appears.
- So history stays readable. The triage bot's worry that history would fail to load does not happen. On base, the same request doesn't persist the annotations at all.
- A count cap at the write site, for example 256, would remove this. Nice to have.

### 7. Tests

- **Unit tests at head:**
  - acp-bridge: 116/116
  - core: 144/144
  - cli `Session.test.ts`: 1,041/1,041
  - web-shell (UserMessage, QueuedPromptDisplay, transcriptToMessages, composerTag): 328/328
- **Mutation testing: 6 of 6 mutants killed.**
  - dropping the `|| inputAnnotations` gate on the ordinary path;
  - the same on the deferred `/advisor` path;
  - dropping the `inputAnnotations` field;
  - removing `structuredClone`;
  - dropping the replay forward;
  - forwarding non-arrays.
- No test covers the CSS change. The E2E measurements above do.

### Merge checklist

- **CI at `f6d25c84ec`:** 24 pass, 32 skipped, 0 failing. Test (ubuntu), Lint & Static, Integration no-AK, Real daemon E2E and the web-shell visuals capture are all green.
- **Merge:** merges cleanly into current main (`97b1b252e3`, 11 commits past the merge base). The only overlap is #12311 in `Session.ts`, in a different hunk.
- **Reviews:** one approval (chiga0).
- **Recommendation:** merge. Ideally, fold in the one-line guard from §6a first.

### Not covered

- macOS and Windows.
- Actually running an external MCP server or extension. The probes only need to be listed and referenced.
- Embedded hosts that pass `parseUserMessageContent` or `onComposerTagClick`.
- Two notes that don't block:
  - Non-file clickable tags now hover with the neutral border instead of the accent colour. Focus-visible keeps the accent. This only happens in hosts that pass `onComposerTagClick`, and it looks intentional.
  - Composer chips, before sending, still render extension and MCP tags in monospace. That is outside this PR.

### Unrelated observation

While driving the composer, I hit a crash that also happens on base, so the PR doesn't cause it:
- Steps: on the third message of a session, pick a tag, type text, then do another `@` pick and send.
- Result: `Calls to EditorView.update are not allowed while an update is in progress`, and the whole Web Shell shows "Something went wrong".
- I reproduced it with Playwright keyboard input. It may deserve its own issue.

Figures, raw per-scenario JSON, the numeric summary and the harness: https://github.com/wenshao/qwen-code/tree/asserts/pr-12404
