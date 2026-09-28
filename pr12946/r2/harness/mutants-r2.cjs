module.exports=[
 {
  "id": "M7",
  "what": "method-not-found no longer means an empty complete list",
  "file": "packages/cli/src/serve/managed-mcp-runtime.ts",
  "group": "ts",
  "find": "objectOrUndefined(error)?.['code'] === -32601",
  "replace": "objectOrUndefined(error)?.['code'] === -32602"
 },
 {
  "id": "M11",
  "what": "prompt admitted while an MCP operation is pending",
  "file": "packages/cli/src/serve/hosted-harness-session.ts",
  "group": "ts",
  "find": "    if (session.blocked || session.mcp?.hasPendingOperations())\n",
  "replace": "    if (session.blocked)\n"
 },
 {
  "id": "M13",
  "what": "Harness accepts configurations owned by two Runtime Sessions",
  "file": "packages/cli/src/serve/hosted-mcp-session.ts",
  "group": "ts",
  "find": "    if (owners.size > 1) throw new HostedMcpRecoveryRequiredError();\n",
  "replace": ""
 },
 {
  "id": "R1",
  "what": "Shell profile advertises file tools only",
  "file": "packages/cli/src/serve/hosted-workspace-tool-turn.ts",
  "group": "ts",
  "find": "      ...(this.shell\n        ? HOSTED_WORKSPACE_SHELL_TOOLS\n        : HOSTED_WORKSPACE_FILE_TOOLS),",
  "replace": "      ...HOSTED_WORKSPACE_FILE_TOOLS,"
 },
 {
  "id": "R2",
  "what": "reservation turnId falls back to runtimeSessionId (drop promptId)",
  "file": "packages/cli/src/serve/hosted-workspace-tool-turn.ts",
  "group": "ts",
  "find": "          request.inputDigest,\n          this.promptId,\n        );",
  "replace": "          request.inputDigest,\n        );"
 },
 {
  "id": "R3",
  "what": "Shell input digest not sent with prepare",
  "file": "packages/cli/src/serve/hosted-workspace-tool-turn.ts",
  "group": "ts",
  "find": "          request.digest,\n          request.inputDigest,\n          this.promptId,",
  "replace": "          request.digest,\n          undefined,\n          this.promptId,"
 }
]