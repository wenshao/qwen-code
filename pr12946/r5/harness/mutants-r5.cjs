// Round-5 mutants: the admission cap and quota error mapping (2159a735).
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const HS = 'packages/cli/src/serve/hosted-mcp-session.ts';
module.exports = [
  { id: 'Q1', what: 'creation accepts more than 16 pins again', file: HH, group: 'ts',
    find: '        mcpServers.length > MANAGED_MCP_MAX_CONNECTIONS\n', replace: '        false\n' },
  { id: 'Q2', what: 'prompt admission quota back to 503', file: HH, group: 'ts',
    find: '            cause instanceof HostedMcpConnectionQuotaError ? 409 : 503,\n', replace: '            503,\n' },
  { id: 'Q3', what: 'configuration route loses the quota code', file: HH, group: 'ts',
    find: "            cause instanceof HostedMcpConnectionQuotaError\n              ? cause.message\n              : 'hosted_mcp_configuration_failed',", replace: "            'hosted_mcp_configuration_failed'," },
  { id: 'Q4', what: 'raw operation quota back to 503', file: HH, group: 'ts',
    find: '            cause instanceof HostedMcpConflictError ||\n              cause instanceof HostedMcpConnectionQuotaError\n              ? 409\n              : 503,', replace: '            cause instanceof HostedMcpConflictError ? 409 : 503,' },
  { id: 'Q5', what: 'quota failure no longer typed', file: HS, group: 'ts',
    find: "      if (operation.error?.code === 'managed_mcp_connection_quota')\n        throw new HostedMcpConnectionQuotaError();\n", replace: '' },
];
