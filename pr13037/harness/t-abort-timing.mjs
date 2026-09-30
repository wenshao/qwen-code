// When the server stops a stream mid-way, how long until the client learns about it?
import fs from 'node:fs';
import * as L from './lib.mjs';
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === 'log100');
const ws = L.one(`SELECT workspace_id FROM managed_agent_session WHERE session_id='${big.session}'`);
const a = (await L.api('GET', `/v1/agents/sessions/${big.session}/artifacts`)).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
const t0 = Date.now();
const res = await fetch(`${L.BASE}/v1/agents/sessions/${big.session}/artifacts/${a.id}/content?revision=${a.revision}`, { headers: L.headers({}) });
const reader = res.body.getReader();
let received = 0, revokedAt = null, lastByteAt = null, error = null, done = false;
try {
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) { done = true; break; }
    received += value.byteLength;
    lastByteAt = Date.now() - t0;
    if (revokedAt === null && received >= 8 * 1024 * 1024) {
      L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}' AND actor_id='alice'`);
      revokedAt = Date.now() - t0;
    }
  }
} catch (e) {
  error = `${e.name}: ${e.cause?.code ?? e.message}`;
}
const endAt = Date.now() - t0;
L.grant(ws, 'alice');
console.log(JSON.stringify({ status: res.status, declared: a.byte_length, received, revokedAtMs: revokedAt, lastByteAtMs: lastByteAt, clientLearnedAtMs: endAt, silentGapMs: endAt - lastByteAt, endedAs: done ? 'clean end of stream (looks complete to a naive client)' : error }));
