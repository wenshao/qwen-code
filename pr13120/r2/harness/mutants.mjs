// Single-point mutants of the production validators, keyed to the rows of
// #12887 item 1. Each `find` must occur exactly once in its file.
const JM =
  'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java';
const TR = 'packages/core/src/managed-runtime/managed-extension-record.ts';
const TS = 'packages/core/src/managed-runtime/managed-session-records.ts';
const TG = 'packages/core/src/managed-runtime/managed-operation-grant-gate.ts';

const LOST_ATTACHED_JAVA = `        require(!"runtime_lost".equals(reason)
                || !"recovery_blocked".equals(state)
                || !"running_attached".equals(execution),
`;

export const MUTANTS = [
  // ---------------------------------------------------------------- Java
  {
    id: 'J01', lang: 'java', file: JM, row: '1 runtime_lost operand',
    expectCase: 'runCases/handler-unavailable-with-attached-execution',
    find: LOST_ATTACHED_JAVA,
    replace: `        require(!"recovery_blocked".equals(state)
                || !"running_attached".equals(execution),
`,
  },
  {
    id: 'J02', lang: 'java', file: JM, row: '2 high surrogate needs a low one',
    expectCase: 'grantCases/operation-id-high-surrogate-followed-by-a',
    find: `                require(index < value.length()
                        && Character.isLowSurrogate(value.charAt(index)),
`,
    replace: `                require(index < value.length(),
`,
  },
  {
    id: 'J03', lang: 'java', file: JM, row: '3 count is a number (isNumber dropped)',
    expectCase: 'monitorRunCases/debounce-as-integer-text',
    find: 'BigDecimal value = node != null && node.isNumber()\n',
    replace: 'BigDecimal value = node != null\n',
  },
  {
    id: 'J03b', lang: 'java', file: JM, row: '3 count is a number (text only)',
    expectCase: 'monitorRunCases/debounce-as-integer-text',
    find: 'BigDecimal value = node != null && node.isNumber()\n',
    replace: 'BigDecimal value = node != null && (node.isNumber() || node.isTextual())\n',
  },
  {
    id: 'J04', lang: 'java', file: JM, row: '4 digest is text',
    expectCase: 'grantCases/scope-record-digest-as-number',
    find: `        require(node != null && node.isTextual()
                && DIGEST.matcher(node.textValue()).matches(),`,
    replace: `        require(node != null
                && DIGEST.matcher(node.textValue()).matches(),`,
  },
  {
    id: 'J05', lang: 'java', file: JM, row: '5 session key is an object',
    expectCase: 'grantCases/session-key-as-three-id-array',
    find: 'require(node != null && node.isObject() && node.size() == keys.size(),',
    replace: 'require(node != null && node.size() == keys.size(),',
  },
  {
    id: 'J06', lang: 'java', file: JM, row: '6 corrupt monitor keeps its receipt',
    expectCase: 'monitorRunCases/corrupt-watch-retains-start-receipt',
    find: `                && !"not_started_proven".equals(execution),
                "monitorRun.startReceiptRef must be null before the watch "`,
    replace: `                && !"not_started_proven".equals(execution)
                && !"corrupt".equals(execution),
                "monitorRun.startReceiptRef must be null before the watch "`,
  },
  {
    id: 'J07', lang: 'java', file: JM, row: '7 single-letter phase',
    expectCase: 'grantCases/single-letter-phase',
    find: '"[a-z][a-z0-9_]{0," + (MAX_PHASE_LENGTH - 1) + "}"',
    replace: '"[a-z][a-z0-9_]{1," + (MAX_PHASE_LENGTH - 1) + "}"',
  },
  {
    id: 'J08', lang: 'java', file: JM, row: '7 one observation needs a receipt',
    expectCase: 'monitorRunCases/first-observation-without-start-receipt',
    find: 'require(!startReceipt.isNull() || observed == 0\n',
    replace: 'require(!startReceipt.isNull() || observed <= 1\n',
  },
  {
    id: 'J09', lang: 'java', file: JM, row: '7 zero-byte durable ref',
    expectCase: 'grantCases/scope-record-zero-byte-length',
    find: 'count(node.get("byteLength"), 0, MAX_COUNT, label + ".byteLength");',
    replace: 'count(node.get("byteLength"), 1, MAX_COUNT, label + ".byteLength");',
  },
  {
    id: 'J09s', lang: 'java', file: JM, row: '7 durable ref schemaVersion floor (not asked)',
    expectCase: null,
    find: 'count(node.get("schemaVersion"), 0, MAX_COUNT,',
    replace: 'count(node.get("schemaVersion"), 1, MAX_COUNT,',
  },
  {
    id: 'J10a', lang: 'java', file: JM, row: '8 null line',
    expectCase: 'allowsExactlyTheListedStepBetweenEveryPairOfStates',
    find: 'if (line == null || from == null || to == null) {',
    replace: 'if (from == null || to == null) {',
  },
  {
    id: 'J10b', lang: 'java', file: JM, row: '8 null from',
    expectCase: 'allowsExactlyTheListedStepBetweenEveryPairOfStates',
    find: 'if (line == null || from == null || to == null) {',
    replace: 'if (line == null || to == null) {',
  },
  {
    id: 'J11', lang: 'java', file: JM, row: 'renamed pair: settled -> running_attached',
    expectCase: 'monitorRunSuccessorCases/restarts-a-settled-watch-under-the-same-runtime',
    find: `                : executionAfter == null || !advances("execution",
                        executionBefore, executionAfter)) {`,
    replace: `                : executionAfter == null || !advances("execution",
                        executionBefore, executionAfter)
                        && !("settled".equals(executionBefore)
                                && "running_attached".equals(executionAfter))) {`,
  },
  {
    id: 'J12', lang: 'java', file: JM, row: 'probe: rebinding allowed from any execution',
    expectCase: null,
    find: `        return !runtimeAfter.isNull()
                && "outcome_unknown".equals(executionBefore)
`,
    replace: `        return !runtimeAfter.isNull()
`,
  },
  {
    id: 'J13', lang: 'java', file: JM, row: 'probe: rebuild may keep the old receipt',
    expectCase: null,
    find: '|| (rebuilt ? !sameReceipt : sameReceipt);',
    replace: '|| rebuilt || sameReceipt;',
  },
  {
    id: 'JP1', lang: 'java', file: JM, row: 'control: 65-char phase',
    expectCase: null,
    find: '"[a-z][a-z0-9_]{0," + (MAX_PHASE_LENGTH - 1) + "}"',
    replace: '"[a-z][a-z0-9_]{0," + MAX_PHASE_LENGTH + "}"',
  },
  {
    id: 'JP2', lang: 'java', file: JM, row: 'control: lost-Runtime-while-attached rule removed',
    expectCase: null,
    find:
      LOST_ATTACHED_JAVA +
      '                "run cannot be blocked on a lost Runtime while attached");\n',
    replace: '',
  },
  // ---------------------------------------------------------- TypeScript
  {
    id: 'T01', lang: 'ts', file: TR, row: '1 runtime_lost operand',
    expectCase: 'handler-unavailable-with-attached-execution',
    find: `    reason === 'runtime_lost' &&
    state === 'recovery_blocked' &&
    run.execution === 'running_attached'`,
    replace: `    state === 'recovery_blocked' &&
    run.execution === 'running_attached'`,
  },
  {
    id: 'T02', lang: 'ts', file: TS, row: '2 high surrogate needs a low one',
    expectCase: 'operation-id-high-surrogate-followed-by-a',
    find: "if (Buffer.from(id, 'utf8').toString('utf8') !== id) {",
    replace: 'if (/[\\ud800-\\udbff]$|(^|[^\\ud800-\\udbff])[\\udc00-\\udfff]/.test(id)) {',
  },
  {
    id: 'T03', lang: 'ts', file: TR, row: '3 count is a number',
    expectCase: 'debounce-as-integer-text',
    find: `  const number = assertManagedSessionSequence(
    value as ManagedSessionJsonValue,
    label,
  );`,
    replace: `  const number = assertManagedSessionSequence(
    (typeof value === 'string' && /^[0-9]+$/.test(value)
      ? Number(value)
      : value) as ManagedSessionJsonValue,
    label,
  );`,
  },
  {
    id: 'T05', lang: 'ts', file: TS, row: '5 session key is an object',
    expectCase: 'session-key-as-three-id-array',
    find: "if (value === null || typeof value !== 'object' || Array.isArray(value)) {",
    replace: "if (value === null || typeof value !== 'object') {",
  },
  {
    id: 'T06', lang: 'ts', file: TR, row: '6 corrupt monitor keeps its receipt',
    expectCase: 'corrupt-watch-retains-start-receipt',
    find: "[null, 'intent', 'dispatch_started', 'not_started_proven'];",
    replace: "[null, 'intent', 'dispatch_started', 'not_started_proven', 'corrupt'];",
  },
  {
    id: 'T07', lang: 'ts', file: TR, row: '7 single-letter phase',
    expectCase: 'single-letter-phase',
    find: '`^[a-z][a-z0-9_]{0,${LIMITS.maxPhaseLength - 1}}$`',
    replace: '`^[a-z][a-z0-9_]{1,${LIMITS.maxPhaseLength - 1}}$`',
  },
  {
    id: 'T08', lang: 'ts', file: TR, row: '7 one observation needs a receipt',
    expectCase: 'first-observation-without-start-receipt',
    find: "(observationSequence > 0 || execution === 'running_attached')",
    replace: "(observationSequence > 1 || execution === 'running_attached')",
  },
  {
    id: 'T09', lang: 'ts', file: TS, row: '7 zero-byte durable ref',
    expectCase: 'scope-record-zero-byte-length',
    find: `    byteLength: assertManagedSessionSequence(
      record['byteLength'],
      \`\${label}.byteLength\`,
    ),`,
    replace: `    byteLength:
      record['byteLength'] === 0
        ? fail(\`\${label}.byteLength is out of range.\`)
        : assertManagedSessionSequence(
            record['byteLength'],
            \`\${label}.byteLength\`,
          ),`,
  },
  {
    id: 'T11', lang: 'ts', file: TR, row: 'renamed pair: settled -> running_attached',
    expectCase: 'restarts-a-settled-watch-under-the-same-runtime',
    find: `      : after.execution === null ||
        !advances('execution', before.execution, after.execution)`,
    replace: `      : after.execution === null ||
        (!advances('execution', before.execution, after.execution) &&
          !(
            before.execution === 'settled' &&
            after.execution === 'running_attached'
          ))`,
  },
  {
    id: 'TP1', lang: 'ts', file: TR, row: 'control: 65-char phase',
    expectCase: null,
    find: '`^[a-z][a-z0-9_]{0,${LIMITS.maxPhaseLength - 1}}$`',
    replace: '`^[a-z][a-z0-9_]{0,${LIMITS.maxPhaseLength}}$`',
  },
  {
    id: 'TP2', lang: 'ts', file: TR, row: 'control: lost-Runtime-while-attached rule removed',
    expectCase: null,
    find: `  if (
    reason === 'runtime_lost' &&
    state === 'recovery_blocked' &&
    run.execution === 'running_attached'
  ) {
    fail(\`\${label} cannot be blocked on a lost Runtime while attached.\`);
  }
`,
    replace: '',
  },
  {
    id: 'G1', lang: 'ts', file: TG, row: 'gate: a malformed grant drops installed grants',
    expectCase: 'replaces a grant as the contract allows',
    find: `    const grant = parseOperationGrant(value);
    const key = gateKey(grant.sessionKey, grant.operationId);`,
    replace: `    let grant: OperationGrant;
    try {
      grant = parseOperationGrant(value);
    } catch (error) {
      this.entries.clear();
      throw error;
    }
    const key = gateKey(grant.sessionKey, grant.operationId);`,
  },
  {
    id: 'G2', lang: 'ts', file: TG, row: 'gate: a malformed grant replaces the installed one',
    expectCase: 'replaces a grant as the contract allows',
    find: `    const grant = parseOperationGrant(value);
    const key = gateKey(grant.sessionKey, grant.operationId);`,
    replace: `    let grant: OperationGrant;
    try {
      grant = parseOperationGrant(value);
    } catch (error) {
      const raw = value as OperationGrant;
      const rawKey = gateKey(raw.sessionKey, raw.operationId);
      this.entries.set(rawKey, {
        grant: raw,
        revokedThrough: this.entries.get(rawKey)?.revokedThrough ?? 0,
      });
      throw error;
    }
    const key = gateKey(grant.sessionKey, grant.operationId);`,
  },
  {
    id: 'G3', lang: 'ts', file: TG, row: 'gate: a malformed grant shortens the installed lease',
    expectCase: 'replaces a grant as the contract allows',
    find: `    const grant = parseOperationGrant(value);
    const key = gateKey(grant.sessionKey, grant.operationId);`,
    replace: `    let grant: OperationGrant;
    try {
      grant = parseOperationGrant(value);
    } catch (error) {
      const raw = value as OperationGrant;
      const held = this.entries.get(gateKey(raw.sessionKey, raw.operationId));
      if (held?.grant) held.grant = { ...held.grant, expiresAt: 1 };
      throw error;
    }
    const key = gateKey(grant.sessionKey, grant.operationId);`,
  },
  {
    id: 'T09s', lang: 'ts', file: TS, row: '7 durable ref schemaVersion floor (not asked)',
    expectCase: null,
    find: `    schemaVersion: assertManagedSessionSequence(
      record['schemaVersion'],`,
    replace: `    schemaVersion: assertManagedSessionSequence(
      record['schemaVersion'] === 0 ? -1 : record['schemaVersion'],`,
  },
];
