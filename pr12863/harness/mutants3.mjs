// Third batch: a sample of the gaps the PR's audit record defers
// ("Fixture gaps outside the stated mutation set"). Expected to survive.
export { TS_FILE, JAVA_FILE } from './mutants.mjs';
export const ts = [
  { id: 'D1-ts', gap: 'deferred: single-letter phase refused', from: '`^[a-z][a-z0-9_]{0,${LIMITS.maxPhaseLength - 1}}$`', to: '`^[a-z][a-z0-9_]{1,${LIMITS.maxPhaseLength - 1}}$`' },
  { id: 'D2-ts', gap: 'deferred: one observation without a receipt', from: '(observationSequence > 0 || execution === \'running_attached\')', to: '(observationSequence > 1 || execution === \'running_attached\')' },
];
export const java = [
  { id: 'D1-java', gap: 'deferred: single-letter phase refused', from: '"[a-z][a-z0-9_]{0," + (MAX_PHASE_LENGTH - 1) + "}"', to: '"[a-z][a-z0-9_]{1," + (MAX_PHASE_LENGTH - 1) + "}"' },
  { id: 'D3-java', gap: 'deferred: durable ref with zero byteLength refused', from: 'count(node.get("byteLength"), 0, MAX_COUNT,', to: 'count(node.get("byteLength"), 1, MAX_COUNT,' },
  { id: 'D4-java', gap: 'deferred: runtime_lost qualifier of blocked-and-attached', from: 'require(!"runtime_lost".equals(reason)\n                || !"recovery_blocked".equals(state)', to: 'require(!"recovery_blocked".equals(state)' },
];
