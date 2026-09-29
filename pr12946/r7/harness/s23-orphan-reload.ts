// S23 (round 7): a Harness exits while an MCP Session is attached (no detach). The lease has no TTL.
// Does loading that Session in a new Harness and detaching release the Workspace?
import { createHash } from 'node:crypto';
import { Harness, leaseHeld, mcpProfile, result, rig, setScript, sql, startBrokerProxy, startModel } from './rig12946-lib.js';
const W = Number(process.env['S23_WS'] ?? 7);
const model = await startModel(); const proxy = await startBrokerProxy(); const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { W, leaseBefore: await leaseHeld(W) };
try {
  const key = createHash('sha256').update(`${rig.tenantId}\u0000storage-${W}`).digest('hex');
  const lease = (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE storage_key = ?', [key]))[0];
  const owner = (await sql('SELECT harness_session_id, session_state FROM qwen_runtime_session WHERE runtime_session_id = ?', [lease?.['runtime_session_id']]))[0];
  out['orphanSession'] = owner?.['harness_session_id']; out['runtimeState'] = owner?.['session_state'];
  const sid = String(owner?.['harness_session_id']);
  const l = await h.open(sid, `workspace-${W}`, mcpProfile(W, [['remote']]), 'load');
  out['load'] = { status: l.status, body: l.status === 200 ? undefined : l.json };
  if (l.status === 200) {
    const r = await h.prompt(sid, 'TEXT_AFTER_RELOAD', { timeout: 60_000 });
    out['promptAfterReload'] = { admit: r.admit.status, terminal: r.terminal?.map((x: any) => x.stopReason ?? x.type) };
    out['detach'] = (await h.call(sid, `/session/${sid}/detach`, {})).status;
  }
  out['leaseAfter'] = await leaseHeld(W);
} finally { result('s23', out); await h.close(); await model.close(); await proxy.close(); }
