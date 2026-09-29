// S9: the author's recovery claims, independently.
// (a) dropped mcp-configure reply, (b) dropped mcp-invoke reply for a
// resource read, (c) Workspace can_read revoked then close, (d) replay of a
// committed operation after reload while the Broker is down.
import {
  Harness, brokerCalls, effects, faults, mcpProfile, newSession, randomUUID,
  result, say, setBrokerDown, sql, sqlUpdate, startBrokerProxy, startModel,
  leaseHeld,
} from './rig12946-lib.js';

const W = Number(process.env['S9_WS'] ?? 11);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
const kinds = (from: number) => brokerCalls.slice(from).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}${c.fault ? `!${c.fault}` : ''}`);
try {
  const s = await newSession(W);
  const profile = mcpProfile(W, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  // (a) first configure reply lost
  faults.push({ label: 'drop-configure', action: 'drop-response', remaining: 1, match: (_u, b) => b.includes('"mcp-configure"') });
  const opId = randomUUID();
  let k = brokerCalls.length;
  const e0 = effects().length;
  // (b) invoke reply lost as well
  faults.push({ label: 'drop-invoke', action: 'drop-response', remaining: 1, match: (_u, b) => b.includes('"mcp-invoke"') });
  const r = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: opId, serverId: 'remote', request: { kind: 'resource_read', uri: 'mem://text' } });
  out['opWithTwoLostReplies'] = { status: r.status, state: r.json?.state, text: r.json?.response?.contents?.[0]?.text, broker: kinds(k), physicalEffects: effects().length - e0,
    configures: effects().length };
  // (c) revoke read access, then close
  await sqlUpdate('UPDATE managed_workspace_access SET can_read = FALSE WHERE tenant_id = ? AND workspace_id = ?', ['t-rig', s.workspaceId]);
  k = brokerCalls.length;
  const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['closeAfterRevoke'] = { status: d.status, broker: brokerCalls.slice(k).map((c) => `${c.url.split('/').pop()?.replace(/[0-9a-f-]{36}/g, '<id>').slice(0, 40)} ${c.kind ?? ''} ${c.status}`) };
  out['leaseAfterRevokeClose'] = await leaseHeld(W);
  // New work after revocation must be refused.
  const reopened = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['reloadAfterRevoke'] = reopened.status;
  if (reopened.status === 200) {
    k = brokerCalls.length;
    const fresh = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: randomUUID(), serverId: 'remote', request: { kind: 'resource_read', uri: 'mem://text' } });
    out['newOpAfterRevoke'] = { status: fresh.status, body: fresh.json, broker: brokerCalls.slice(k).map((c) => `${c.url.split('/').pop()?.slice(0, 30)} ${c.kind ?? ''} ${c.status}`) };
    // (d) Broker down: the committed result must replay without the Broker.
    setBrokerDown(true);
    k = brokerCalls.length;
    const e1 = effects().length;
    const replay = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: opId, serverId: 'remote', request: { kind: 'resource_read', uri: 'mem://text' } });
    const status = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${opId}`);
    const close = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    out['replayWithBrokerDown'] = { replay: replay.status, text: replay.json?.response?.contents?.[0]?.text, status: status.json?.state, close: close.status, brokerRequests: brokerCalls.length - k, effects: effects().length - e1 };
    setBrokerDown(false);
    if (close.status !== 204) out['closeRetry'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  }
  await sqlUpdate('UPDATE managed_workspace_access SET can_read = TRUE WHERE tenant_id = ? AND workspace_id = ?', ['t-rig', s.workspaceId]);
} finally {
  result('s9', out);
  await h.close();
  await model.close();
  await proxy.close();
}
