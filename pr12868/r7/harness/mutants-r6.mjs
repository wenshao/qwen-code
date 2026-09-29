// PR #12868 round 6: mutants of the lines commit 5c0c9bf323 adds, new anchors
// for earlier mutants whose lines it rewrote, and the earlier mutants it made
// pointless.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const SERVE = 'packages/cli/src/serve';
const PROTOCOL = `${SERVE}/managed-runtime-provider-protocol.ts`;
const WORKER = `${SERVE}/managed-runtime-provider-worker.ts`;
const SERVICE = `${BROKER}/RuntimeBrokerService.java`;
const VALUES = `${BROKER}/BrokerValues.java`;

const RECEIPT_RULE = `                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY
                        || binding.getState() != RuntimeBindingRecord.State.READY
                                && binding.getState() != RuntimeBindingRecord.State.DRAINING) {
                    return CompletableFuture.completedFuture(stored);
                }`;

// The id rule of round 5 was a list of refused characters; it is an allow-list
// now, so the six mutants that removed one refused character each no longer
// have a line to edit. K1 to K8 take their place.
export const superseded = new Set(['I9', 'I23', 'I24', 'I25', 'I26', 'I28']);

export const reanchored = {
  G2: { find: RECEIPT_RULE, replace: '' },
  G3: {
    find: '                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY\n',
    replace: '                if (owner != null && owner.getState() == RuntimeSessionRecord.State.READY\n',
  },
  I1: {
    find: '                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY\n',
    replace: '                if (owner == null || owner.getState() == RuntimeSessionRecord.State.RELEASED\n',
  },
  I16: {
    find: `    if (result && typeof result === 'object' && !Array.isArray(result))
      (result as Record<string, unknown>)['llmContent'] = PROVIDER_RESULT_STUB;`,
    replace: `    if (false)
      (result as Record<string, unknown>)['llmContent'] = PROVIDER_RESULT_STUB;`,
  },
  I17: {
    find: `    text.slice(0, head) +
    providerFitNotice(omitted, budgetBytes) +
    text.slice(tail);`,
    replace: `    text.slice(0, head) +
    text.slice(tail);`,
  },
};

