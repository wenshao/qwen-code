// S11 part C re-run on the same DB: after promotion, cwd change with QWEN_HOME unset (probe gate), then canonical.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
L.openLog(`s11c-${process.env.TAG ?? 'r5'}`);
const { say } = L;
const R = {};
const sid = L.one("SELECT s.session_id FROM managed_agent_session s WHERE s.workspace_storage_id='st-a' LIMIT 1");
const ctx = () => { const r = L.sql(`SELECT cwd_relative, context_revision FROM managed_agent_session WHERE session_id='${sid}'`)[0]; return { cwd: r[0], rev: Number(r[1]) }; };
async function up() { for (let i = 0; i < 300; i++) { const r = await fetch('http://127.0.0.1:8288/actuator/health').catch(() => null); if (r?.ok) return i; await L.sleep(1000); } throw new Error('service not healthy'); }
for (const [qh, target] of [['unset', 'project/sub'], ['default', 'project']]) {
  L.svc(`QHOME=${qh}`, 'restart'); const waited = await up();
  say(`   ${L.sh("grep -a '^=== ' /var/log/qwen-w1c/server.log | tail -1").slice(0, 230)} (healthy after +${waited}s)`);
  const b = ctx();
  const r = await L.api('POST', `/v1/agents/sessions/${sid}/cwd`, { cwd_relative: target, expected_context_revision: b.rev }, { key: randomUUID() });
  let st = r.json?.status; let g = null; const op = r.json?.id;
  for (let i = 0; i < 120 && op && !['completed', 'failed'].includes(String(st)); i++) { await L.sleep(250); g = await L.api('GET', `/v1/agents/sessions/${sid}/operations/${op}`); st = g.json?.status; }
  const a = ctx();
  R[qh] = { admit: `${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}`, op: op ? `${st}${g?.json?.failure_code ? ` (${g.json.failure_code})` : ''}` : '-', binding: `${b.cwd}@${b.rev} → ${a.cwd}@${a.rev}` };
  say(`   after promotion, QWEN_HOME=${qh}: cwd → ${target}: admit=${R[qh].admit} op=${R[qh].op} binding ${R[qh].binding}`);
}
L.svc('stop');
fs.writeFileSync(`${L.OUT}/s11c-${process.env.TAG ?? 'r5'}.json`, JSON.stringify(R, null, 1));
say('S11C-DONE');
