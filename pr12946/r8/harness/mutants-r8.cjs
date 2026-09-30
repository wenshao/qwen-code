// Round-8 mutants: changes in 06c1df7f (R3-10, R4-1, R4-9 fixes + observe() merge).
const HH = 'packages/cli/src/serve/hosted-harness-session.ts';
const RT = 'packages/cli/src/serve/managed-mcp-runtime.ts';
const MP = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/ManagedMcpProtocol.java';
const HS = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.java';
const gate = "if (session.mcpClosing || session.mcpRecovering)\n      return error(res, 409, 'hosted_mcp_operation_active');\n    session.mcpRecovering = true;\n    void session.mcp\n      .";
module.exports = [
  { id: 'V1', what: 'R3-10 reverted for status: fenced by mcpBusy again', file: HH, group: 'ts',
    find: `${gate}status(`, replace: `${gate.replace('session.mcpClosing ||', 'session.mcpBusy || session.mcpClosing ||')}status(` },
  { id: 'V2', what: 'R3-10 reverted for cancel: fenced by mcpBusy again', file: HH, group: 'ts',
    find: `${gate}cancel(`, replace: `${gate.replace('session.mcpClosing ||', 'session.mcpBusy || session.mcpClosing ||')}cancel(` },
  { id: 'V3', what: 'status no longer serialized with other recovery requests', file: HH, group: 'ts',
    find: `${gate}status(`, replace: `${gate.replace(' || session.mcpRecovering)', ')')}status(` },
  { id: 'V4', what: 'close no longer sets mcpClosing (status/cancel allowed during close)', file: HH, group: 'ts',
    find: '    session.mcpBusy = true;\n    session.mcpClosing = true;\n', replace: '    session.mcpBusy = true;\n' },
  { id: 'V5', what: 'prompt admission ignores an in-flight status/cancel', file: HH, group: 'ts',
    find: "    if (session.mcpBusy || session.mcpRecovering)\n      return error(res, 409, 'hosted_mcp_operation_active');\n    const body = object(req.body);\n    const promptId",
    replace: "    if (session.mcpBusy)\n      return error(res, 409, 'hosted_mcp_operation_active');\n    const body = object(req.body);\n    const promptId" },
  { id: 'V6', what: 'close ignores an in-flight status/cancel', file: HH, group: 'ts',
    find: "    if (session.active || session.mcpBusy || session.mcpRecovering)\n      return error(res, 409, 'hosted_turn_active');\n    session.mcpBusy = true;\n    session.mcpClosing = true;",
    replace: "    if (session.active || session.mcpBusy)\n      return error(res, 409, 'hosted_turn_active');\n    session.mcpBusy = true;\n    session.mcpClosing = true;" },
  { id: 'V7', what: 'R4-1 reverted: every pending entry counts against the in-flight quota', file: RT, group: 'ts',
    find: "              : [...entry.pending.values()].filter(\n                  (pending) => pending.awaitingReply,\n                ).length),",
    replace: '              : entry.pending.size),' },
  { id: 'V8', what: 'an answered (invalid) reply keeps its slot', file: RT, group: 'ts',
    find: '    operation.awaitingReply = false;\n    const control = operation.control as ManagedMcpInvoke;',
    replace: '    const control = operation.control as ManagedMcpInvoke;' },
  { id: 'V9', what: 'dispatch never marks a request as awaiting a reply (quota never reached)', file: RT, group: 'ts',
    find: '      operation.awaitingReply = true;\n', replace: '' },
  { id: 'J11', what: 'R4-9 reverted: no well-formedness check on MCP control operations', file: MP, group: 'broker',
    find: '        if (!BrokerValues.isWellFormedJson(operation)) {\n            throw invalid("MCP operation is invalid.");\n        }\n', replace: '' },
  { id: 'J12', what: 'observe(): explicit reconcile no longer bypasses the observable-after-loss gate', file: HS, group: 'broker',
    find: '|| (!reconcile && !record.observableAfterLoss())) {', replace: '|| !record.observableAfterLoss()) {' },
  { id: 'J13', what: 'observe(): explicit reconcile errors fall back to UNKNOWN like the automatic ask', file: HS, group: 'broker',
    find: '        if (reconcile) {\n            return observation;\n        }\n', replace: '' },
];
