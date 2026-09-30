// S6: the public G0 route (REST create with an initial file Turn) through the real Java connector with the option on.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as L from './lib.mjs';
L.openLog(`s6-public${process.env.TAG ? '-' + process.env.TAG : ''}`);
const { say } = L; const R = '/srv/w1a';
const state = () => JSON.parse(fs.readFileSync(`${L.RUN}/pub-state.json`, 'utf8'));
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' ')); say('harness:', fs.readFileSync(`${L.RUN}/pub-up.json`, 'utf8'));
for (const s of 'abcd') L.seedWs(`ws-${s}`, s);
const turnRow = (sid) => L.sql(`SELECT status, COALESCE(error_code,'-'), retry_count FROM managed_agent_turn WHERE session_id='${sid}'`)[0] ?? ['<no turn row>'];
async function g0(label, workspace, text, cwd = 'project', expectFile) {
  const s0 = state(); const t0 = Date.now();
  const res = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text }], workspace: { workspace_id: workspace, cwd_relative: cwd } }, { key: randomUUID() });
  const sid = res.json.id; let row = ['-'];
  if (sid) { for (;;) { row = turnRow(sid); if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(row[0]) || Date.now() - t0 > 120000) break; await L.sleep(250); } }
  await L.sleep(400); const s1 = state();
  const ledger = s1.ledger.slice(s0.ledger.length).map((e) => `${L.opName(e.url)}→${e.status}${e.code ? `(${e.code})` : ''}`).join('  ') || '<no Broker calls>';
  const ev = sid ? await L.api('GET', `/v1/agents/sessions/${sid}/events`) : null;
  const err = (ev?.json?.data ?? []).filter((e) => /error|failed/.test(e.type)).map((e) => JSON.stringify(e).slice(0, 260)).at(-1);
  say(`${label}`);
  say(`   POST /v1/agents/sessions -> ${res.status}${sid ? '' : ' ' + JSON.stringify(res.json).slice(0, 200)}; turn ${row.join(' / ')} after ${Date.now() - t0} ms; model calls +${s1.modelCalls - s0.modelCalls}`);
  say(`   broker: ${ledger}`);
  if (expectFile) say(`   ${expectFile}: ${fs.existsSync(expectFile) ? 'written' : 'not written'}`);
  if (err) say(`   last error event: ${err}`);
  return sid;
}
const a = await g0('P1 registered storage a (READY rev 1)', 'ws-a', 'WRITE pub.txt x', 'project', `${R}/a/project/pub.txt`);
await g0('P2 storage c, never registered', 'ws-c', 'WRITE pub.txt x', 'project', `${R}/c/project/pub.txt`);
await g0('P3 storage b, registered then fenced', 'ws-b', 'WRITE pub.txt x', 'project', `${R}/b/project/pub.txt`);
await g0('P4 storage d, registered then replaced at the same pathname', 'ws-d', 'WRITE pub.txt x', 'project', `${R}/d/project/pub.txt`);
await g0('P5 registered storage a, text-only initial Turn', 'ws-a', 'PLAIN hello');
await g0('P6 storage c (unregistered), text-only initial Turn', 'ws-c', 'PLAIN hello');
say('== history of the completed Session after a Spring restart (the Harness keeps running)');
say('  ', L.svc('restart').split(' ===')[0]);
const g = await L.api('GET', `/v1/agents/sessions/${a}`); const e = await L.api('GET', `/v1/agents/sessions/${a}/events`); const t = await L.api('GET', `/v1/agents/sessions/${a}/turns`);
say(`   GET session=${g.status} events=${e.status} (${(e.json.data ?? []).length} events) turns=${t.status} (${(t.json.data ?? []).map((x) => x.status).join(',')})`);
const later = await L.api('POST', `/v1/agents/sessions/${a}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: 'WRITE second.txt x' }] }, { key: randomUUID() });
say(`   public next input on the completed G0 Session: ${later.status} ${later.json?.error?.code ?? JSON.stringify(later.json).slice(0, 120)}`);
say('S6-DONE');
