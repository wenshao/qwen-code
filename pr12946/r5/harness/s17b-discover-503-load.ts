// S17b: after a 503 on the discover refresh blocks the Session, why is load refused, and does it stay refused?
import { Harness, faults, fakeToolCall, mcpProfile, newSession, result, setScript, startBrokerProxy, startModel, delay, sql } from './rig12946-lib.js';
const model = await startModel(); const proxy = await startBrokerProxy(); const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('EFFECT')) { if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: ctx.marker }, 'e')] }; return { content: 'DONE' }; }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  const W = 7; const s = await newSession(W); const profile = mcpProfile(W, [['remote']]);
  await h.open(s.sessionId, s.workspaceId, profile);
  out['warm'] = (await h.prompt(s.sessionId, 'EFFECT_1')).terminal;
  faults.push({ label: 'discover-503', action: '503', remaining: 1, match: (_u, b) => b.includes('"mcp-discover"') });
  const f = await h.prompt(s.sessionId, 'TEXT_1');
  out['faulted'] = { terminal: f.terminal, blocked: f.status?.recoveryBlocked };
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
  const l1 = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['load1'] = { status: l1.status, body: l1.json };
  await delay(60_000);
  const l2 = await h.open(s.sessionId, s.workspaceId, profile, 'load');
  out['load2_after60s'] = { status: l2.status, body: l2.json };
  out['mcpRecords'] = (await sql("SELECT domain, CAST(r.inline_bytes AS CHAR) AS body FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r ON r.session_scope_key = e.session_scope_key AND r.resource_id = e.record_resource_id WHERE e.session_id = ?", [s.sessionId])).map((x) => { const b = JSON.parse(x['body']!); const r = b.record ?? b; return `${x['domain']}:${r.run.state}/${r.run.execution}/${r.releaseState ?? ''}`; });
  out['lease'] = (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE runtime_session_id LIKE ?', [`mcp:${s.sessionId}%`])).length;
} finally { result('s17b', out); await h.close(); await model.close(); await proxy.close(); }
