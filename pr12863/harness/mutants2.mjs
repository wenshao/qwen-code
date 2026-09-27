// Second batch: finer variants for cases the first batch could not isolate.
export { TS_FILE, JAVA_FILE } from './mutants.mjs';
export const ts = [
  { id: 'T11b', gap: 're-attach step may drop the Runtime binding', from: "after.runtime !== null &&\n    before.execution === 'outcome_unknown' &&\n    after.execution === 'running_attached' &&\n    BigInt(after.runtime.generation) > BigInt(before.runtime.generation)", to: "before.execution === 'outcome_unknown' &&\n    after.execution === 'running_attached' &&\n    (after.runtime === null || BigInt(after.runtime.generation) > BigInt(before.runtime.generation))" },
  { id: 'T18-strict', file: 'packages/core/src/managed-runtime/managed-session-records.ts', gap: 'id must also be NFD (refuses a precomposed accent)', from: "if (id.normalize('NFC') !== id) {", to: "if (id.normalize('NFC') !== id || id.normalize('NFD') !== id) {" },
];
export const java = [
  { id: 'J5b', gap: 'sessionKey checked by size only (misnamed field)', from: 'closed(grant.get("sessionKey"), Set.of("tenantId", "workspaceId",\n                "sessionId"), "grant.sessionKey");', to: 'require(grant.get("sessionKey").isObject() && grant.get("sessionKey").size() == 3, "grant.sessionKey");' },
  { id: 'J19b', gap: 're-attach step may drop the Runtime binding', from: 'return !runtimeAfter.isNull()\n                && "outcome_unknown".equals(executionBefore)\n                && "running_attached".equals(executionAfter)\n                && generationOf(runtimeAfter, "generation").compareTo(\n                        generationOf(runtimeBefore, "generation")) > 0;', to: 'return "outcome_unknown".equals(executionBefore)\n                && "running_attached".equals(executionAfter)\n                && (runtimeAfter.isNull() || generationOf(runtimeAfter, "generation").compareTo(\n                        generationOf(runtimeBefore, "generation")) > 0);' },
  { id: 'J28-strict', gap: 'id must also be NFD (refuses a precomposed accent)', from: 'require(Normalizer.isNormalized(value, Normalizer.Form.NFC),', to: 'require(Normalizer.isNormalized(value, Normalizer.Form.NFC) && Normalizer.isNormalized(value, Normalizer.Form.NFD),' },
];
