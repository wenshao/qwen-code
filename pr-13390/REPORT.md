## Maintainer verification: real CLI, code mode, live always-loaded MCP server (head `9c75b71`)

**Verdict: ready to merge.** I reproduced the bug in the real app on `main` (merge-base `fde56a8`) and confirmed that this PR fixes it on all three surfaces that render `/context detail`: the interactive TUI, the SDK/stream-json `get_context_usage` control request, and the headless text renderer. Sessions where the clamp is not in force produce byte-identical output. The two test-coverage gaps raised in the earlier bot reviews are real, and I confirmed both by mutation. Neither blocks the merge. A ready-to-paste test that closes both is at the end.

### Setup

- Two worktrees built from source with `npm run build && npm run bundle` (both exit 0): **base** = `fde56a8` (merge-base), **PR** = `9c75b71`. I checked the bundles before running anything. Base has `detailMcpTools=mcpTools` and `scaleDetail(mcpTools)`, and the PR has `scaleTokens(mcpTools,scale*mcpDetailShare)`.
- The scenario the PR targets is `tools.codeModeOnly: true` plus a **real stdio MCP server** (`@modelcontextprotocol/sdk`) with `alwaysLoadTools: true`. It exposes 4 tools whose input schemas carry long per-property descriptions, like real tracker/GitHub-style servers. Code mode renders a binding as a TypeScript signature and drops those property descriptions, while `/context` measures each tool's full JSON schema. A large server therefore puts the clamp in force.
- The model is a local OpenAI-compatible fake whose final usage chunk reports a chosen `prompt_tokens`. That lets me drive both provider-count paths: `scale = 1` (40,000) and `scale < 1` (12,000 and 5,000).
- The clamp needs a large enough server. With this server at 1× (3.1k MCP tokens) the clamp never engages. At 4× (11.7k) it engages over stream-json. The interactive TUI declares more tools, so I used 6× (17.5k) there.

### Result: interactive TUI (real Ink render, xterm.js capture)

Before the first reply (estimate path):

![before first reply](./tui-before-first-reply.png)

After the first reply (provider total 12,000, below the measured overhead, so `scale < 1`):

![after first reply](./tui-after-first-reply.png)

The panels are crops of the real screenshots, with captions added. I cut out only the built-in rows in the middle, and those are identical in both arms. Full uncropped screenshots: [base before](./full-base-1-before-first-reply.png) · [PR before](./full-head-1-before-first-reply.png) · [base after](./full-base-2-after-first-reply.png) · [PR after](./full-head-2-after-first-reply.png).

### Result: exact numbers (`get_context_usage {show_details:true}` over stream-json, MCP server 4×)

| Path | provider total | MCP tools row | Σ MCP detail rows, base | Σ MCP detail rows, PR |
| --- | ---: | ---: | ---: | ---: |
| estimate (before first reply) | — | 9,943 | 11,667 (**+1,724**) | 9,942 (−1) |
| provider, `scale = 1` | 40,000 | 9,943 | 11,667 (**+1,724**) | 9,942 (−1) |
| provider, `scale < 1` | 12,000 | 6,357 | 7,460 (**+1,103**) | 6,357 (0) |
| provider, `scale < 1` | 5,000 | 2,649 | 3,108 (**+459**) | 2,649 (0) |

The PR distributes the clamped row proportionally rather than just matching the total. On the estimate path every row is `round(raw × 9,943 / 11,667)`: `search_issues` 7,929 → 6,757, `create_issue` 2,854 → 2,432, `list_comments` 844 → 719, `get_status` 40 → 34. Replaying the PR's arithmetic with the real schema sizes reproduces every per-tool row the CLI printed in all three runs I checked.

**Rounding drift.** I swept every provider total from 1 to 18,768 (the whole range below the overhead) through the same arithmetic with this 4-tool server. Σrows − row was −1 for 4.2% of totals, 0 for 45.8%, +1 for 46.0% and +2 for 4.1%. That matches the "a token or two" disclosed under Risk & Scope, and values ≥ 1k render as `x.yk` anyway.

**Controls: no behaviour change outside the clamp.** In each of the following scenarios the full `get_context_usage` payload was **byte-identical** between base and PR, both before and after the reply:
- code mode with an always-loaded server too small to trigger the clamp
- code mode with MCP tools deferred
- direct mode with an always-loaded server

The headless text renderer shows the same fix. `qwen -p "/context -d"` lists the MCP rows as 7.9k/2.9k/844/40 under a 9.5k MCP row on base, and as 6.5k/2.3k/689/33 under the same 9.5k on the PR.

### Tests and static checks

- `contextCommand.test.ts` passes 59/59 on the PR. To confirm the new assertion catches the bug, I ran the PR's test file against base source. Exactly the extended test fails, with `expected 128 to be 17` at `contextCommand.test.ts:1115`, which reproduces the author's "before" claim.
- All 8 CLI test files that touch `/context` passed, 2,771/2,771: `contextCommand`, `ContextUsage`, `context-usage-labels`, `item-projection`, `ControlDispatcher`, `acpAgent`, `serve/server`, `acp-http/transport`.
- `eslint --max-warnings 0` and `prettier --check` are clean on both changed files.

