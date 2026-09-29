// usage: node mutants.cjs <apply|restore|kind|list|why> <name> [worktree]
// Each mutant is an exact-text edit that must match exactly once; the original file is
// saved next to the mutant clone's rig backup and restored byte for byte.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SP = '<rig>';
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const RECORD = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/ToolExecutionRecord.java';
const WTRANS = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/service/WorkspaceRuntimeTransport.java';
const WORKER = 'packages/cli/src/serve/managed-runtime-provider-worker.ts';

const DEACT = 'return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false);';
const M = {
  // ---- Broker (runtime-broker jar) ----
  J1: { kind: 'broker', file: BROKER, why: 'terminal same-key receipt skips reference equality', edits: [[
    'if (!BrokerValues.sameJsonMap(receipt.getReference(),',
    'if (false /* RIG_MUTANT_J1 */ && !BrokerValues.sameJsonMap(receipt.getReference(),']] },
  J2: { kind: 'broker', file: RECORD, why: 'sameRequest ignores the saved reference (non-terminal same key)', edits: [[
    '                && requestDigest.equals(other.requestDigest)\n                && BrokerValues.sameJsonMap(reference, other.reference);\n    }\n\n    private ToolExecutionRecord copy(',
    '                && requestDigest.equals(other.requestDigest)\n                && (true /* RIG_MUTANT_J2 */ || BrokerValues.sameJsonMap(reference, other.reference));\n    }\n\n    private ToolExecutionRecord copy(']] },
  J3: { kind: 'broker', file: BROKER, why: 'raw start (payloadJson) no longer requires a deferred reservation', edits: [[
    'if (!"deferred".equals(record.getReference().get("dispatchMode"))) {',
    'if (false /* RIG_MUTANT_J3 */ && !"deferred".equals(record.getReference().get("dispatchMode"))) {']] },
  J4: { kind: 'broker', file: BROKER, why: 'provider start (no payload) no longer requires a provider reference', edits: [[
    'if (!ProviderRuntimeProtocol.isReference(record.getReference())) {',
    'if (false /* RIG_MUTANT_J4 */ && !ProviderRuntimeProtocol.isReference(record.getReference())) {']] },
  J5: { kind: 'broker', file: BROKER, why: 'failed transport release stays cached (retry replays the failure)', edits: [[
    `                    if (error != null) {
                        context.release(null);
                        result.completeExceptionally(unwrap(error));`,
    `                    if (error != null) {
                        /* RIG_MUTANT_J5 */
                        result.completeExceptionally(unwrap(error));`]] },
  J6: { kind: 'broker', file: BROKER, why: 'all terminal-record dispatch guards removed (a settled execution can be dispatched again)', edits: [[
    '        return !record.isTerminal()\n                && record.getState() != ToolExecutionRecord.State.UNKNOWN;',
    '        return /* RIG_MUTANT_J6 */ record.getState() != ToolExecutionRecord.State.UNKNOWN;']],
    extra: [{ file: 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/JdbcToolExecutionRepository.java', edits: [[
    'public ToolExecutionRecord claimDispatch(String executionCallId,\n            String owner, Duration leaseDuration) {\n        String id = BrokerValues.requireId(executionCallId,\n                "executionCallId");\n        String ownerId = BrokerValues.requireId(owner, "owner");\n        Duration duration = JdbcRepositorySupport.requireDuration(\n                leaseDuration);\n        return JdbcRepositorySupport.transaction(dataSource, connection -> {\n            ToolExecutionRecord current = selectByExecutionId(connection, id,\n                    true);\n            if (current == null || current.isTerminal()',
    'public ToolExecutionRecord claimDispatch(String executionCallId,\n            String owner, Duration leaseDuration) {\n        String id = BrokerValues.requireId(executionCallId,\n                "executionCallId");\n        String ownerId = BrokerValues.requireId(owner, "owner");\n        Duration duration = JdbcRepositorySupport.requireDuration(\n                leaseDuration);\n        return JdbcRepositorySupport.transaction(dataSource, connection -> {\n            ToolExecutionRecord current = selectByExecutionId(connection, id,\n                    true);\n            if (current == null /* RIG_MUTANT_J6 */']] }] },
  // ---- Workspace transport (managed-agent-server, compiled by the IT run) ----
  W1: { kind: 'server', file: WTRANS, why: 'deactivate the Workspace gate before the worker closes admission', edits: [[
    `        return delegate.release(lease, session).thenCompose(released -> {
            if (!Boolean.TRUE.equals(released)) {
                throw WorkspaceExecutionStore.unavailable();
            }
            ${DEACT}
        })`,
    `        return delegate.activateWorkspace(context.runtime(), context.session(), context.binding(), false) /* RIG_MUTANT_W1 */
                .thenCompose(ignored -> delegate.release(lease, session)).thenCompose(released -> {
            if (!Boolean.TRUE.equals(released)) {
                throw WorkspaceExecutionStore.unavailable();
            }
            return CompletableFuture.<Void>completedFuture(null);
        })`]] },
  W2: { kind: 'server', file: WTRANS, why: 'release storage ownership before the worker closes admission', edits: [[
    `        Context context = context(lease, session, false);
        return delegate.release(lease, session).thenCompose(`,
    `        Context context = context(lease, session, false);
        ownership.release(context.binding(), context.session()); /* RIG_MUTANT_W2 */
        return delegate.release(lease, session).thenCompose(`]] },
  W3: { kind: 'server', file: WTRANS, why: 'release storage ownership after closure but before deactivation', edits: [[
    `            ${DEACT}
        })
                .thenApply(ignored -> {
                    ownership.release(context.binding(), context.session());
                    return true;`,
    `            ownership.release(context.binding(), context.session()); /* RIG_MUTANT_W3 */
            ${DEACT}
        })
                .thenApply(ignored -> {
                    return true;`]] },
  W4: { kind: 'server', file: WTRANS, why: 'skip Workspace deactivation on release', edits: [[
    `            ${DEACT}
        })
                .thenApply(`,
    `            return CompletableFuture.<Void>completedFuture(null); /* RIG_MUTANT_W4 */
        })
                .thenApply(`]] },
  W5: { kind: 'server', file: WTRANS, why: 'release retry skips the worker close once a close was sent', edits: [
    ['    private final HttpRuntimeTransport delegate;',
     '    private final HttpRuntimeTransport delegate;\n    private static final java.util.Set<String> RIG_W5_SENT = java.util.concurrent.ConcurrentHashMap.newKeySet(); // RIG_MUTANT_W5'],
    ['        Context context = context(lease, session, false);\n        return delegate.release(lease, session).thenCompose(',
     '        Context context = context(lease, session, false);\n        boolean rigRetry = !RIG_W5_SENT.add(session.getRuntimeSessionId());\n        return (rigRetry ? CompletableFuture.completedFuture(Boolean.TRUE) : delegate.release(lease, session)).thenCompose(']] },
  // ---- Worker (bundled dist/cli.js) ----
  T1: { kind: 'ts', file: WORKER, why: 'worker admits acquire after release', edits: [[
    "if (this.closing || session?.closed || session?.release)\n        conflict('Managed Runtime Session is closed.');",
    "if (this.closing /* RIG_MUTANT_T1 */)\n        conflict('Managed Runtime Session is closed.');"]] },
  T2: { kind: 'ts', file: WORKER, why: 'worker retains no released Session (terminal evidence forgotten at release)', edits: [[
    'const RETAINED_RELEASED_SESSIONS = 8;',
    'const RETAINED_RELEASED_SESSIONS = 0; // RIG_MUTANT_T2']] },
  T3: { kind: 'ts', file: WORKER, why: 'worker refuses a repeated release of a closed Session', edits: [[
    'if (session?.closed) return true;',
    "if (session?.closed) conflict('RIG_MUTANT_T3 repeated release');"]] },
};

