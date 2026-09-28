// Round-3 mutants: survivors from earlier rounds plus one inverse per fix.
const base = require('./mutants.cjs');
const RT = 'packages/cli/src/serve/managed-mcp-runtime.ts';
const HS = 'packages/cli/src/serve/hosted-mcp-session.ts';
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const TT = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
module.exports = [
  ...base.filter((m) => ['M7', 'M11'].includes(m.id)),
  { id: 'X1', what: 'cancel marks the running call unknown again (pre-fix F3)', file: RT, group: 'ts',
    find: '      // SDK servers suppress replies after native cancellation. Keep observing\n',
    replace: "      if (control.kind === 'mcp-cancel' && existing.connection?.pending.has(existing.control.operationId)) this.unknown(existing, 'managed_mcp_cancel_requested');\n      // SDK servers suppress replies after native cancellation. Keep observing\n" },
  { id: 'X2', what: 'idle retired siblings stay open on reconfigure (F6)', file: RT, group: 'ts',
    find: '          if (sibling.pending.size === 0) await this.closeConnection(sibling);\n', replace: '' },
  { id: 'X3', what: 'busy retired connection not closed after its last settle (F6)', file: RT, group: 'ts',
    find: '      if (operation.connection.retiring && !operation.connection.closed)\n        void this.closeConnection(operation.connection).catch(() => undefined);\n', replace: '' },
  { id: 'X4', what: 'terminateSession failure fails the release again (F5)', file: RT, group: 'ts',
    find: 'connection.transport.terminateSession().catch(() => undefined),', replace: 'connection.transport.terminateSession(),' },
  { id: 'X5', what: 'default MCP request timeout back to 25 s (F4)', file: RT, group: 'ts',
    find: 'const REQUEST_TIMEOUT_MS = 600_000;', replace: 'const REQUEST_TIMEOUT_MS = 25_000;' },
  { id: 'X6', what: 'Hosted stops waiting through unknown for MCP tools (F4)', file: TT, group: 'ts',
    find: '          this.mcp !== undefined,\n', replace: '          false,\n' },
  { id: 'X7', what: 'no discovery before each model request (F2)', file: TT, group: 'ts',
    find: '    if (this.mcp) await this.mcp.refresh();\n', replace: '    if (this.mcp) await this.mcp.ensureReady();\n' },
  { id: 'X8', what: 'close no longer cancels unsent configuration intents (F7)', file: HS, group: 'ts',
    find: "      if (configuration.run.execution !== 'intent') continue;\n", replace: '      continue;\n' },
  { id: 'X9', what: 'identity conflicts back to 503', file: HH, group: 'ts',
    find: '            cause instanceof HostedMcpConflictError ? 409 : 503,', replace: '            503,' },
  { id: 'X10', what: 'refresh reconfigures even when the catalog is unchanged', file: HS, group: 'ts',
    find: '      if (response.catalog && digest(response.catalog) === digest(catalog))\n        continue;\n', replace: '' },
  { id: 'X11', what: 'restored writer does not renew configuration grants (A1)', file: HS, group: 'ts',
    find: '    if (!this.grantsRenewed) {', replace: '    if (false) {' },
];
