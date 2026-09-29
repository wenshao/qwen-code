// S18 (round 5): qqqys R1-1 — the operation grant lease is 300 s; does an MCP tool call that runs 310 s still settle?
import { Harness, effects, fakeToolCall, ledger, mcpProfile, newSession, randomUUID, result, setScript, sql, startBrokerProxy, startModel } from './rig12946-lib.js';
const W = Number(process.env['S18_WS'] ?? 2);
const MS = Number(process.env['S18_MS'] ?? 310_000);
const model = await startModel(); const proxy = await startBrokerProxy(); const h = await new Harness().start(model.baseUrl, proxy.url);
const tag = `long-${randomUUID().slice(0, 6)}`; const out: Record<string, unknown> = { ms: MS, tag }; const t0 = Date.now();
try {
  setScript((ctx) => {
    if (ctx.marker === 'LONG') { if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('on server http,'))!.name, { ms: MS, tag }, 'l')] }; out['receipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(-70); return { content: 'LONG_DONE' }; }
    if (ctx.marker === 'NEXT') { if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(ctx.tools.find((t) => t.description?.includes('side effect on server http.'))!.name, { tag: `${tag}-next` }, 'n')] }; return { content: 'NEXT_DONE' }; }
    return { content: 'TEXT' };
  });
  const s = await newSession(W); await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote']]));
  const r = await h.prompt(s.sessionId, 'LONG', { timeout: 700_000 });
  out['turn'] = { terminal: r.terminal, blocked: r.status?.recoveryBlocked, at: ((Date.now() - t0) / 1000).toFixed(1) };
  out['serverLedger'] = ledger().filter((e) => e['tag'] === tag).map((e) => `${e['phase']}@${((Number(e['t']) - t0) / 1000).toFixed(1)}`);
  out['execution'] = await sql('SELECT execution_state, execution_status FROM qwen_tool_execution WHERE harness_session_id = ?', [s.sessionId]);
  const e0 = effects().length; const n = await h.prompt(s.sessionId, 'NEXT', { timeout: 60_000 });
  out['next'] = { admit: n.admit.status, terminal: n.terminal, effects: effects().length - e0 };
  out['detach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})).status;
} finally { result('s18', out); await h.close(); await model.close(); await proxy.close(); }
