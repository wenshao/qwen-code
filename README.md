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
