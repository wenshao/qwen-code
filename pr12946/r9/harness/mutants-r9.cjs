// Round-9 mutants: changes in 40b05a74 (R4-9, R5-1..R5-5, R5-7, refresh P1, approval grant renewal).
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const MS = 'packages/cli/src/serve/hosted-mcp-session.ts';
const RT = 'packages/cli/src/serve/managed-mcp-runtime.ts';
const TT = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const HT = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/HttpRuntimeTransport.java';
const BS = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const inProgress = "        if (this.configuring.has(catalog.serverId))\n          throw new Error('Runtime MCP configuration is in progress.');\n";
module.exports = [
  { id: 'K1', what: 'R4-9 route check removed (malformed Unicode reaches the Broker)', file: HH, group: 'ts',
    find: '    if (strings.some((value) => /\\p{Cs}/u.test(value)))\n      return error(res, 400, \'invalid_mcp_operation\');\n', replace: '' },
  { id: 'K2', what: 'R5-1: refresh no longer refuses while an explicit configuration runs (first check)', file: MS, group: 'ts',
    find: `        signal?.throwIfAborted();\n${inProgress}        const response = await this.dispatch(`,
    replace: '        signal?.throwIfAborted();\n        const response = await this.dispatch(' },
  { id: 'K3', what: 'R5-2: an unknown release is never re-sent', file: MS, group: 'ts',
    find: "      if (!response || response.state === 'outcome_unknown') {", replace: '      if (!response) {' },
  { id: 'K4', what: 'R5-3: list-changed lookup through the prototype chain again', file: RT, group: 'ts',
    find: '            const kind = Object.hasOwn(changed, message.method)\n              ? changed[message.method as keyof typeof changed]\n              : undefined;',
    replace: '            const kind = changed[message.method as keyof typeof changed];' },
  { id: 'K5', what: 'R5-4: a failed sibling drain fails the new configuration again', file: RT, group: 'ts',
    find: '            await this.closeConnection(sibling).catch(() => undefined);', replace: '            await this.closeConnection(sibling);' },
  { id: 'K6', what: 'refresh P1: the replacement configure no longer receives the turn signal', file: MS, group: 'ts',
    find: '              .map((entry) => entry.configRevision),\n          ),\n          signal,\n        );',
    replace: '              .map((entry) => entry.configRevision),\n          ),\n        );' },
  { id: 'K7', what: 'close no longer refuses while a refresh or configuration runs', file: MS, group: 'ts',
    find: '    if (this.initializing || this.refreshing || this.configuring.size)', replace: '    if (this.initializing)' },
  { id: 'K8', what: 'approval: a late approval keeps the expired grant', file: TT, group: 'ts',
    find: '              input: { ...payload.input, grant: renewed.input.grant },', replace: '              input: { ...payload.input },' },
  { id: 'J14', what: 'R5-5: oversized MCP operation escapes as IllegalArgumentException (503)', file: HT, group: 'broker',
    find: '                throw new RuntimeBrokerException(413, "runtime_control_operation_too_large",\n                        "Runtime MCP operation exceeds its size limit.", false);',
    replace: '                throw tooLarge;' },
  { id: 'J15', what: 'R5-7: the adopted SessionContext is not evicted after a failed release', file: BS, group: 'broker',
    find: '                                sessions.remove(runtimeSessionId, adopted);', replace: '' },
];
