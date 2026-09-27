// Clause-level mutants for the PR #12863 fixture A/B. Each one weakens (or,
// for the *-strict ones, tightens) exactly one check; `from` must occur once.
// T1-T5 and J1-J4 are the mutants that survived both suites when #12837 was
// verified (issuecomment-5854915882); the rest target the other new cases.
export const TS_FILE =
  'packages/core/src/managed-runtime/managed-extension-record.ts';
export const JAVA_FILE =
  'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedExtensionRecords.java';

export const ts = [
  { id: 'T1', gap: '#12846: recovery reason on reserved/admitted/settled/cancelled', from: ': reason === null;', to: ': reason === null || isRecoveryReason(reason);' },
  { id: 'T2', gap: '#12846: generation change under the same binding ID', from: 'if (sameJson(before.runtime, after.runtime))', to: 'if (before.runtime.runtimeBindingId === after.runtime?.runtimeBindingId)' },
  { id: 'T3', gap: '#12846: settling from outcome_unknown under a new binding', from: "after.execution === 'running_attached' &&", to: "(after.execution === 'running_attached' || after.execution === 'settled') &&" },
  { id: 'T4', gap: '#12846: Monitor start receipt at intent with a binding', from: "[null, 'intent', 'dispatch_started', 'not_started_proven']", to: "[null, 'dispatch_started', 'not_started_proven']" },
  { id: 'T5', gap: '#12846: grant phases given as a string', from: '!Array.isArray(scope.phases) ||', to: "(typeof scope.phases !== 'string' && !Array.isArray(scope.phases)) ||" },
  { id: 'T6', gap: 'phases array check removed (object phases)', from: '!Array.isArray(scope.phases) ||\n    scope.phases.length === 0 ||', to: 'scope.phases.length === 0 ||' },
  { id: 'T7', gap: 'phase element not text (null)', from: "if (typeof phase !== 'string' || !PHASE_PATTERN.test(phase)) {", to: 'if (!PHASE_PATTERN.test(phase as string)) {' },
  { id: 'T8', gap: 'domain not checked against the index', from: "const domain = oneOf(grant.domain, MANAGED_SESSION_DOMAINS, 'grant.domain');", to: 'const domain = grant.domain as ManagedSessionDomain;' },
  { id: 'T9', gap: 'run successor skips parsing next', from: 'const after = attempt(() => parseExtensionRun(next));', to: 'const after = next as ExtensionRun;' },
  { id: 'T10', gap: 'run successor skips parsing previous', from: 'const before = attempt(() => parseExtensionRun(previous));', to: 'const before = previous as ExtensionRun;' },
  { id: 'T11', gap: 're-attach may clear the Runtime binding', from: "after.runtime !== null &&\n    before.execution === 'outcome_unknown' &&", to: "after.runtime === null ||\n    before.execution === 'outcome_unknown' &&" },
  { id: 'T12', gap: 'monitor rebuild decided by binding ID only', from: '!sameJson(before.run.runtime, after.run.runtime);', to: '!sameJson(before.run.runtime.runtimeBindingId, after.run.runtime?.runtimeBindingId);' },
  { id: 'T13', gap: 'outputRef not parsed as a durable ref', from: "const output = ref(each, 'monitorRun.outputRef');", to: 'const output = each as ManagedSessionDurableRef;' },
  { id: 'T14', gap: 'commandRef not parsed as a durable ref', from: "commandRef: ref(monitor.commandRef, 'monitorRun.commandRef'),", to: 'commandRef: monitor.commandRef as ManagedSessionDurableRef,' },
  { id: 'T15-strict', gap: 'blocked run may not hold a settled execution (tightening)', from: "if (state === 'settled' && execution === 'not_started_proven') {", to: "if ((state === 'settled' && execution === 'not_started_proven') || (state === 'recovery_blocked' && execution === 'settled')) {" },
  { id: 'T16-eq', gap: 'stopReason enum check skipped (PR: equivalent)', from: "stopReason: nullable(monitor.stopReason, (reason) =>\n      oneOf(reason, STOP_REASONS, 'monitorRun.stopReason'),\n    ),", to: 'stopReason: monitor.stopReason as MonitorStopReason | null,' },
  { id: 'T17-eq', gap: 'run.reason enum check skipped (PR: equivalent)', from: 'reason: parseReason(run.reason, `${label}.reason`),', to: 'reason: run.reason as ExtensionReason | null,' },
];

