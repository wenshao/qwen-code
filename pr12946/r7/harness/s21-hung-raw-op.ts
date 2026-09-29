// S21 (round 7): while a raw resource read is hung, which Session routes still answer? (status/cancel are now mcpBusy-fenced)
import { Harness, delay, mcpProfile, newSession, randomUUID, result, setScript, startBrokerProxy, startModel } from './rig12946-lib.js';
const W = Number(process.env['S21_WS'] ?? 14);
const model = await startModel(); const proxy = await startBrokerProxy(); const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = {}; const t0 = Date.now(); const at = () => ((Date.now() - t0) / 1000).toFixed(1);
try {
  const s = await newSession(W); await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['plain']]));
  out['warm'] = (await h.prompt(s.sessionId, 'TEXT_0')).terminal?.map((x: any) => x.stopReason);
  const op = randomUUID();
  const pending = h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: op, serverId: 'plain', request: { kind: 'resource_read', uri: 'mem://slow' } }, 'POST', 700_000);
  pending.then((r) => { out['opReturned'] = { status: r.status, state: r.json?.state, at: at() }; });
  const probe = async (label: string) => {
    const st = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${op}`);
    const cancel = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${op}/cancel`, {});
    const status = await h.call(s.sessionId, `/session/${s.sessionId}/status`);
    const pr = await h.prompt(s.sessionId, `TEXT_${label}`, { wait: false });
    const det = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    out[label] = { at: at(), opStatus: `${st.status}:${st.json?.code ?? st.json?.state}`, cancel: `${cancel.status}:${cancel.json?.code ?? cancel.json?.state}`, sessionStatus: status.status, prompt: `${pr.admit.status}:${pr.admit.json?.code ?? ''}`, detach: `${det.status}:${det.json?.code ?? ''}` };
  };
  await delay(3000); await probe('t3s');
  await delay(57000); await probe('t60s');
} finally { result('s21', out); await h.close(); await model.close(); await proxy.close(); }
