# PR #10202 verification evidence

Terminal screenshots from a local end-to-end rig (real `qwen` bundle + real stdio MCP
servers + a local OpenAI-compatible provider), comparing the pre-PR bundle against the
PR bundle built from the same worktree.

| file | scenario |
| --- | --- |
| a-before-cross-server.png | pre-PR: `allow: ["mcp__foo.bar__*"]` auto-executes a tool from the *other* server `foo_bar` |
| b-after-cross-server.png  | PR: the same call now stops at the MCP confirmation dialog |
| c-after-intended.png      | PR: the intended server `foo.bar` is still granted by the same rule |
| d-before-alias.png        | pre-PR: an ambiguous legacy alias `mcp__srv__foo_bar` auto-executes tool `foo/bar` |
| e-after-alias.png         | PR: the ambiguous alias no longer grants; confirmation is required |

## Round 2 — head `75e91d6287` (after `main` was merged into the branch)

| file | scenario |
| --- | --- |
| i-after-cross-server-head75e91d.png | PR at the current head: the cross-server grant still stops at the confirmation dialog |
| f-before-star-allow.png | pre-PR: a bare `permissions.allow: ["*"]` rule is inert for MCP tools — confirmation is still required |
| g-after-star-allow.png  | PR: the same bare `"*"` rule now auto-approves every MCP tool, with no prompt |
| h-fix-star-allow.png    | PR + a one-line guard (`pattern.endsWith('*') && pattern.length > 1`): the prompt is back |
