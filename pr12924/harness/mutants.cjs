// usage: node mutants.cjs <apply|restore|check> <name> [worktree]
// apply: edits wt-mut from a pristine backup; restore: puts the backup back;
// check: dry-run every edit against the given worktree (default wt-pr).
const fs = require('fs');
const path = require('path');
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/028f1664-c9a6-47d4-91b9-cc5a71282104/scratchpad';
const RB = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const BROKER = 'packages/cli/src/serve/hosted-workspace-broker.ts';
const TURN = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const SESSION = 'packages/cli/src/serve/hosted-harness-session.ts';
const EXEC = 'packages/cli/src/serve/managed-runtime-tool-executor.ts';
const M = {
  // Harness sends start even though the prompt was already cancelled.
  T1: { kind: 'ts', file: BROKER, marker: 'RIG_MUTANT_T1', edits: [[
    `    if (!signal.aborted) {
      try {
        response = await this.request(\`\${path}:start\`, { payloadJson });`,
    `    if (!signal.aborted || 'RIG_MUTANT_T1'.length > 0) {
      try {
        response = await this.request(\`\${path}:start\`, { payloadJson });`]] },
  // Harness treats the cancel_requested ACK as a cancelled settlement.
  T2: { kind: 'ts', file: BROKER, marker: 'RIG_MUTANT_T2', edits: [[
    `      const status = object(response['status']);
      if (status['state'] === 'settled') {`,
    `      const status = object(response['status']);
      if (status['state'] === 'cancel_requested' && 'RIG_MUTANT_T2'.length > 0)
        return { executionStatus: 'cancelled', responseParts: [] } as unknown as ManagedToolResultPayload;
      if (status['state'] === 'settled') {`]] },
  // Harness releases the Workspace owner after an unconfirmed cancellation.
  T3: { kind: 'ts', file: TURN, marker: 'RIG_MUTANT_T3', edits: [[
    `      await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));
      throw new HostedToolRecoveryRequiredError(cause);`,
    `      await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));
      if (signal.aborted) await this.broker.release().catch(() => 'RIG_MUTANT_T3');
      throw new HostedToolRecoveryRequiredError(cause);`]] },
  // Live Session is not marked blocked when the unknown outcome followed a cancel.
  T4: { kind: 'ts', file: SESSION, marker: 'RIG_MUTANT_T4', edits: [[
    `        if (cause instanceof HostedToolRecoveryRequiredError) {
          session.blocked = true;`,
    `        if (cause instanceof HostedToolRecoveryRequiredError) {
          session.blocked = !abort.signal.aborted && 'RIG_MUTANT_T4'.length > 0;`]] },
  // Cold load ignores unsettled input (keeps the recoveryStatus half).
  T5a: { kind: 'ts', file: SESSION, marker: 'RIG_MUTANT_T5A', edits: [[
    `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    `if (restore.recoveryStatus !== 'ok' || (hasUnsettledInput(session) && 'RIG_MUTANT_T5A'.length < 0)) {`]] },
  // Cold load ignores recoveryStatus (keeps the unsettled-input half).
  T5b: { kind: 'ts', file: SESSION, marker: 'RIG_MUTANT_T5B', edits: [[
    `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    `if ((restore.recoveryStatus !== 'ok' && 'RIG_MUTANT_T5B'.length < 0) || hasUnsettledInput(session)) {`]] },
  // Cold load admits everything.
  T5c: { kind: 'ts', file: SESSION, marker: 'RIG_MUTANT_T5C', edits: [[
    `if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {`,
    `if ('RIG_MUTANT_T5C'.length < 0) {`]] },
  // Live prompt route admits a new prompt on a blocked Session.
  T6: { kind: 'ts', file: SESSION, marker: 'RIG_MUTANT_T6', edits: [[
    `    if (session.blocked)
      return error(res, 409, 'hosted_turn_recovery_required');`,
    `    if (session.blocked && 'RIG_MUTANT_T6'.length < 0)
      return error(res, 409, 'hosted_turn_recovery_required');`]] },
  // Harness never forwards the cancellation to the Broker.
  T7: { kind: 'ts', file: BROKER, marker: 'RIG_MUTANT_T7', edits: [[
    `      if (signal.aborted && !cancellationSent) {`,
    `      if (signal.aborted && !cancellationSent && 'RIG_MUTANT_T7'.length < 0) {`]] },
  // Policy probe: a lost cancel reply is tolerated and observation continues.
  P1: { kind: 'ts', file: BROKER, marker: 'RIG_MUTANT_P1', edits: [[
    `        response = await this.request(\`\${path}:cancel\`, {});
      }`,
    `        try {
          response = await this.request(\`\${path}:cancel\`, {});
        } catch (rigError) {
          if (!(rigError instanceof TypeError)) throw rigError;
          response = undefined;
          (globalThis as Record<string, unknown>)['rigP1'] = 'RIG_MUTANT_P1';
        }
      }`]] },
  // Policy probe: a 503 status reply is tolerated and observation continues.
  P2: { kind: 'ts', file: BROKER, marker: 'RIG_MUTANT_P2', edits: [[
    `      response ??= await this.request(path);`,
    `      try {
        response ??= await this.request(path);
      } catch (rigError) {
        if (!(rigError instanceof HostedWorkspaceBrokerRejection) || rigError.status !== 503) throw rigError;
        await delay('RIG_MUTANT_P2'.length * 10);
        continue;
      }`]] },
  // Worker settles a running call as cancelled at the cancel request, before the tool returns.
  W1: { kind: 'ts', file: EXEC, marker: 'RIG_MUTANT_W1', edits: [
    [`    if (entry.state === 'executing') {
      entry.state = 'cancel_requested';
      entry.lastSequence += 1;
      entry.controller.abort();
    }
    return view(entry);`,
    `    if (entry.state === 'executing') {
      entry.state = 'cancel_requested';
      entry.lastSequence += 1;
      entry.controller.abort();
      (globalThis as Record<string, unknown>)['rigW1'] = 'RIG_MUTANT_W1';
      entry.result = { executionStatus: 'cancelled', responseParts: [] };
      entry.state = 'settled';
    }
    return view(entry);`],
    [`    } else if (entry.state === 'executing') {
      entry.state = 'cancel_requested';
      entry.lastSequence++;
      entry.controller.abort();
    }
    return v3View(entry);`,
    `    } else if (entry.state === 'executing') {
      entry.state = 'cancel_requested';
      entry.lastSequence++;
      entry.controller.abort();
      (globalThis as Record<string, unknown>)['rigW1'] = 'RIG_MUTANT_W1';
      entry.v3Result = { executionStatus: 'cancelled', responseParts: [], capture: null };
      entry.state = 'settled';
    }
    return v3View(entry);`]] },
  // Broker settles the ledger as cancelled on the Runtime's cancel_requested ACK.
  J1: { kind: 'broker', file: `${RB}/RuntimeBrokerService.java`, marker: 'RIG_MUTANT_J1', edits: [[
    `        if (!"settled".equals(state)) {
            return;
        }
        Map<String, Object> result = runtimeMap(status.get("result"),
                "cancellation result");`,
    `        if ("cancel_requested".equals(state)) {
            System.err.println("RIG_MUTANT_J1");
            java.util.Map<String, Object> rigResult = new java.util.LinkedHashMap<>();
            rigResult.put("executionStatus", "cancelled");
            rigResult.put("responseParts", java.util.List.of());
            settleExecution(requested.getExecutionCallId(),
                    requested.getDispatchGeneration(), rigResult);
            return;
        }
        if (!"settled".equals(state)) {
            return;
        }
        Map<String, Object> result = runtimeMap(status.get("result"),
                "cancellation result");`]] },
  // Broker lets a Runtime Session release while an execution is still active.
  J2: { kind: 'broker', file: `${RB}/RuntimeBrokerService.java`, marker: 'RIG_MUTANT_J2', edits: [[
    `            if (context.hasActiveControl()
                    || executionRepository.hasActiveByRuntimeSession(`,
    `            if (context.hasActiveControl()
                    || "RIG_MUTANT_J2".isEmpty() && executionRepository.hasActiveByRuntimeSession(`]] },
  // Broker cancels a never-started reservation through the Runtime anyway.
  J3: { kind: 'broker', file: `${RB}/RuntimeBrokerService.java`, marker: 'RIG_MUTANT_J3', edits: [[
    `                            requested = requestCancel(current);`,
    `                            requested = requestCancel(current);
                            if (current.getState() == ToolExecutionRecord.State.PREPARED
                                    && requested.isTerminal()) {
                                System.err.println("RIG_MUTANT_J3");
                                transport.cancel(context.lease(), context.session(),
                                        requested.getReference());
                            }`]] },
};
M['T3+J2'] = { kind: 'ts+broker', parts: ['T3', 'J2'] };
const [action, name, wt = action === 'check' ? 'wt-pr' : 'wt-mut'] = process.argv.slice(2);
const names = name === 'all' ? Object.keys(M).filter((k) => !M[k].parts) : [name];
for (const n of names) {
  const m = M[n];
  if (!m) throw new Error(`unknown mutant ${n}`);
  const parts = m.parts ?? [n];
  for (const p of parts) {
    const pm = M[p];
    const file = path.join(SP, wt, pm.file);
    const backup = `${SP}/rig/orig/${pm.file.replaceAll('/', '__')}`;
    if (action === 'restore') {
      fs.writeFileSync(file, fs.readFileSync(backup));
      continue;
    }
    let s = action === 'apply' ? fs.readFileSync(fs.existsSync(backup) ? backup : file, 'utf8') : fs.readFileSync(file, 'utf8');
    if (action === 'apply' && !fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, s);
    }
    if (action === 'apply' && parts.length > 1 && p !== parts[0] && pm.file === M[parts[0]].file)
      s = fs.readFileSync(file, 'utf8');
    for (const [a, b] of pm.edits) {
      const c = s.split(a).length - 1;
      if (c !== 1) throw new Error(`${p}: expected 1 match in ${pm.file}, got ${c}`);
      s = s.replace(a, b);
    }
    if (action === 'apply') fs.writeFileSync(file, s);
    else console.log(`${p} ok (${pm.kind}, ${pm.file})`);
  }
  if (action === 'apply') console.log(`${m.kind} ${parts.map((p) => M[p].marker).join(',')}`);
}
