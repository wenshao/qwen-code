## Maintainer verification: mutation check in both arms plus a real TUI run (head `59053bf`)

**Verdict: ready to merge.** This is a test-only change of 8 lines, and the new row does real work. `main`'s core unit table lets two realistic refactors of `isToolHiddenBehindToolSearch` pass, and this row catches both of them. In the real TUI, one of those refactors brings back the #12425 symptom: under `tools.codeModeOnly` the model is told to use `tool_search`/`tool_call`, but neither tool is declared in that request. `main` already catches the same refactors through the CLI suite `workflow-keyword.test.ts`, so this PR doesn't close a gap in the repo as a whole. What it adds is locality: the failure now names the function itself. That matches what the PR description claims. Nothing blocks the merge.

### Setup

- One worktree at head `59053bf`. Its merge base is current `main` @ `99bf4ce`, so it's already up to date. I ran `pnpm install --frozen-lockfile`, a full `npm run build` and `npm run bundle`, and all exited 0.
- **Base arm.** The PR diff touches only `workflow-authoring-skill.test.ts`. For the base arm I put `main`'s copy of that file next to the PR's copy and ran both against the same (mutated) source. That gives the base test surface exactly, and nothing else varies.
- **Real TUI.** I ran the bundled `dist/cli.js` under node-pty in headless Chromium xterm.js, using the repo's `integration-tests/terminal-capture`, against the repo's scripted fake OpenAI server. `HOME` was isolated. The settings were `tools.workflowsEnabled: true` and `tools.eager: ["read_file"]` (this defers `workflow` and `skill`), plus `tools.codeModeOnly` where noted. The prompt was `please draft a workflow that lints each package`. The fake model **echoes back what it received**: whether the workflow keyword reminder was there, whether each bridge sentence was there, and which tools the request declared. The raw request bodies are saved under `data/`.

### PR claims re-checked

| Claim | Observed |
|---|---|
| `workflow-authoring-skill` + `bundled-reference` → 35 passed | 31 + 4 = **35 passed** ✅ |
| cli `workflow-keyword` → 29 passed | **29 passed** ✅ |
| guard commented out → `3 failed \| 28 passed` | M1 below: **3 failed / 31** ✅ (new row included) |
| eslint `--max-warnings 0`, `tsc --noEmit` | exit 0 / exit 0; `prettier --check` also clean ✅ |

The `/review` note says `src/skills/workflow-authoring-skill.test.ts — no such file or directory`. That comes from the working directory the bot ran in: the path is relative to `packages/core`. It isn't a problem with the PR.

### Mutation matrix, run in both arms (`packages/core/src/skills/bundled-reference.ts`)

| # | Mutation | core table, **base** | core table, **PR** | `bundled-reference.test` | cli `workflow-keyword.test` |
|---|---|---|---|---|---|
| M0 | control | 30 pass | 31 pass | 4 pass | 29 pass |
| M1 | delete the CodeModeOnly guard in the shared helper (the PR's own RED check) | FAIL 2 | FAIL 3 | pass | FAIL 1 |
| **M2** | move the guard from the shared helper to the Skill-route call site only | **pass** | **FAIL 1** | pass | FAIL 1 |
| **M3** | re-implement `isToolHiddenBehindToolSearch` without the helper, forgetting the guard | **pass** | **FAIL 1** | pass | FAIL 1 |
| M4 | keep the guard only in `isToolHiddenBehindToolSearch` (the Skill route loses it) | FAIL 2 | FAIL 2 | pass | pass |
| M5 | guard fires only after a ToolSearch reveal | FAIL 2 | FAIL 3 | pass | FAIL 1 |
| B1 | benign: guard moved after the `isPermissionDeferred` check | pass | pass | pass | pass |
| B2 | benign: guard duplicated into `isToolHiddenBehindToolSearch` | pass | pass | pass | pass |
| B3 | benign on the real `Config`: guard written as `config.getCodeModeOnly?.()` | FAIL 2 | FAIL 3 | pass | FAIL 1 |

The new row adds value only where base passes and the PR fails: **M2 and M3**. Both are refactors that split the helper's two callers, and in both `main`'s core table still passes because its `resolveWorkflowAuthoringSurface` CodeModeOnly row only exercises the Skill route. The cli suite catches M2 and M3 on `main` as well, which is the locality point above. No benign variant tripped the new row alone, so the row isn't brittle. B3 is covered in note 1.

![unit: M3 against base table vs PR table](04-unit-M3-base-table-passes-pr-table-fails.png)

### Real TUI: what the model receives

| Arm | Build | Tool mode | Workflow bridge sentence in the reminder | `tool_search` / `tool_call` declared |
|---|---|---|---|---|
| A | PR head | direct | **yes** | yes |
| B | PR head | `codeModeOnly` | **no** | no (`exec`, `agent`, … only) |
| C | PR head + **mutant M3** | `codeModeOnly` | **yes**: a dead end | **no** |
| B′ | PR head, source restored and rebuilt | `codeModeOnly` | no | no |

Arm C is the regression this row now catches at unit level. It passes `main`'s core table (30/30). In the real CLI it tells the model to call two tools the request doesn't declare. Arm B′ confirms the tree was restored before the report was written (`git status` clean).

**A: direct mode.** The bridge sentence is correct here, because `tool_search`/`tool_call` are declared.
![A direct](01-head-direct-mode-bridge-present.png)

**B: CodeModeOnly on the PR head.** No bridge sentence.
![B codemode](02-head-codemodeonly-no-bridge.png)

**C: CodeModeOnly with mutant M3.** The dead-end bridge sentence comes back.
![C mutant](03-mutant-M3-codemodeonly-dead-end-bridge.png)

### Notes (non-blocking)

1. **Stub fidelity (existed before this PR).** Both stubs, core `stubConfig` and cli `stubConfig`, model only `getToolMode()`. Suppose someone rewrites the guard as `config.getCodeModeOnly?.()` (B3). On the real `Config` that means the same thing, yet it fails the core table in both arms and the cli suite. The failure is a false positive: the stubs have no `getCodeModeOnly`, so the guard never fires. The new row inherits this, like every other CodeModeOnly row. If you want, deriving `getCodeModeOnly: () => toolMode === ToolMode.CodeModeOnly` in both stubs would remove it. That's optional.
2. **Outside this PR's scope, and the same on `main`.** In the TUI screenshots, the workflow keyword `<system-reminder>` shows up inside the user's own history item. `AppContainer.tsx` prepends the prefix to `submittedValue` (around line 3204), and the history item renders that string. It's unrelated to this change. I'm noting it because it's visible in every screenshot above.

