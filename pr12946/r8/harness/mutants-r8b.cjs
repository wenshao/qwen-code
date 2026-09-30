// Round-8b mutants: 67c908ea "Honor cancellation during initial MCP setup".
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const MS = 'packages/cli/src/serve/hosted-mcp-session.ts';
module.exports = [
  { id: 'P1', what: 'first prompt waits for initialization without the abort signal', file: HH, group: 'ts',
    find: '        await session.mcp?.ensureReady(abort.signal);\n', replace: '        await session.mcp?.ensureReady();\n' },
  { id: 'P2', what: 'no abort check between initialization and input admission', file: HH, group: 'ts',
    find: '        await session.mcp?.ensureReady(abort.signal);\n        abort.signal.throwIfAborted();\n',
    replace: '        await session.mcp?.ensureReady(abort.signal);\n' },
  { id: 'P3', what: 'initialize keeps configuring later servers after abort', file: MS, group: 'ts',
    find: '      for (const pin of this.servers) {\n        signal?.throwIfAborted();\n', replace: '      for (const pin of this.servers) {\n' },
  { id: 'P4', what: 'close no longer refuses while initialization runs', file: MS, group: 'ts',
    find: '    if (this.initializing) throw new HostedMcpRecoveryRequiredError();\n', replace: '' },
  { id: 'P5', what: 'dispatch waits for the Broker reply without honoring abort', file: MS, group: 'ts',
    find: '      response = await waitForTurn(this.broker.control(operation), signal);', replace: '      response = await this.broker.control(operation);' },
  { id: 'P6', what: 'install skips the abort check after acquiring ownership', file: MS, group: 'ts',
    find: '      await this.acquireOwner();\n      signal?.throwIfAborted();\n      const runtime', replace: '      await this.acquireOwner();\n      const runtime' },
];