export const round6 = [
  // ---- the id rule at the worker ----------------------------------------
  { id: 'K1', suite: 'ts', file: PROTOCOL, what: 'the worker admits a space in an id',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[A-Za-z0-9._ -]{1,512}$/;' },
  { id: 'K2', suite: 'ts', file: PROTOCOL, what: 'the worker admits a slash in an id',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[A-Za-z0-9._\\/-]{1,512}$/;' },
  { id: 'K3', suite: 'ts', file: PROTOCOL, what: 'the worker checks only how an id begins (no end anchor)',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}/;' },
  { id: 'K4', suite: 'ts', file: PROTOCOL, what: 'the worker checks only how an id ends (no start anchor)',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /[A-Za-z0-9._-]{1,512}$/;' },
  { id: 'K5', suite: 'ts', file: PROTOCOL, what: 'the worker admits an id of 513 characters',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,513}$/;' },
  { id: 'K6', suite: 'ts', file: PROTOCOL, what: 'the worker admits two dots in a row',
    find: `    value === '.' ||
    value.includes('..')
  )`, replace: `    value === '.'
  )` },
  { id: 'K7', suite: 'ts', file: PROTOCOL, what: 'the worker admits letters that are not ASCII',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[\\p{L}0-9._-]{1,512}$/u;' },
  { id: 'K8', suite: 'ts', file: PROTOCOL, what: 'the worker no longer admits an underscore',
    find: 'const SESSION_ID = /^[A-Za-z0-9._-]{1,512}$/;', replace: 'const SESSION_ID = /^[A-Za-z0-9.-]{1,512}$/;' },
  // ---- the fitter ---------------------------------------------------------
  { id: 'K9', suite: 'ts', file: PROTOCOL, what: 'a quote or a backslash is counted as one byte',
    find: '  if (codePoint === 0x22 || codePoint === 0x5c) return 2;', replace: '  if (codePoint === 0x22 || codePoint === 0x5c) return 1;' },
  { id: 'K10', suite: 'ts', file: PROTOCOL, what: 'a control character is counted as two bytes',
    find: '    return [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(codePoint) ? 2 : 6;', replace: '    return [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(codePoint) ? 2 : 2;' },
  { id: 'K11', suite: 'ts', file: PROTOCOL, what: 'a three-byte character is counted as one byte',
    find: '  return codePoint < 0x10000 ? 3 : 4;', replace: '  return codePoint < 0x10000 ? 1 : 4;' },
  { id: 'K12', suite: 'ts', file: PROTOCOL, what: 'a four-byte character is counted as three bytes',
    find: '  return codePoint < 0x10000 ? 3 : 4;', replace: '  return codePoint < 0x10000 ? 3 : 3;' },
  { id: 'K13', suite: 'ts', file: PROTOCOL, what: 'the head of a cut may end inside a surrogate pair',
    find: '    head += codePoint > 0xffff ? 2 : 1;', replace: '    head += 1;' },
  { id: 'K14', suite: 'ts', file: PROTOCOL, what: 'the tail of a cut may begin inside a surrogate pair',
    find: '      if (previous >= 0xd800 && previous <= 0xdbff) start--;', replace: '' },
  { id: 'K15', suite: 'ts', file: PROTOCOL, what: 'the notice counts UTF-16 units, not code points',
    find: '  for (const _ of text.slice(head, tail)) omitted++;', replace: '  omitted = tail - head;' },
  { id: 'K16', suite: 'ts', file: PROTOCOL, what: 'a field shorter than its notice is replaced by the notice (it grows)',
    find: '  if (omitted > 0 && jsonTextBytes(next) < size) slot.set(next);', replace: '  if (omitted > 0) slot.set(next);' },
  { id: 'K17', suite: 'ts', file: PROTOCOL, what: 'the common size ignores the size of the notices',
    find: '      shed + Math.max(0, bytes - Math.max(level, floor)),', replace: '      shed + Math.max(0, bytes - level),' },
  { id: 'K18', suite: 'ts', file: PROTOCOL, what: 'a structured display is never stubbed before the text is cut',
    find: `      typeof display !== 'string' &&
      overflows()
    ) {`, replace: `      typeof display !== 'string' &&
      false
    ) {` },
  { id: 'K19', suite: 'ts', file: PROTOCOL, what: 'hook results are never dropped',
    find: `    if (overflows()) {
      delete execution['postHook'];`, replace: `    if (false) {
      delete execution['postHook'];` },
  { id: 'K20', suite: 'ts', file: PROTOCOL, what: 'a structured display is stubbed although cut text would fit beside it',
    find: `      typeof display !== 'string' &&
      overflows()
    ) {`, replace: `      typeof display !== 'string'
    ) {` },
  { id: 'K21', suite: 'ts', file: PROTOCOL, what: 'fields are cut 1 KiB above the common size (one pass is not enough)',
    find: '        if (bytes > level) cutProviderFitSlot(slot, level, budgetBytes);', replace: '        if (bytes > level) cutProviderFitSlot(slot, level + 1024, budgetBytes);' },
  { id: 'K22', suite: 'ts', file: PROTOCOL, what: 'the room for the notice is not reserved',
    find: `    targetBytes - jsonTextBytes(providerFitNotice(text.length, budgetBytes)),`, replace: '    targetBytes,' },
  { id: 'K23', suite: 'ts', file: PROTOCOL, what: 'the head takes the whole budget of a field (no tail is kept)',
    find: '    if (headBytes + cost > Math.ceil(keep / 2)) break;', replace: '    if (headBytes + cost > keep) break;' },
  { id: 'K24', suite: 'ts', file: PROTOCOL, what: 'hook results go before a structured display',
    find: `    if (overflows()) {
      delete execution['postHook'];
      delete execution['failureHook'];
    }`, replace: `    if (true) {
      delete execution['postHook'];
      delete execution['failureHook'];
    }` },
  // ---- the worker ---------------------------------------------------------
  { id: 'K25', suite: 'ts', file: WORKER, what: 'a content modification is dropped without a word',
    find: '        if (operation.modification !== undefined)', replace: '        if (false)' },
  { id: 'K26', suite: 'ts', file: WORKER, what: 'release keeps the entries core registered for the Session',
    find: `        this.executor.closeSessionAdmission(identity.runtimeSessionId);
        forgetSession(identity.runtimeSessionId);`, replace: '        this.executor.closeSessionAdmission(identity.runtimeSessionId);' },
  { id: 'K27', suite: 'ts', file: WORKER, what: 'the model entry of an ended Session is kept',
    find: `  unregisterSessionProjectDir(runtimeSessionId);
  unregisterSessionModel(runtimeSessionId);`, replace: '  unregisterSessionProjectDir(runtimeSessionId);' },
  { id: 'K28', suite: 'ts', file: WORKER, what: 'shutdown keeps the entries core registered for its Sessions',
    find: `        await value?.history?.drain();
        forgetSession(session.identity.runtimeSessionId);`, replace: '        await value?.history?.drain();' },
  // ---- the Broker's door --------------------------------------------------
  { id: 'K29', suite: 'broker', file: VALUES, what: 'the Broker admits a space in an id',
    find: '            "[A-Za-z0-9._-]{1," + MAXIMUM_ID_LENGTH + "}");', replace: '            "[A-Za-z0-9._ -]{1," + MAXIMUM_ID_LENGTH + "}");' },
  { id: 'K30', suite: 'broker', file: VALUES, what: 'the Broker admits two dots in a row',
    find: '                || value.equals(".") || value.contains("..")) {', replace: '                || value.equals(".")) {' },
  { id: 'K31', suite: 'broker', file: VALUES, what: 'the Broker admits a single dot',
    find: '                || value.equals(".") || value.contains("..")) {', replace: '                || value.contains("..")) {' },
  { id: 'K32', suite: 'broker', file: VALUES, what: 'the Broker no longer admits an underscore',
    find: '            "[A-Za-z0-9._-]{1," + MAXIMUM_ID_LENGTH + "}");', replace: '            "[A-Za-z0-9.-]{1," + MAXIMUM_ID_LENGTH + "}");' },
  { id: 'K33', suite: 'broker', file: SERVICE, what: 'acquire does not apply the rule to the Harness Session id',
    find: `        String harnessId = BrokerValues.requirePathSafe(
                BrokerValues.requireId(harnessSessionId, "harnessSessionId"),
                "harnessSessionId");`, replace: `        String harnessId = BrokerValues.requireId(harnessSessionId,
                "harnessSessionId");` },
  { id: 'K34', suite: 'broker', file: SERVICE, what: 'acquire does not apply the rule to the Runtime Session id',
    find: `        String runtimeId = BrokerValues.requirePathSafe(
                BrokerValues.requireId(runtimeSessionId, "runtimeSessionId"),
                "runtimeSessionId");`, replace: `        String runtimeId = BrokerValues.requireWellFormed(
                BrokerValues.requireId(runtimeSessionId, "runtimeSessionId"),
                "runtimeSessionId");` },
  // ---- the repeated cancellation -----------------------------------------
  { id: 'K35', suite: 'broker', file: SERVICE, what: 'the binding is not consulted (the receipt stands only when the Session is not READY)',
    find: `                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY
                        || binding.getState() != RuntimeBindingRecord.State.READY
                                && binding.getState() != RuntimeBindingRecord.State.DRAINING) {`,
    replace: '                if (owner == null || owner.getState() != RuntimeSessionRecord.State.READY) {' },
  { id: 'K36', suite: 'broker', file: SERVICE, what: 'a DRAINING binding counts as one that can no longer answer',
    find: `                        || binding.getState() != RuntimeBindingRecord.State.READY
                                && binding.getState() != RuntimeBindingRecord.State.DRAINING) {`,
    replace: '                        || binding.getState() != RuntimeBindingRecord.State.READY) {' },
  { id: 'K37', suite: 'broker', file: SERVICE, what: 'a process without a live Session answers as before (no request for adoption)',
    find: '                if (local == null || !local.isDone() || local.isCompletedExceptionally()) {', replace: '                if (false) {' },
  { id: 'K38', suite: 'broker', file: SERVICE, what: 'an acquire that is still adopting counts as a live Session',
    find: '                if (local == null || !local.isDone() || local.isCompletedExceptionally()) {', replace: '                if (local == null || local.isCompletedExceptionally()) {' },
  { id: 'K39', suite: 'broker', file: SERVICE, what: 'an acquire that failed counts as a live Session',
    find: '                if (local == null || !local.isDone() || local.isCompletedExceptionally()) {', replace: '                if (local == null || !local.isDone()) {' },
  { id: 'K41', suite: 'broker', file: VALUES, what: 'the Broker admits letters that are not ASCII',
    find: '            "[A-Za-z0-9._-]{1," + MAXIMUM_ID_LENGTH + "}");', replace: '            "[\\\\p{L}0-9._-]{1," + MAXIMUM_ID_LENGTH + "}");' },
  { id: 'K40', suite: 'broker', file: SERVICE, what: 'the request for adoption carries the code of reconcile-in-progress',
    find: `                    throw unavailable("runtime_reconciliation_required",
                            "Runtime Session is not active in this Broker process; "`,
    replace: `                    throw unavailable("runtime_reconcile_in_progress",
                            "Runtime Session is not active in this Broker process; "` },
];
