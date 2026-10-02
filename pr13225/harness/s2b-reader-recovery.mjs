// S2b (PR #13225): reader_active and recovery_protected with the injections at the right moments.
//   R2: close, DELETE, then a live read lease (40 s left; the row shape ReadLease inserts) -> reader_active,
//       re-polled after 60 s, collected once the lease has expired.
//   P2: close completes, THEN journal recovery is marked not READY, then DELETE -> recovery_protected.
import * as L from './lib.mjs';
const TAG = process.env.TAG ?? `s2b-${Date.now().toString(36)}`;
const SO = 6 * 1024 * 1024 + 11;
L.openLog(TAG);
async function lifecycle(session, kind, method, url) {
  const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}-${session.slice(0, 8)}` });
  const opId = r.json?.operation?.id ?? r.json?.id;
  let op = r.json;
  for (let i = 0; i < 240 && r.status < 300; i++) {
    op = (await L.api('GET', `/v1/agents/sessions/${session}/operations/${opId}`)).json;
    if (/completed|failed/i.test(String(op?.status ?? ''))) break;
    await L.sleep(250);
  }
  return `${r.status}${r.json?.error?.code ? '/' + r.json.error.code : ''} op=${op?.status}`;
}
const pub = (s) => L.sql(`SELECT publication_id, retention_state, IFNULL(gc_blocker,'-'), capture_held_bytes+producer_held_bytes+admission_held_bytes, gc_next_at FROM qwen_tool_publication WHERE session_id='${s}'`)[0];
const keys = (s) => L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${s}' AND o.object_key IS NOT NULL`).map((r) => r[0]);
async function make(name, storage) {
  const ws = `ws-${TAG}-${name}`; L.register(ws, storage);
  const s = await L.createShellSession(ws, L.shellPrompt(`s2b${name}`, L.genCmd(`${TAG}-${name}`, SO, 0, 0)), { key: `k-${TAG}-${name}` });
  await L.waitTurn(s, { timeoutMs: 600_000 }); await L.waitProjection(s, { timeoutMs: 300_000 });
  return s;
}
const R2 = await make('R2', process.env.ST_R ?? 'st-s19');
const P2 = await make('P2', process.env.ST_P ?? 'st-s20');
L.say('close-R2', await lifecycle(R2, 'close', 'POST', `/v1/agents/sessions/${R2}/close`));
L.say('close-P2', await lifecycle(P2, 'close', 'POST', `/v1/agents/sessions/${P2}/close`));
L.sql(`UPDATE qwen_managed_session_journal_head SET recovery_status='BLOCKED' WHERE session_id='${P2}'`);
L.say('delete-P2', await lifecycle(P2, 'delete', 'DELETE', `/v1/agents/sessions/${P2}`));
L.say('delete-R2', await lifecycle(R2, 'delete', 'DELETE', `/v1/agents/sessions/${R2}`));
const now0 = Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)'));
L.sql(`INSERT INTO qwen_output_read_lease (lease_id, tenant_key, session_key, retirement_generation, expires_at) VALUES (UUID(), SHA2('${L.TENANT}',256), SHA2('${R2}',256), 0, ${now0 + 40_000})`);
const retR = L.retirement(R2), retP = L.retirement(P2);
L.say('retired', { R2: retR, P2: retP, leaseExpiresAfterRetirementMs: now0 + 40_000 - Number(retR[2]) });
let last = '';
const t0 = Date.now();
while (Date.now() - t0 < Number(process.env.WATCH_S ?? 110) * 1000) {
  const dbNow = Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)'));
  const r = pub(R2), p = pub(P2);
  const k = `R2 ${r[1]} ${r[2]} held=${r[3]} oss=${keys(R2).filter(L.ossHas).length} | P2 ${p[1]} ${p[2]} held=${p[3]} oss=${keys(P2).filter(L.ossHas).length}`;
  if (k !== last) { L.say(`+${((dbNow - Number(retR[2])) / 1000).toFixed(1)}s`, k + ` | R2 next in ${((Number(r[4]) - dbNow) / 1000).toFixed(1)}s`); last = k; }
  await L.sleep(250);
}
