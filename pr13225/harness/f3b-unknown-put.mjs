// F3b: the publication that saw one failed PUT (attempt UNKNOWN, later attempt RETURNED, object VERIFIED):
// close + DELETE it and watch whether it is ever collected.
import * as L from './lib.mjs';
const S = process.env.SESSION, TAG = `f3b-${Date.now().toString(36)}`;
L.openLog(TAG);
async function op(kind, method, url) {
  const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}` });
  for (let i = 0; i < 120 && r.status < 300; i++) { const o = (await L.api('GET', `/v1/agents/sessions/${S}/operations/${r.json?.id}`)).json; if (/completed|failed/.test(String(o?.status))) return `${r.status} ${o.status}`; await L.sleep(250); }
  return `${r.status} ${r.json?.error?.code ?? ''}`;
}
L.say('objects', L.sql(`SELECT o.state, COUNT(*) FROM qwen_tool_publication_object o JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${S}' GROUP BY o.state`).map((r) => r.join('=')));
L.say('close', await op('close', 'POST', `/v1/agents/sessions/${S}/close`));
L.say('delete', await op('delete', 'DELETE', `/v1/agents/sessions/${S}`));
const t0 = Date.now(); let last = '';
while (Date.now() - t0 < Number(process.env.WATCH_S ?? 140) * 1000) {
  const r = L.sql(`SELECT retention_state, IFNULL(gc_blocker,'-'), capture_held_bytes+producer_held_bytes+admission_held_bytes FROM qwen_tool_publication WHERE session_id='${S}'`)[0];
  const k = r.join(' ');
  if (k !== last) { L.say(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, k); last = k; }
  await L.sleep(500);
}
L.say('attempts', L.sql(`SELECT a.state, COUNT(*) FROM qwen_output_put_attempt a JOIN qwen_tool_publication p USING (scope_key, publication_id) WHERE p.session_id='${S}' GROUP BY a.state`).map((r) => r.join('=')));
