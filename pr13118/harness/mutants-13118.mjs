// PR #13118 mutation matrix.
// Group "claimed": the nine mutants the PR says it now kills, applied with the
// find/replace of the #12868 round-7 harness (pr12868/r7/harness/mutants*.mjs,
// wenshao/qwen-code a8398b8ddb), copied verbatim.
// Group "open": the three the PR leaves for classification (L20, L34, L35) and
// the four the issue lists as needing no test (Q4, K36, K39, H3), verbatim.
// Group "extra": variants written for this verification, to see how tightly
// each new assertion is tied to its guard.
import { mutants as r1, round2, round3, round4, round5 } from '../r7h/pr12868/r7/harness/mutants.mjs';
import { round6 } from '../r7h/pr12868/r7/harness/mutants-r6.mjs';
import { round7 } from '../r7h/pr12868/r7/harness/mutants-r7.mjs';
import { round7c } from '../r7h/pr12868/r7/harness/mutants-r7c.mjs';
import { round7d } from '../r7h/pr12868/r7/harness/mutants-r7d.mjs';

const all = [...r1, ...round2, ...round3, ...round4, ...round5, ...round6, ...round7, ...round7c, ...round7d];
const pick = (id) => {
  const hits = all.filter((m) => m.id === id);
  if (hits.length !== 1) throw new Error(`${id}: ${hits.length} definitions`);
  return hits[0];
};

const WORKER = 'packages/cli/src/serve/managed-runtime-provider-worker.ts';
const EXECUTOR = 'packages/cli/src/serve/managed-runtime-tool-executor.ts';
const TRANSPORT =
  'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/HttpRuntimeTransport.java';

export const claimed = ['L11', 'Q6', 'H8', 'N17', 'T18', 'T2', 'T8', 'P5', 'I6'].map(pick);
export const open = ['L20', 'L34', 'L35', 'Q4', 'K36', 'K39', 'H3'].map(pick);
export const extra = [
  { id: 'X1', suite: 'ts', file: WORKER, what: 'status includes the event at the cursor (afterSequence - 1)',
    find: "          operation.kind === 'status' ? operation.afterSequence : 0,",
    replace: "          operation.kind === 'status' ? Math.max(0, operation.afterSequence - 1) : 0," },
  { id: 'X2', suite: 'ts', file: WORKER, what: 'the response limit is the larger of route and kind limits',
    find: '        const limit = Math.min(\n          MANAGED_RUNTIME_PROVIDER_ROUTE.responseBodyLimitBytes,',
    replace: '        const limit = Math.max(\n          MANAGED_RUNTIME_PROVIDER_ROUTE.responseBodyLimitBytes,' },
  { id: 'X3', suite: 'ts', file: WORKER, what: 'release refuses only above one pending control (> 1)',
    find: "      if (session.pending > 0)\n        conflict('Managed Runtime Session still owns unfinished work.');",
    replace: "      if (session.pending > 1)\n        conflict('Managed Runtime Session still owns unfinished work.');" },
  { id: 'X4', suite: 'ts', file: WORKER, what: 'admission is closed before prepared work is released (order swapped)',
    find: '        await entry.value?.runtime.releasePrepared();\n        this.executor.closeSessionAdmission(identity.runtimeSessionId);',
    replace: '        this.executor.closeSessionAdmission(identity.runtimeSessionId);\n        await entry.value?.runtime.releasePrepared();' },
  { id: 'X5', suite: 'ts', file: EXECUTOR, what: 'closing admission no longer marks the Session closed for the raw path',
    find: '    this.closedSessions.add(sessionId);\n  }\n\n  private assertLegacySession',
    replace: '  }\n\n  private assertLegacySession' },
  { id: 'X6', suite: 'ts', file: WORKER, what: 'a failed retirement is swallowed without the warning',
    find: "        debugLogger.warn('Retiring a released Session failed:', error),",
    replace: '        undefined,' },
  { ...pick('Q5'), id: 'X7', what: 'the Shell directory is taken as written (Q5 of round 7)' },
  { id: 'X8', suite: 'broker', file: TRANSPORT, what: 'only lastSeq is checked against 2^53 - 1 (firstAvailableSeq unchecked)',
    find: '                || !providerSequence(result.get("lastSeq"))\n                || !providerSequence(result.get("firstAvailableSeq"))) {',
    replace: '                || !providerSequence(result.get("lastSeq"))) {' },
  { id: 'X9', suite: 'broker', file: TRANSPORT, what: 'firstAvailableSeq keeps its exact, non-negative check but loses the 2^53 - 1 bound',
    find: '                || !providerSequence(result.get("firstAvailableSeq"))) {',
    replace: '                || !(BrokerValues.exactLong(result.get("firstAvailableSeq")) instanceof Long first && first >= 0)) {' },
  { id: 'X10', suite: 'ts', file: WORKER, what: 'the envelope limit gate is inclusive (> becomes >=), bot R1-2',
    find: '        if (Buffer.byteLength(json) > limit) {',
    replace: '        if (Buffer.byteLength(json) >= limit) {' },
  { id: 'X11', suite: 'ts', file: WORKER, what: 'the envelope overhead is measured one byte short, bot R1-2',
    find: '              result: 0,\n            }),\n          ) - 1;',
    replace: '              result: 0,\n            }),\n          ) - 2;' },
  { id: 'X13', suite: 'broker', file: TRANSPORT, what: 'the provider cursor bound excludes 2^53 - 1 (<= becomes <), bot R1-5',
    find: '        return sequence != null && sequence >= 0 && sequence <= 9007199254740991L;',
    replace: '        return sequence != null && sequence >= 0 && sequence < 9007199254740991L;' },
];

export const mutants = [...claimed, ...open, ...extra];