const [cmd, name, wt = 'wt-mut'] = process.argv.slice(2);
if (cmd === 'list') { console.log(Object.keys(M).join(' ')); process.exit(0); }
const m = M[name];
if (!m) { console.error('unknown mutant ' + name); process.exit(2); }
if (cmd === 'kind') { console.log(m.kind); process.exit(0); }
if (cmd === 'why') { console.log(m.why); process.exit(0); }
const targets = [{ file: m.file, edits: m.edits }, ...(m.extra || [])];
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const backupOf = (f) => path.join(SP, 'rig', 'orig', wt, f.replaceAll('/', '__'));
if (cmd === 'apply') {
  const staged = [];
  for (const t of targets) {
    const file = path.join(SP, wt, t.file);
    const backup = backupOf(t.file);
    if (fs.existsSync(backup)) { console.error('backup exists; restore first: ' + backup); process.exit(2); }
    let text = fs.readFileSync(file, 'utf8');
    for (const [from, to] of t.edits) {
      const count = text.split(from).length - 1;
      if (count !== 1) { console.error(name + ': expected 1 match, found ' + count + ' in ' + t.file); process.exit(2); }
      text = text.replace(from, () => to);
    }
    staged.push([file, backup, text]);
  }
  for (const [file, backup, text] of staged) {
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    const original = fs.readFileSync(file);
    fs.writeFileSync(backup, original);
    fs.writeFileSync(file, text);
    console.log('applied ' + name + ' ' + path.basename(file) + ' ' + hash(original).slice(0, 12) + ' -> ' + hash(Buffer.from(text)).slice(0, 12));
  }
} else if (cmd === 'restore') {
  for (const t of targets) {
    const file = path.join(SP, wt, t.file);
    const backup = backupOf(t.file);
    if (!fs.existsSync(backup)) { console.error('no backup for ' + name + ' ' + t.file); process.exit(2); }
    fs.writeFileSync(file, fs.readFileSync(backup));
    fs.rmSync(backup);
    console.log('restored ' + name + ' ' + path.basename(file) + ' ' + hash(fs.readFileSync(file)).slice(0, 12));
  }
} else { console.error('bad command'); process.exit(2); }
