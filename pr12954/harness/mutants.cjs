// usage: node mutants.cjs <apply|restore|list> <name> [worktree]
const fs = require('fs');
const path = require('path');
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad';
const SESSION = 'packages/cli/src/serve/hosted-harness-session.ts';
const EXEC = 'packages/cli/src/serve/managed-runtime-tool-executor.ts';
const TURN = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const STORE = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedSessionStore.java';
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const GUARD = "if (restore.recoveryStatus !== 'ok' || hasUnsettledInput(session)) {";
const DRIVER = 'integration-tests/helpers/hosted-shell-output-driver.ts';
const M = {
  // H2 with the driver made blind to Broker release, so only the Java SQL oracle can see it
  H2B: { kind: 'ts', file: TURN, why: 'H2 + driver release assertion removed (Java oracle only)', edits: [[
    'await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));',
    "await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));\n      if (process.env['RIG_MUTANT_H2B'] === undefined) await this.broker.release().catch(() => undefined);"]],
    also: { file: DRIVER, edits: [["assert.notEqual(operation, 'release');", "// RIG blind: release allowed"]] } },
  // --- author's two, re-run per case as calibration ---
  A1: { kind: 'ts', file: SESSION, why: 'cold load ignores unsettled input (hasUnsettledInput half)', edits: [[GUARD,
    "if (restore.recoveryStatus !== 'ok' || (process.env['RIG_MUTANT_A1'] === undefined ? false : hasUnsettledInput(session))) {"]] },
  A2: { kind: 'ts', file: EXEC, why: 'worker: capture-acceptance failure settles instead of UNKNOWN', edits: [[
    `      } catch {
        entry.state = 'unknown';`,
    `      } catch {
        entry.state = process.env['RIG_MUTANT_A2'] === undefined ? 'settled' : 'unknown';`]] },
  // --- mine ---
  T3: { kind: 'ts', file: SESSION, why: 'cold load ignores restore.recoveryStatus (other half)', edits: [[GUARD,
    "if ((process.env['RIG_MUTANT_T3'] === undefined ? false : restore.recoveryStatus !== 'ok') || hasUnsettledInput(session)) {"]] },
  A1T3: { kind: 'ts', file: SESSION, why: 'cold load guard removed entirely', edits: [[GUARD,
    "if (process.env['RIG_MUTANT_A1T3'] !== undefined) {"]] },
  H1: { kind: 'ts', file: SESSION, why: 'Harness settles a recovery-required tool turn as an ordinary error turn', edits: [[
    'if (cause instanceof HostedToolRecoveryRequiredError) throw cause;',
    "if (cause instanceof HostedToolRecoveryRequiredError && process.env['RIG_MUTANT_H1'] !== undefined) throw cause;"]] },
  H2: { kind: 'ts', file: TURN, why: 'Harness releases Workspace ownership after an unknown execution', edits: [[
    'await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));',
    "await Promise.allSettled(reserved.map((id) => this.broker.cancel(id)));\n      if (process.env['RIG_MUTANT_H2'] === undefined) await this.broker.release().catch(() => undefined);"]] },
  S1: { kind: 'store', file: STORE, why: 'Store commit keeps staged resources when the journal insert fails (non-atomic receipt tx)', edits: [[
    `    @Transactional
    public CommitReceipt commit(String tenantId, String sessionId,`,
    `    @Transactional(noRollbackFor = RuntimeException.class) // RIG_MUTANT_S1
    public CommitReceipt commit(String tenantId, String sessionId,`]] },
  B1: { kind: 'broker', file: BROKER, why: 'Broker settles a lost worker dispatch with a synthetic error instead of UNKNOWN', edits: [[
    `                    if (error != null || result == null) {
                        markUnknown(executing.getExecutionCallId(),
                                executing.getDispatchGeneration());
                        return null;
                    }`,
    `                    if (error != null || result == null) {
                        try {
                            settleExecution(executing.getExecutionCallId(),
                                    executing.getDispatchGeneration(),
                                    Map.of("executionStatus", "error", "responseParts", java.util.List.of(),
                                            "error", Map.of("message", "RIG_MUTANT_B1 worker lost")));
                        } catch (RuntimeException exception) {
                            markUnknown(executing.getExecutionCallId(),
                                    executing.getDispatchGeneration());
                        }
                        return null;
                    }`]] },
};
const [cmd, name, wt = 'wt-mut'] = process.argv.slice(2);
if (cmd === 'list') { for (const [k, v] of Object.entries(M)) console.log(k, v.kind, v.why); process.exit(0); }
const m = M[name];
if (!m) { console.error('unknown mutant', name); process.exit(2); }
const file = path.join(SP, wt, m.file);
const orig = path.join(SP, 'orig', wt + '-' + name + '.orig');
fs.mkdirSync(path.join(SP, 'orig'), { recursive: true });
if (cmd === 'apply') {
  let src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(orig, src);
  for (const [a, b] of m.edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) { console.error(name, 'anchor count', n, JSON.stringify(a.slice(0, 80))); process.exit(3); }
    src = src.replace(a, () => b);
  }
  fs.writeFileSync(file, src);
  if (m.also) { const af = path.join(SP, wt, m.also.file); let a = fs.readFileSync(af, 'utf8'); fs.writeFileSync(orig + '.also', a); for (const [x, y] of m.also.edits) { if (a.split(x).length !== 2) { console.error('also anchor'); process.exit(3); } a = a.replace(x, () => y); } fs.writeFileSync(af, a); }
  console.log('applied', name, m.kind, m.file);
} else if (cmd === 'restore') {
  fs.writeFileSync(file, fs.readFileSync(orig));
  if (m.also) fs.writeFileSync(path.join(SP, wt, m.also.file), fs.readFileSync(orig + '.also'));
  console.log('restored', name);
} else if (cmd === 'kind') {
  console.log(m.kind);
}