### Test coverage gaps, confirmed by mutation (non-blocking)

I placed mutant copies of `contextCommand.ts` next to the original (untracked, deleted afterwards) and ran the PR's test file against each:

| Mutant | PR's tests | + per-row probe case |
| --- | --- | --- |
| first MCP row takes the whole clamped amount, rest 0 (sum-preserving) | **survives** (59/59) | killed |
| `Math.round` → `Math.ceil` in `scaleTokens` | **survives** | killed |
| provider path drops `scale` (`scale * mcpDetailShare` → `mcpDetailShare`) | **survives** | killed |
| provider path back to base (`scale` only) | killed | killed |
| estimate path back to base (raw rows) | killed | killed |

This confirms by execution the [R1-1 inline comment](https://github.com/QwenLM/qwen-code/pull/13390#discussion_r4177748406) (the distribution across rows is not pinned) and point 2 of the [stage-2 review](https://github.com/QwenLM/qwen-code/pull/13390#issuecomment-5979325445) (the provider case runs at `scale = 1`). The third mutant is the one I'd most like covered. In the 12,000 run above it would list about 9,942 tokens of MCP rows under a 6,357 row, which is the same bug on the provider path, and the current tests stay green.

<details>
<summary>Suggested test: two MCP tools, per-row assertions, both paths, <code>scale &lt; 1</code> (kills all five mutants; passes on the PR as-is)</summary>

Paste inside `describe('category identity (#12033)')`:

```ts
it('splits the clamped mcp row across several tools on both paths', async () => {
  const mcp = (tool: string, pad: number) =>
    Object.defineProperties(Object.create(DiscoveredMCPTool.prototype), {
      name: { value: `mcp__server__${tool}` },
      serverName: { value: 'server' },
      serverToolName: { value: tool },
      schema: {
        value: {
          name: `mcp__server__${tool}`,
          description: `MCP ${tool} ${'x'.repeat(pad)}`,
          parameters: { type: 'OBJECT', properties: {} },
        },
      },
    }) as DiscoveredMCPTool;
  const big = mcp('big', 400);
  const small = mcp('small', 130);
  const controlSchema = {
    name: 'tool_call',
    parameters: { type: 'OBJECT', properties: {} },
  };
  const tools = [
    { ...skillToolDouble, getLoadedSkillContentNames: () => new Map() },
    big,
    small,
    { name: controlSchema.name, schema: controlSchema },
  ];
  const declared = [skillToolSchema, controlSchema];
  const history = [prelude, ...conversation];
  const raw = [big, small].map((t) =>
    estimateContextTextTokens(JSON.stringify(t.schema)),
  );

  // Estimate path: each row is its own schema times the kept share.
  const est = await collectContextData(
    makeChatConfig({ total: 0, tools, declared, history }),
    true,
  );
  const share = est.breakdown.mcpTools / (raw[0]! + raw[1]!);
  expect(share).toBeGreaterThan(0);
  expect(share).toBeLessThan(1);
  expect(est.mcpTools.map((t) => t.tokens)).toEqual(
    raw.map((r) => Math.round(r * share)),
  );

  // Provider path with the total below the overhead, so scale < 1 too.
  const rawOverhead = sumRows(est.breakdown) - est.breakdown.messages;
  const total = Math.floor(rawOverhead / 2);
  const prov = await collectContextData(
    makeChatConfig({ total, tools, declared, history }),
    true,
  );
  const factor = (total / rawOverhead) * share;
  expect(prov.mcpTools.map((t) => t.tokens)).toEqual(
    raw.map((r) => Math.round(r * factor)),
  );
});
```

</details>

### Pre-existing, not changed by this PR (possible follow-ups under #12235)

1. **Built-in rows under a 0 Built-in category.** In the same clamp scenario, the Built-in tools row is `0` while its detail section still lists 17 tools over stream-json, totalling 9,514 tokens, and 22 in the TUI. This confirms point 1 of the stage-2 review in the real app. It is identical on base and on the PR.
2. **`search_memory` / `manage_memory` listed but never sent.** In direct mode the request the model received carried neither tool, because `getFunctionDeclarations` withholds them under the legacy recall protocol. `/context detail` still lists them as built-in rows (630 + 138 tokens), and that accounts for 768 of the 769-token gap between the Built-in row (8,688) and its rows (9,457). The per-tool loop in `collectContextData` lacks the `isMemoryRecallToolDeclared` filter.
3. **Headless `/context detail` prints nothing.** `qwen -p "/context detail"` prints only `Command executed successfully.` on both base and PR, because the `detail` subcommand calls `contextCommand.action!(context, 'detail')` without returning its message. `/context -d` works, and the interactive TUI is unaffected.

### Not covered

- macOS and Windows were not run. The change is pure arithmetic with no platform code.
- The ACP/serve context-usage status (`buildSessionContextUsageStatus` in `acpAgent.ts`) was not driven separately. It serializes the same `collectContextData` result.
- I did not build a merged-with-main arm. `main` is 29 commits ahead, none of them touch these files, and `git merge-tree` is clean. PR CI on `9c75b71` is green.

Evidence: this directory (`harness/`, `data/`).
