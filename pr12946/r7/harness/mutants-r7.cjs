// Round-7 mutants: changes since 801dceab (606c10b0, 9957facb, merge d472033c).
const HS = 'packages/cli/src/serve/hosted-mcp-session.ts';
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const RT = 'packages/cli/src/serve/managed-mcp-runtime.ts';
const WRT = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/WorkspaceRuntimeTransport.java';
module.exports = [
  { id: 'W1', what: 'owner id back to colon form mcp:<sessionId>', file: HS, group: 'ts',
    find: '`mcp-${digest([session.authority.sessionHeader.sessionKey, previous])}`',
    replace: '`mcp:${session.authority.sessionHeader.sessionKey.sessionId}${previous ? `:${previous}` : ""}`' },
  { id: 'W3', what: 'NUL in a stdio command no longer rejected', file: RT, group: 'ts',
    find: "definition['command'].includes('\\0') ||", replace: 'false ||' },
  { id: 'W5', what: 'cancel route no longer serialized by mcpBusy', file: HH, group: 'ts',
    find: "    if (session.mcpBusy) return error(res, 409, 'hosted_mcp_operation_active');\n    session.mcpBusy = true;\n    void session.mcp\n      .cancel(",
    replace: "    session.mcpBusy = true;\n    void session.mcp\n      .cancel(" },
  { id: 'J9', what: 'busy-owner release always goes through physical release (pre-fix)', file: WRT, group: 'server',
    find: '&& !ownership.isHeld(context.binding(), context.session())) {', replace: '&& false) {' },
  { id: 'J10', what: 'any RELEASING session skips physical release, even the holder', file: WRT, group: 'server',
    find: '&& !ownership.isHeld(context.binding(), context.session())) {', replace: '&& true) {' },
];
