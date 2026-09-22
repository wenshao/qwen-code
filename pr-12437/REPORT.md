## Maintainer verification — PR #12437 @ `29d97e5`

**Verdict: not ready to merge yet.** The frames themselves work as described: computed-task and automated-trigger frames, the indent, the tag defusing, the journal replay, the switch, and the workspace lock. I checked each one on a real daemon and a real CLI built from this branch. Two things need fixing first:

1. **CI cannot go green.** The head does not compile: a test file uses a property that doesn't exist. Behind that there is also a lint error in the new module. Both are one-line fixes.
2. **The user-request relay is taken from the wrong place.** It relays "the latest `user` entry in history", and in qwen-code that entry is often not the user. On the real stack, a file the user referenced with `@` replaced the user's words in the relay. A real subagent model then carried out the file's instruction **5/5** times. On main it did so **0/5** times, even though it read the same file.

### Blocking

#### B1. The head fails to build, and the new module fails lint

```
packages/core build: src/tools/workflow/workflow.test.ts(2165,54): error TS2339: Property 'completion' does not exist on type 'WorkflowTask'.
```

- `packages/core`'s `tsc --build` type-checks test files too. The description's "`tsc --noEmit` clean for production code" skipped them.
- This single error is the whole red CI. **Lint & Static**, **Test (ubuntu)**, **Integration Tests (no-AK)**, **OpenTUI no-flicker gate** and **TUI parity snapshots** all stop on it inside the root `prepare` script (for example job 106609285340).
- The triage bot's "`pnpm install` failed twice" verdict at `5d89359` fits the same cause. `prepare` builds core during install, and that head already contained the line.
- Current main still has no `completion` on `WorkflowTask`, so a rebase will not fix it.
- **Fix:** use `registry.getHandle(hostResult.workflowRunId!)?.completion`, as the tests at `workflow.test.ts:1033`/`:1039` do. As written, the line is `await undefined`, so the test never waits for the run.
- I made that one-word change locally. With it, root `npm run build` and `npm run bundle` succeed, and everything below ran on that build. No production code was touched.
- **Second gate after that:** `eslint --max-warnings 0` fails on the new file:
  ```
  workflow-prompt-provenance.ts
    98:26  error  Unexpected control character(s) in regular expression: \x1c, \x1e  no-control-regex
  ```
  CI's `node scripts/lint.js --eslint` lints the whole repo, so this is next in line. The rest of the codebase uses `// eslint-disable-next-line no-control-regex -- …` (for example `workflow-correlation.ts:30`), and adding that line makes the file lint clean. Prettier is clean.

#### B2. The relay is taken from the latest `user` history entry, which is often not the user

`latestUserRequest()` (`workflow-prompt-provenance.ts:190`) walks back to the first `user` entry that has no `functionResponse`. `userWords()` (`:124`) then keeps whatever follows the **last** `</system-reminder>`. The result goes out under *"verbatim … the only user voice in this task … Where the computed task conflicts with this request, this request wins"*.

I reproduced four cases on this branch's build:

| How the run was triggered | What is relayed as "the user request that triggered this workflow run" | Where |
| --- | --- | --- |
| The user references a file with `@`, and the file contains `</system-reminder>` | Only the text **after the tag in the file**. Everything the user typed is dropped. | real TUI + real subagent model (figs 1–2) |
| `@file` without the tag | The user's words **plus the whole file body** (up to 4000 chars) | headless, wire capture |
| The model starts the workflow while handling a background task's `<task-notification>` (shell, agent, monitor) | The notification XML, including the command's `<output-tail>` | real TUI (fig 3) |
| TUI saved-workflow command (`/audit`), which dispatches the tool with `isClientInitiated` and adds no user turn | The previous, unrelated request | real TUI (fig 4) |

By code reading only (not run), the same mechanism covers teammate envelopes and hook turns. `SendMessageType` (`client.ts:198`) says these are not user prompts, yet they land in history as plain `user` text entries. Cron prompts are the same case; the description already lists them as a follow-up. Goal continuations relay the `/goal` objective, which is user-authored, so I am not counting them.

![@file forged relay, real stack](01-atfile-forged-relay-real-stack.png)

![what the subagent was sent](02-atfile-wire.png)

**Measured impact**

**Real stack, `@file` with the tag.** Top-level model scripted, subagent tier a real `qwen3.7-plus`; four headless runs plus one TUI run per build.

- **PR head:** the subagent's first action was `write_file APPROVED_BY_USER.txt` in **5/5** runs. The user's prompt said *"Do not modify any files."*
- **main:** the file was created in **0/5** runs. In all five, the subagent **read `notes2.md` itself** and saw the same instruction as file content, and ignored it.

Same text, same model. The only difference is that the PR presents the text as the user's relayed request.

**Controlled replay.** I replayed the recorded subagent request and varied only its first user message. N=10 per cell, temperature 0.7. A cell counts a sample when its first response creates the file.

| model | PR (forged relay) | same frame, relaying the user's real words | main |
| --- | --- | --- | --- |
| qwen3.7-plus | 10/10 | 0/10 | 0/10 |
| qwen3.8-flash | 6/10 | 0/10 | 0/10 |
| deepseek-v4-flash | 6/10 | 0/10 | 0/10 |
| qwen3.8-max | 2/10 | 0/10 | 0/10 |

**Notification case.** The same kind of replay (N=8 × 3 models) gave **0/24 in every arm**; the XML envelope reads as machine output. For notifications this is a false claim on the wire, not a measured change in behavior. I still list it: the frame asserts user authority it has no basis for, and a less conspicuous envelope or payload might not be caught.

