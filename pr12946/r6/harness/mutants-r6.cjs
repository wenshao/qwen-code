// Round-6 mutants: inverses of the 801dceab fixes.
const HS = 'packages/cli/src/serve/hosted-mcp-session.ts';
const RT = 'packages/cli/src/serve/managed-mcp-runtime.ts';
module.exports = [
  { id: 'Z1', what: 'R1-2: unconfirmed discovery blocks the Session again', file: HS, group: 'ts',
    find: "      if (response.state !== 'settled')\n        throw new Error('Runtime MCP discovery failed.');",
    replace: "      if (response.state !== 'settled')\n        throw new HostedMcpRecoveryRequiredError();" },
  { id: 'Z2', what: 'R1-2: explicit discovery error blocks the Session again', file: HS, group: 'ts',
    find: "        )\n      )\n        throw new Error('Runtime MCP discovery failed.');",
    replace: "        )\n      )\n        throw new HostedMcpRecoveryRequiredError();" },
  { id: 'Z3', what: 'R1-4: running-after-unknown commits the backward transition again', file: HS, group: 'ts',
    find: "        configuration.run.state !== 'settled' &&\n        !(\n          configuration.run.execution === 'outcome_unknown' &&\n          operation.state === 'running'\n        )\n",
    replace: "        configuration.run.state !== 'settled'\n" },
  { id: 'Z4', what: 'R1-5: unmatched string-id replies reach the SDK again', file: RT, group: 'ts',
    find: '            if (pending) this.receive(pending, message);\n            return;\n',
    replace: '            if (pending) {\n              this.receive(pending, message);\n              return;\n            }\n' },
  { id: 'Z5', what: 'R1-7: Windows root key back to SystemRoot', file: RT, group: 'ts',
    find: "? { SYSTEMROOT: process.env['SystemRoot'] }", replace: "? { SystemRoot: process.env['SystemRoot'] }" },
];
