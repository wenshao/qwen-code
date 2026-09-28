// usage: node mutants.cjs <apply|restore> <name>
const fs = require('fs');
const path = require('path');
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad';
const WT = `${SP}/wt-mut`;
const RB = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const MS = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service';
const M = {
  A1: { kind: 'ts', file: 'packages/cli/src/serve/hosted-harness-session.ts', marker: 'RIG_MUTANT_A1', edits: [[
    `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    `if (restore.recoveryStatus !== 'ok' || (hasUnsettledInput(session) && 'RIG_MUTANT_A1'.length < 0)) {`]] },
  H1: { kind: 'ts', file: 'packages/cli/src/serve/hosted-workspace-broker.ts', marker: 'RIG_MUTANT_H1', edits: [[
    `      response ??= await this.request(path);`,
    `      try {
        response ??= await this.request(path);
      } catch (rigError) {
        if (!(rigError instanceof HostedWorkspaceBrokerRejection)) throw rigError;
        return {
          executionStatus: 'error',
          responseParts: [],
          error: { type: 'RIG_MUTANT_H1', message: String(rigError) },
        } as unknown as ManagedToolResultPayload;
      }`]] },
  H2: { kind: 'ts', file: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts', marker: 'RIG_MUTANT_H2', edits: [[
    `      await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));
      throw new HostedToolRecoveryRequiredError(cause);`,
    `      await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));
      await this.broker.release().catch(() => 'RIG_MUTANT_H2');
      throw new HostedToolRecoveryRequiredError(cause);`]] },
  H3: { kind: 'ts', file: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts', marker: 'RIG_MUTANT_H3', edits: [[
    `        await this.commit('tool_result', converted, model);
        await this.harness.resolveAwaitRuntime(executionCallId, outcomeRef);`,
    `        await this.harness.resolveAwaitRuntime(executionCallId, outcomeRef);
        if ('RIG_MUTANT_H3'.length > 0) await this.commit('tool_result', converted, model);`]] },
  T503: { kind: 'ts', file: 'packages/cli/src/serve/hosted-harness-session.ts', marker: 'RIG_MUTANT_T503', edits: [[
    `        const events: unknown[] = [];`,
    `        const events: unknown[] = [];
        if ('RIG_MUTANT_T503'.length > 0) throw new Error('RIG_MUTANT_T503');`]] },
  T200: { kind: 'ts', file: 'packages/cli/src/serve/hosted-harness-session.ts', marker: 'RIG_MUTANT_T200', edits: [[
    `        const last = page.at(-1)?.sequence ?? cursor;`,
    `        if (session.blocked) events.push({ type: 'turn_error', rig: 'RIG_MUTANT_T200' });
        const last = page.at(-1)?.sequence ?? cursor;`]] },
  J1: { kind: 'server', file: `${MS}/WorkspaceRuntimeTransport.java`, marker: 'RIG_MUTANT_J1', edits: [[
    `        return delegate.execute(lease, session, reference);
    }`,
    `        CompletionStage<Map<String, Object>> rigStage = delegate.execute(lease, session, reference);
        if (!managed(session)) {
            return rigStage;
        }
        return rigStage.whenComplete((rigResult, rigError) -> {
            if (rigError != null) {
                System.err.println("RIG_MUTANT_J1 releasing storage owner after " + rigError);
                Context rigContext = context(lease, session, false);
                ownership.release(rigContext.binding(), rigContext.session());
            }
        });
    }`]] },
  J2: { kind: 'broker', file: `${RB}/RuntimeBrokerService.java`, marker: 'RIG_MUTANT_J2', edits: [[
    `                : transport.execute(context.lease(), context.session(), executing.getReference(), payload))
                .<Void>handle((result, error) -> {`,
    `                : transport.execute(context.lease(), context.session(), executing.getReference(), payload))
                .exceptionallyCompose(rigError -> {
                    System.err.println("RIG_MUTANT_J2 re-dispatching after " + rigError);
                    return payload == null
                            ? transport.execute(context.lease(), context.session(), executing.getReference())
                            : transport.execute(context.lease(), context.session(), executing.getReference(), payload);
                })
                .<Void>handle((result, error) -> {`]] },
  J3: { kind: 'broker', file: `${RB}/RuntimeBrokerHttpServer.java`, marker: 'RIG_MUTANT_J3', edits: [[
    `        if (record.getState() == ToolExecutionRecord.State.UNKNOWN) {
            throw new RuntimeBrokerException(409,
                    "runtime_broker_execution_unknown",
                    "Runtime execution outcome is unknown.", false);
        }`,
    `        if (record.getState() == ToolExecutionRecord.State.UNKNOWN) {
            Map<String, Object> rigResponse = envelope(harnessSessionId,
                    runtimeSessionId, "executionCallId",
                    record.getExecutionCallId());
            Map<String, Object> rigStatus = new LinkedHashMap<>();
            rigStatus.put("state", "settled");
            rigStatus.put("result", Map.of("executionStatus", "not_started",
                    "responseParts", java.util.List.of(),
                    "error", Map.of("type", "RIG_MUTANT_J3", "message", "unknown reported as not started")));
            rigResponse.put("status", rigStatus);
            return rigResponse;
        }`]] },
};
const [action, name] = process.argv.slice(2);
const m = M[name];
if (!m) throw new Error(`unknown mutant ${name}`);
const file = path.join(WT, m.file);
const backup = `${SP}/rig/mut-orig-${name}`;
if (action === 'apply') {
  let s = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(backup, s);
  for (const [a, b] of m.edits) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${name}: expected 1 match, got ${n}`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(file, s);
  console.log(`${m.kind} ${m.marker}`);
} else {
  fs.writeFileSync(file, fs.readFileSync(backup));
  console.log('restored', m.file);
}