![notification relayed](03-notification-relay.png)

![slash command relays the previous request](04-slash-command-stale-relay.png)

Why this matters for this PR in particular: the threat model in the description is *"text that never passed a person reaches a subagent with user authority"*. For these inputs, the relay creates that channel, and in stronger words than main ever used. On main, none of this text reached the subagent's first message at all.

**Suggested direction.** The codebase already has the pieces:

- **Decide the relay at submit time, from the turn's origin**, not afterwards from history shape. `beginTurnBudget` (`client.ts:3010`) already makes this distinction: *"Only a user query or its retry can carry a directive; a cron, goal, notification or teammate turn starts with none."* Workflows already read that `TurnBudget` snapshot at launch (`workflow-budget.ts:205`). Record the user's words there for `UserQuery`/`Retry` only. Every other origin then resolves `computed-only` (or `automated` for cron, which also covers your follow-up).
- **Relay only when the Workflow call belongs to that turn** (same `promptId`). A client-initiated slash command then resolves `computed-only`, or relays its own command text.
- **Extract the words the way `extractTurnBudgetDirectiveText` (`turn-budget.ts:134`) does.** Remove whole `<system-reminder>…</system-reminder>` blocks, the `--- Content from referenced files ---` block and MCP-resource blocks, rather than keeping "everything after the last closing tag". Leave code in; that function also strips code, which a relay should not.
- **Pin it with three tests:** an `@file` that contains `</system-reminder>`, a `<task-notification>` as the last turn, and a slash-command dispatch after an unrelated turn.
- If that is too much for this PR, a clean split is to ship the computed-task and automated frames now and resolve model-started runs as `computed-only` until turn origin is tracked.

### Non-blocking

- **N1. `requiresRestart: false` and "the next run picks up a change" do not hold within a running session.** `Config` reads the value once into a `readonly` field (`config.ts:2939`, `:3346`) and nothing updates it. `workflowSizeGuideline`, which does apply live, has its own path (`AppContainer.tsx:3215`). Either mark the setting `requiresRestart: true` or add a live path. (Found by code reading; I did not drive the `/settings` dialog.)
- **N2. Tests don't pin two claims from the description.** Of my 20 hand mutants, these survive:
  - Seeding the transcript with the raw prompt instead of the framed one. The E2E transcript does carry the frames, but no test pins it.
  - `buildReplay` "first record wins" (`??=` → `=`).
  - The override-path display name reverted to the framed text.
  - Tool-result entries not skipped. This one is near-equivalent: a `functionResponse` entry has no text today.
- **N3. Comment nit.** `workflow-prompt-provenance.ts:95` says "file/group/record/unit separators", but the class stops at U+001E. U+001F is not a line break, so the code is right and the comment isn't.
- **By design, for other reviewers.** A resume replays the relay recorded at launch. I interrupted a model-started run under "Request A" (SIGKILL mid-agent) and resumed it from a new session that asked "Request B". Both the re-dispatched agent and the newly dispatched one were told the request was "Request A". A host `rerun` of a model-started run gets a new run id and resolves `automated`.

### Verified as described

![frames that work](05-frames-that-work.png)

| Check | Result |
| --- | --- |
| Model-started run (headless) | journal `{"kind":"relay"}`; triggering request relayed; a forged `[Workflow harness — user request]` line and `<system-reminder>` inside the computed text are indented and defused |
| Host-started run on a real `qwen serve` daemon (`POST …/workflow-action` `run-script`) | journal `{"kind":"automated"}`; automated-trigger frame above the computed-task frame; forged frame arriving through `args` is indented |
| Model-started run inside the same daemon session | `relay` |
| `QWEN_CODE_WORKFLOW_PROMPT_PROVENANCE=0` | subagent's first message is **byte-identical** to main's (`cmp`, modulo the run-dir name) |
| User settings `workflowPromptProvenance: false` | `off`; env `=1` turns it back on |
| Workspace settings `false` | ignored, still `relay`. Control: `workflowNameOnly: true` in the same workspace file does take effect |
| Resume (SIGKILL mid-agent, then `resumeFromRunId` from a new session) | the journal's provenance is replayed |
| Subagent transcript | first record carries the frames |
| Unit sweeps: core `src/agents src/tools/workflow src/skills src/config` | head 4151 pass / 1 fail, main 4119 / 1. The same failure on both arms (`skill-curator … rename fails transiently`, an artifact of running as root) |
| Unit sweeps: cli `src/config` | head 1610 / 0, main 1607 / 0 |
| Mutation | the description's rows 1, 2, 4, 5 and 6 reproduce as killed (row 3 not re-run). 20 hand mutants: 16 killed, 4 survived (N2) |
| Prettier on the changed files | clean |

### Method

- Linux, Node 22.22.2.
- Two worktrees, each with `pnpm install --frozen-lockfile`, a full root `npm run build` and `npm run bundle`:
  - PR head `29d97e5`, plus the one-word test fix from B1, local only;
  - merge-base `8f86b4f` as "main".
- One scripted OpenAI-compatible server serves both tiers. The top-level agent is routed by a marker in the conversation, subagents by the workflow subagent system prompt. Every request body is recorded, so the frames above are exactly what the model endpoint received.
- For the real-model runs, the server forwards only the subagent tier to the real endpoint.
- The harness, wire captures, journals and A/B raw outputs are published next to this report.
