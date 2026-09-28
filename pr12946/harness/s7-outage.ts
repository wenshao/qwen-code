// S7: remote MCP server outages.
//   S7_MODE=http-down-close  Streamable HTTP server gone when the Session closes
//   S7_MODE=sse-restart      SSE server restarts mid-Session (stream drops)
import { execFileSync } from 'node:child_process';
import {
  Harness, RUN, brokerCalls, delay, effects, fakeToolCall, mcpProfile,
  newSession, result, say, setScript, sql, startBrokerProxy, startModel,
  toolFor,
} from './rig12946-lib.js';

const MODE = process.env['S7_MODE'] ?? 'http-down-close';
const W = Number(process.env['S7_WS'] ?? 7);
const srv = (...args: string[]) =>
  execFileSync(`${process.env['RIG_DIR']}/srv.sh`, [RUN, ...args]);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { mode: MODE };
const [server, needle, name, transport, port, token] =
  MODE === 'http-down-close'
    ? ['remote', 'server http.', 'http', 'http', '18811', 'http-secret-token']
    : ['legacy', 'server sse.', 'sse', 'sse', '18812', 'sse-secret-token'];
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('EFFECT')) {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, needle), { tag: ctx.marker }, 'e')] };
      out[`${ctx.marker}_receipt`] = String(JSON.stringify(ctx.receipts[0].content)).slice(0, 160);
      return { content: 'DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  const profile = mcpProfile(W, [[server]]);
  await h.open(s.sessionId, s.workspaceId, profile);
  out['first'] = (await h.prompt(s.sessionId, 'EFFECT_1')).terminal;
  srv('stop', name, transport, port);
  say('stopped', name);
  await delay(1500);
  if (MODE === 'sse-restart') {
    srv('start', name, transport, port, '--token', token);
    await delay(1500);
    say('restarted', name);
    const e0 = effects().length;
    out['afterRestart'] = (await h.prompt(s.sessionId, 'EFFECT_2')).terminal;
    out['afterRestartEffects'] = effects().length - e0;
  }
  const k = brokerCalls.length;
  const t = Date.now();
  const detach = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = { status: detach.status, body: detach.json, ms: Date.now() - t,
    broker: brokerCalls.slice(k).map((c) => `${c.url.replace(/[0-9a-f-]{36}/g, '<id>').split('/').pop()} ${c.kind ?? ''} ${c.status}`) };
  out['statusAfterDetach'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
  if (MODE === 'http-down-close') {
    srv('start', name, transport, port, '--token', token);
    await delay(1500);
    const again = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    out['detachAfterServerBack'] = { status: again.status, body: again.json };
  } else if (detach.status !== 204) {
    const again = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
    out['detachAgain'] = { status: again.status, body: again.json };
  }
  out['lease'] = (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE runtime_session_id LIKE ?', [`mcp:${s.sessionId}%`])).length;
  out['records'] = (await sql("SELECT CAST(r.inline_bytes AS CHAR) AS body FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r ON r.session_scope_key = e.session_scope_key AND r.resource_id = e.record_resource_id WHERE e.session_id = ? AND e.domain = 'mcp_configuration'", [s.sessionId]))
    .map((x) => { const b = JSON.parse(x['body']!); const r = b.record ?? b; return `${r.run.state}/${r.run.execution}/${r.releaseState}`; });
} finally {
  if (MODE === 'http-down-close') {
    try { execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${port}/`]); } catch { srv('start', name, transport, port, '--token', token); }
  }
  result(`s7-${MODE}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
