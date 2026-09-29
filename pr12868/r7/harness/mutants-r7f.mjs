// PR #12868 round 7, head ebea694e4e: mutants of the lines commit ebea694e4e
// adds, and a new anchor for the mutant of 9cb9dc86e8 whose line it rewrote.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
export const superseded7f = new Set();
export const reanchored7f = {
  Q1: { find: '                && record.observableAfterLoss()\n', replace: '                && Integer.valueOf(3).equals(record.getReference().get("runtimeProtocol"))\n' },
};
export const round7f = [
  { id: 'S1', suite: 'broker', file: `${BROKER}/ToolExecutionRecord.java`, what: 'a provider reference cannot be asked about after a loss (only tool v3 can)',
    find: `        return Integer.valueOf(3).equals(reference.get("runtimeProtocol"))
                || ProviderRuntimeProtocol.isReference(reference);`,
    replace: '        return Integer.valueOf(3).equals(reference.get("runtimeProtocol"));' },
  { id: 'S2', suite: 'broker', file: `${BROKER}/RuntimeBrokerService.java`, what: 'the cancellation of a lost provider dispatch does not reach the worker',
    find: '                                            && !requested.observableAfterLoss())) {',
    replace: '                                            && !Integer.valueOf(3).equals(\n                                                    requested.getReference().get("runtimeProtocol")))) {' },
];
