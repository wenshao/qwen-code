// PR #12868 round 7, head 174f974e3e: mutants of the lines the merge with
// main 12793013c4 wrote by hand. main #12975 changed the deferred start; this
// PR had moved that code into a branch of its own, so the merge carried the
// two checks over by hand.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const SERVICE = `${BROKER}/RuntimeBrokerService.java`;

export const superseded7b = new Set();
export const reanchored7b = {};
export const round7b = [
  { id: 'M1', suite: 'broker', file: SERVICE, what: 'merge: a deferred payload is not checked for well-formed text',
    find: '                if (payloadJson == null || !BrokerValues.isWellFormedJson(payloadJson)) {\n',
    replace: '                if (payloadJson == null) {\n' },
  { id: 'M2', suite: 'broker', file: SERVICE, what: 'merge: the parsed payload is not checked (an escaped unpaired surrogate passes)',
    find: '                        || !BrokerValues.isWellFormedJson(payload)\n',
    replace: '' },
  { id: 'M3', suite: 'broker', file: SERVICE, what: 'merge: a payload that is not well-formed answers a conflict, not runtime_payload_invalid',
    find: `                if (payloadJson == null || !BrokerValues.isWellFormedJson(payloadJson)) {
                    throw invalid("runtime_payload_invalid", "Tool payload is invalid");`,
    replace: `                if (payloadJson == null || !BrokerValues.isWellFormedJson(payloadJson)) {
                    throw conflict("runtime_payload_invalid", "Tool payload is invalid");` },
];
