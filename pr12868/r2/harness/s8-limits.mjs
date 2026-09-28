// PR #12868: the 1 MiB control bound in practice — write_file of growing size
// through prepare / confirmation / confirm / preflight / start (boot v1).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOTS, BROKER_URL, BROKER_TOKEN, ARM, attempt, broker, createSession, executions, ledger, ledgerMark,
  loadProvider, openLog, prepareRequest, runtimeSession, say,
} from './lib.mjs';

openLog(`s8-limits-${ARM}`);
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const harness = await createSession();
const cwd = fs.realpathSync(path.join(ROOTS, 'plain'));
const REF = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const show = (a) => (a.ok ? 'ok' : `${a.status ?? '-'} ${a.code ?? a.name}${a.status ? '' : `: ${a.message.slice(0, 70)}`}`);
for (const kib of [64, 200, 255, 256, 900, 1100]) {
  const runtimeSessionId = randomUUID();
  const request = prepareRequest(runtimeSessionId, 'bootstrap', cwd);
  const client = await provider.getToolV2Client(request, { harnessSessionId: harness });
  await client.fileHistory.bind({ ownerSessionId: harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: cwd, snapshots: [] });
  const manifest = await client.manifest();
  const identity = { sessionId: runtimeSessionId, promptId: `p-${kib}`, callId: `c-${kib}`, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision };
  await client.beginTurn({ ...identity, callId: 'turn' });
  const file = path.join(cwd, `limit-${kib}-${runtimeSessionId.slice(0, 6)}.txt`);
  const content = 'x'.repeat(kib * 1024);
  const mark = ledgerMark();
  const prepared = await attempt(() => client.prepare(identity, 'write_file', { file_path: file, content }));
  let line = `${String(kib).padStart(5)} KiB  prepare=${show(prepared)}`;
  if (prepared.ok) {
    const reference = Object.fromEntries(REF.map((k) => [k, prepared.value[k]]));
    const confirmation = await attempt(() => client.confirmation(reference));
    const confirm = await attempt(() => client.confirm(reference, 'proceed_once'));
    const preflight = await attempt(() => client.preflight(reference));
    const reserved = await attempt(() => client.prepareExecution(reference));
    const started = reserved.ok && preflight.ok ? await attempt(() => client.startExecution(reference, reserved.value.executionCallId)) : { ok: false, code: 'skipped', name: 'skipped', message: '' };
    line += ` confirmation=${show(confirmation)} confirm=${show(confirm)} preflight=${show(preflight)} reserve=${show(reserved)} start=${started.ok ? started.value.executionStatus : show(started)}`;
    if (reserved.ok && !started.ok) await attempt(() => client.cancel(reference));
  }
  const sizes = ledger(mark).filter((e) => e.kind && e.kind !== 'acquire').map((e) => `${e.kind}:${Math.round(e.requestBytes / 1024)}→${e.status === 200 ? `${Math.round((e.responseBytes ?? 0) / 1024)}K` : `${e.status} ${e.response?.code ?? ''}`}`);
  line += ` | written=${fs.existsSync(file) ? `${Math.round(fs.statSync(file).size / 1024)} KiB` : 'no'}`;
  say('limit', line);
  say('wire ', `      worker req KiB→resp: ${sizes.join('  ')}`);
  const released = await attempt(() => provider.release(runtimeSessionId, request, { terminal: true }));
  say('state', `      release=${show(released)} session=${runtimeSession(runtimeSessionId)?.state} rows=${JSON.stringify(executions(runtimeSessionId).map((r) => `${r.state}/${r.status}`))}`);
}
provider.dispose();