export const java = [
  { id: 'J1', gap: '#12846: id bound U+001F', from: 'character > 0x1f', to: 'character >= 0x1f' },
  { id: 'J2', gap: '#12846: id bound DEL', from: 'character < 0x7f', to: 'character <= 0x7f' },
  { id: 'J3', gap: '#12846: id bound U+009F', from: 'character > 0x9f', to: 'character >= 0x9f' },
  { id: 'J4', gap: '#12846: lone low surrogate', from: 'require(!Character.isLowSurrogate(character),', to: 'require(true || !Character.isLowSurrogate(character),' },
  { id: 'J5', gap: 'sessionKey key set not checked', from: 'closed(grant.get("sessionKey"), Set.of("tenantId", "workspaceId",\n                "sessionId"), "grant.sessionKey");', to: '' },
  { id: 'J6-strict', gap: 'id bound refuses space (tightening)', from: 'character > 0x1f', to: 'character > 0x20' },
  { id: 'J7-strict', gap: 'id bound refuses tilde (tightening)', from: 'character < 0x7f', to: 'character < 0x7e' },
  { id: 'J8-strict', gap: 'id bound refuses NBSP (tightening)', from: 'character > 0x9f', to: 'character > 0xa0' },
  { id: 'J9-strict', gap: 'surrogate pair not skipped (refuses emoji)', from: 'if (Character.isHighSurrogate(character)) {\n                index++;', to: 'if (Character.isHighSurrogate(character)) {' },
  { id: 'J10', gap: 'domain not checked against the index', from: 'String domain = oneOf(grant.get("domain"), DOMAINS, "grant.domain");', to: 'String domain = grant.get("domain").asText();' },
  { id: 'J11', gap: 'phase element not text (null)', from: 'require(phase.isTextual() && PHASE.matcher(phase.textValue())', to: 'require(PHASE.matcher(phase.asText())' },
  { id: 'J12', gap: 'phases array check removed (object phases)', from: 'require(phases.isArray() && !phases.isEmpty()', to: 'require(!phases.isEmpty()' },
  { id: 'J13', gap: 'run.reason read without checking', from: 'String reason = nullableOneOf(run.get("reason"), concat(\n                RECOVERY_REASONS, QUOTA_REASONS), "run.reason");', to: 'String reason = run.get("reason").textValue();' },
  { id: 'J14', gap: 'recovery reason on reserved/admitted/settled/cancelled', from: 'default -> reason == null;', to: 'default -> reason == null || recovery;' },
  { id: 'J15', gap: 'generation change under the same binding ID', from: 'if (same(runtimeBefore, runtimeAfter)) {', to: 'if (same(runtimeBefore.get("runtimeBindingId"), runtimeAfter.get("runtimeBindingId"))) {' },
  { id: 'J16', gap: 'settling from outcome_unknown under a new binding', from: '&& "running_attached".equals(executionAfter)', to: '&& ("running_attached".equals(executionAfter) || "settled".equals(executionAfter))' },
  { id: 'J17', gap: 'run successor skips parsing next', from: '                || !accepts(() -> requireRun(next))\n', to: '' },
  { id: 'J18', gap: 'run successor skips parsing previous', from: '!accepts(() -> requireRun(previous))\n                || ', to: '' },
  { id: 'J19', gap: 're-attach may clear the Runtime binding', from: 'return !runtimeAfter.isNull()\n                && "outcome_unknown".equals(executionBefore)', to: 'return runtimeAfter.isNull()\n                || "outcome_unknown".equals(executionBefore)' },
  { id: 'J20', gap: 'durable ref resourceId not checked', from: 'id(node.get("resourceId"), label + ".resourceId");', to: '' },
  { id: 'J21', gap: 'durable ref kind not checked', from: 'id(node.get("kind"), label + ".kind");', to: '' },
  { id: 'J22', gap: 'durable ref schemaVersion lower bound', from: 'count(node.get("schemaVersion"), 0, MAX_COUNT,', to: 'count(node.get("schemaVersion"), -1, MAX_COUNT,' },
  { id: 'J23', gap: 'stopReason read without checking', from: 'String stopReason = nullableOneOf(monitor.get("stopReason"),\n                concat(concat(MONITOR_STOP_REASONS.get("settled"),\n                        MONITOR_STOP_REASONS.get("failed")),\n                        MONITOR_STOP_REASONS.get("cancelled")),\n                "monitorRun.stopReason");', to: 'String stopReason = monitor.get("stopReason").textValue();' },
  { id: 'J24', gap: 'outputRef not checked as a durable ref', from: 'durableRef(output, "monitorRun.outputRef");', to: '' },
  { id: 'J25', gap: 'Monitor start receipt at intent', from: '&& !"intent".equals(execution)\n', to: '\n' },
  { id: 'J26', gap: 'monitor rebuild decided by binding ID only', from: '&& !same(runtimeBefore, next.get("run").get("runtime"));', to: '&& !same(runtimeBefore.get("runtimeBindingId"), next.get("run").get("runtime").get("runtimeBindingId"));' },
  { id: 'J27-strict', gap: 'blocked run may not hold a settled execution (tightening)', from: 'require(!"settled".equals(state)\n                || !"not_started_proven".equals(execution),', to: 'require(!("recovery_blocked".equals(state) && "settled".equals(execution)) && (!"settled".equals(state)\n                || !"not_started_proven".equals(execution)),' },
];
