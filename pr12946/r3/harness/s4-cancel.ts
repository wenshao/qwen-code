// S4/S5/S6: cancellation and timeout against a standard SDK server (which,
// per the MCP spec, never answers a request it was told to cancel).
//   S4_MODE=op      cancel a running resource read through the MCP route
//   S4_MODE=prompt  cancel a prompt while an MCP tool call is running
//   S4_MODE=timeout let one MCP tool run 32 s (> the 25 s Runtime timeout)
import {
  Harness, delay, effects, fakeToolCall, ledger, mcpProfile, newSession,
  randomUUID, result, say, setScript, sql, startBrokerProxy, startModel,
  toolFor, waitUntil, brokerCalls,
} from './rig12946-lib.js';

const MODE = process.env['S4_MODE'] ?? 'op';
const W = Number(process.env['S4_WS'] ?? 3);
const SERVER = process.env['S4_SERVER'] ?? 'remote'; // remote | local | legacy
const NEEDLE = { remote: 'server http.', local: `server stdio-${W}.`, legacy: 'server sse.', short: 'server http2.' }[SERVER]!;
const SLOW_NEEDLE = { remote: 'on server http,', local: `on server stdio-${W},`, legacy: 'on server sse,', short: 'on server http2,' }[SERVER]!;
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { mode: MODE, server: SERVER };
const tag = `${MODE}-${randomUUID().slice(0, 8)}`;
const phases = () => ledger().filter((e) => e['tag'] === tag || (e['uri'] === 'mem://slow' && Number(e['t']) > t0)).map((e) => `${e['phase'] ?? e['name']}@${((Number(e['t']) - t0) / 1000).toFixed(1)}`);
const t0 = Date.now();
try {
  setScript((ctx) => {
    if (ctx.marker === 'SLOW') {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, SLOW_NEEDLE), { ms: MODE === 'timeout' ? 32_000 : 10_000, tag }, 's1')] };
      out['slowReceipt'] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 200);
      return { content: 'SLOW_DONE' };
    }
    if (ctx.marker === 'NEXT') {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, NEEDLE), { tag: `${tag}-next` }, 'n1')] };
      return { content: 'NEXT_DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, [[SERVER]]);
  await h.open(s.sessionId, s.workspaceId, profile);
  if (MODE === 'op') {
    const opId = randomUUID();
    const pending = h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`, { operationId: opId, serverId: SERVER, request: { kind: 'resource_read', uri: 'mem://slow' } });
    await waitUntil(() => ledger().some((e) => e['uri'] === 'mem://slow' && e['phase'] === 'start' && Number(e['t']) > t0), 20_000);
    await delay(1000);
    const cancel = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${opId}/cancel`, {});
    out['cancelResponse'] = { status: cancel.status, body: cancel.json, at: ((Date.now() - t0) / 1000).toFixed(1) };
    const first = await pending;
    out['operationPostResponse'] = { status: first.status, body: first.json, at: ((Date.now() - t0) / 1000).toFixed(1) };
    await delay(12_000);
    const st = await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations/${opId}`);
    out['statusAt+12s'] = { status: st.status, body: st.json };
    out['opId'] = opId;
  } else {
    const run = h.prompt(s.sessionId, 'SLOW', { timeout: 120_000 });
    if (MODE === 'prompt') {
      await waitUntil(() => ledger().some((e) => e['tag'] === tag && e['phase'] === 'start'), 20_000);
      await delay(1000);
      const c = await h.call(s.sessionId, `/session/${s.sessionId}/cancel`, {});
      out['promptCancel'] = { status: c.status, at: ((Date.now() - t0) / 1000).toFixed(1) };
    }
    const r = await run;
    out['slowTurn'] = { terminal: r.terminal, status: r.status, at: ((Date.now() - t0) / 1000).toFixed(1) };
    await delay(MODE === 'timeout' ? 12_000 : 12_000);
  }
  out['serverPhases'] = phases();
  out['sessionStatus'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  const next = await h.prompt(s.sessionId, 'NEXT', { timeout: 60_000 });
  out['nextPrompt'] = { admit: next.admit.status, body: next.admit.json, terminal: next.terminal };
  const k = brokerCalls.length;
  const detach = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detachBroker'] = brokerCalls.slice(k).map((c) => `${c.url.replace(/[0-9a-f-]{36}/g, '<id>').slice(0, 90)} ${c.kind ?? ''} ${c.status}`);
  out['detach'] = { status: detach.status, body: detach.json };
  const reload = detach.status === 204 ? await h.open(s.sessionId, s.workspaceId, profile, 'load') : undefined;
  out['reload'] = reload && { status: reload.status, body: reload.json };
  out['lease'] = (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE runtime_session_id LIKE ?', [`mcp:${s.sessionId}%`])).length;
  out['records'] = (await sql("SELECT domain, CAST(r.inline_bytes AS CHAR) AS body FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r ON r.session_scope_key = e.session_scope_key AND r.resource_id = e.record_resource_id WHERE e.session_id = ?", [s.sessionId]))
    .map((x) => { const b = JSON.parse(x['body']!); return `${x['domain']}:${b.record?.run?.state ?? b.run?.state}/${b.record?.run?.execution ?? b.run?.execution}/${b.record?.releaseState ?? b.releaseState ?? ''}`; });
  // A second Session in the same Workspace afterwards.
  const s2 = await newSession(W);
  await h.open(s2.sessionId, s2.workspaceId, profile);
  const other = await h.prompt(s2.sessionId, 'NEXT', { timeout: 60_000 });
  out['otherSessionSameWorkspace'] = { admit: other.admit.status, body: other.admit.json, terminal: other.terminal };
  out['sessionId'] = s.sessionId;
} finally {
  result(`s4-${MODE}-${SERVER}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
