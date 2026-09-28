// S14 (round 3): does discovering before every model request turn one MCP
// server's outage into a Session-wide outage? Session pins the stdio server
// and the SSE (or HTTP) server; the second one goes down after a good turn.
import { execFileSync } from 'node:child_process';
import {
  Harness, RUN, delay, effects, fakeToolCall, mcpProfile, newSession, result,
  setScript, sql, startBrokerProxy, startModel, toolFor,
} from './rig12946-lib.js';

const KIND = process.env['S14_KIND'] ?? 'sse';
const W = Number(process.env['S14_WS'] ?? 14);
const [server, name, port, token] = KIND === 'sse'
  ? ['legacy', 'sse', '18812', 'sse-secret-token'] : ['remote', 'http', '18811', 'http-secret-token'];
const srv = (...args: string[]) => execFileSync(`${process.env['RIG_DIR']}/srv.sh`, [RUN, ...args]);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = { kind: KIND };
try {
  setScript((ctx) => {
    if (ctx.marker.startsWith('STDIO')) {
      if (!ctx.receipts.length) return { toolCalls: [fakeToolCall(toolFor(ctx, `side effect on server stdio-${W}.`), { tag: ctx.marker }, 'e')] };
      return { content: `DONE ${String(JSON.stringify(ctx.receipts[0].content)).slice(-60)}` };
    }
    return { content: 'TEXT_ONLY_ANSWER' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['local'], [server]]));
  const t = async (marker: string) => {
    const e0 = effects().length;
    const r = await h.prompt(s.sessionId, marker, { timeout: 120_000 });
    return { admit: r.admit.status, admitBody: r.admit.status === 202 ? undefined : r.admit.json, terminal: r.terminal, blocked: r.status?.recoveryBlocked, effects: effects().length - e0 };
  };
  out['before'] = await t('STDIO_1');
  srv('stop', name, KIND, port);
  await delay(2000);
  out['textOnlyWhileDown'] = await t('TEXT_1');
  out['stdioToolWhileDown'] = await t('STDIO_2');
  srv('start', name, KIND, port, '--token', token);
  await delay(2000);
  out['textAfterRestart'] = await t('TEXT_2');
  out['stdioAfterRestart'] = await t('STDIO_3');
  out['configurations'] = (await sql("SELECT CAST(r.inline_bytes AS CHAR) AS body FROM qwen_managed_session_extension_record e JOIN qwen_managed_session_resource r ON r.session_scope_key = e.session_scope_key AND r.resource_id = e.record_resource_id WHERE e.session_id = ? AND e.domain = 'mcp_configuration'", [s.sessionId]))
    .map((x) => { const b = JSON.parse(x['body']!); const r = b.record ?? b; return `${r.serverId}#${r.configRevision}:${r.run.state}/${r.releaseState}`; });
  const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = d.status;
} finally {
  try { execFileSync('curl', ['-s', '-o', '/dev/null', `http://127.0.0.1:${port}/`]); } catch { srv('start', name, KIND, port, '--token', token); }
  result(`s14-${KIND}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
