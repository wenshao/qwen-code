// Round-4 mutants: the B1 fix (explicit v2 reconciliation opt-in).
const HSV = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.java';
const WB = 'packages/cli/src/serve/hosted-workspace-broker.ts';
module.exports = [
  { id: 'Y1', what: 'MCP opt-in ignored: only v3 is reconciled (MCP late results lost)', file: HSV, group: 'broker',
    find: '&& (reconcile || Integer.valueOf(3).equals(', replace: '&& (false || Integer.valueOf(3).equals(' },
  { id: 'Y2', what: 'every UNKNOWN read reconciles again (B1 back)', file: HSV, group: 'broker',
    find: '&& (reconcile || Integer.valueOf(3).equals(', replace: '&& (true || Integer.valueOf(3).equals(' },
  { id: 'Y3', what: 'Hosted MCP polling does not send ?reconcile=true', file: WB, group: 'ts',
    find: 'waitForUnknown ? `${path}?reconcile=true` : path,', replace: 'path,' },
  { id: 'Y4', what: 'reconcile query value not validated', file: HSV, group: 'broker',
    find: 'if (!"true".equals(reconcile) && !"false".equals(reconcile)) {', replace: 'if (false) {' },
];
