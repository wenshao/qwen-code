// S1-base: same public close + DELETE on main (no collector): what happens to the retired output?
import * as L from './lib.mjs';
const A = process.env.SESSION, TAG = `s1b-${Date.now().toString(36)}`;
L.openLog(TAG);
async function lifecycle(s, kind, method, url) { const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}` }); let op; for (let i = 0; i < 240 && r.status < 300; i++) { op = (await L.api('GET', `/v1/agents/sessions/${s}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(op?.status))) break; await L.sleep(250); } return `${r.status} ${op?.status ?? r.json?.error?.code}`; }
const keys = L.sql(`SELECT o.object_key FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${A}' AND o.object_key IS NOT NULL`).map((r) => r[0]);
L.say('close', await lifecycle(A, 'close', 'POST', `/v1/agents/sessions/${A}/close`));
L.say('delete', await lifecycle(A, 'delete', 'DELETE', `/v1/agents/sessions/${A}`));
const t0 = Date.now(); let last = '';
while (Date.now() - t0 < Number(process.env.WATCH_S ?? 90) * 1000) {
  const r = L.sql(`SELECT retention_state, capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication WHERE session_id='${A}'`)[0];
  const k = `${r[0]} held=${r[1]} oss=${keys.filter(L.ossHas).length}/${keys.length}`;
  if (k !== last) { L.say(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, k); last = k; }
  await L.sleep(500);
}
L.say('final', last);
