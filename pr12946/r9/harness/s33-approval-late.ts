// S33 (round 9): approval of an MCP tool call arriving after the MCP grant
// lease (300 s) has passed. The author: "renews only the grant before
// preparation, retaining the original approved arguments and pins".
//   S33_DELAY_S  seconds between the approval request and the answer
import {
  Harness, brokerCalls, delay, effects, fakeToolCall, leaseHeld, mcpProfile,
  newSession, result, setScript, sql, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S33_WS'] ?? 0);
const DELAY_S = Number(process.env['S33_DELAY_S'] ?? 310);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { W, delayS: DELAY_S, arm: process.env['ARM'] };
const code = (r: { status: number; json: any }) => `${r.status}:${r.json?.code ?? r.json?.state ?? ''}`;
const tag = `appr-${DELAY_S}-${Date.now() % 100000}`;
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('MCP')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag }, 'e')] };
      out['receipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(-90);
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  const opened = await h.open(s.sessionId, s.workspaceId, { ...mcpProfile(W, [['remote']]), approvalMode: 'default', approvalTimeoutMs: 900_000 });
  out['open'] = { status: opened.status, body: opened.status === 200 ? undefined : opened.json };
  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  const k = brokerCalls.length;
  const turn = await h.prompt(s.sessionId, 'MCP_APPROVAL', { wait: false });
  out['admit'] = turn.admit.status;
  let request: any;
  while (!request && Date.now() - t0 < 60_000) {
    const rows = await sql("SELECT CAST(inline_bytes AS CHAR) AS body FROM qwen_managed_session_resource WHERE session_id = ? AND kind = 'managed-action-options'", [s.sessionId]);
    if (rows.length) request = JSON.parse(String(rows[0]!['body']));
    else await delay(500);
  }
  out['requested'] = request ? { at: at(), toolName: String(request.toolName).slice(0, 12), options: request.options?.map((o: any) => o.id) } : 'no approval requested within 60 s';
  if (request) {
    out['effectsWhileWaiting'] = effects((e) => e['tag'] === tag).length;
    await delay(DELAY_S * 1000 - (Date.now() - t0));
    out['effectsBeforeAnswer'] = effects((e) => e['tag'] === tag).length;
    const r = await h.call(s.sessionId, `/session/${s.sessionId}/actions/${request.requestId}/resolve`,
      { optionId: 'allow', inputRevision: request.inputRevision, policyRevision: request.policyRevision });
    out['resolve'] = `${code(r)}@${at()}`;
  }
  let st: any;
  while (Date.now() - t0 < DELAY_S * 1000 + 120_000) {
    st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    if (!st?.hasActivePrompt) break;
    await delay(500);
  }
  out['turnEndedAt'] = at();
  out['terminal'] = (await h.outcome(s.sessionId, turn.promptId).catch(() => ({ terminal: 'outcome-error' }))).terminal;
  out['status'] = st;
  out['effects'] = effects((e) => e['tag'] === tag).length;
  out['brokerKinds'] = [...new Set(brokerCalls.slice(k).filter((c) => c.kind).map((c) => `${c.kind}:${c.status}`))];
  out['brokerErrors'] = brokerCalls.slice(k).filter((c) => c.status >= 400).map((c) => `${c.kind ?? c.url.split('/').pop()}:${c.status} ${(c.response ?? '').slice(0, 120)}`);
  out['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
  out['lease'] = await leaseHeld(W);
} finally {
  result(`s33-${DELAY_S}s`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
