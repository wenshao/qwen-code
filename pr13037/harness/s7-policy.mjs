// s7: one probe per deployment configuration (Spring restarted by the caller).
// usage: CONF="<label>" WS=<n> node s7-policy.mjs
import fs from 'node:fs';
import * as L from './lib.mjs';
const CONF = process.env.CONF;
const file = `${L.R}/out/s7-policy.json`;
const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { configs: [], sessions: {} };
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const old = s1.find((r) => r.case === 'ok').session; // published earlier with original + preview approved
const row = { conf: CONF };
// --- a result published earlier under "all approved"
const get = await L.api('GET', `/v1/agents/sessions/${old}`);
const ws = await L.api('POST', '/api/agent/web-shell/v1/sessions/get', { sessionId: old });
row.capability = { public: get.json.capabilities?.artifacts, webShell: ws.json.capabilities?.artifacts ?? ws.json.session?.capabilities?.artifacts };
const item = L.one(`SELECT item_id FROM managed_agent_tool_result WHERE session_id='${old}'`);
const art = L.sql(`SELECT a.artifact_id, JSON_UNQUOTE(JSON_EXTRACT(a.descriptor_json,'$.revision')) FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${old}' AND a.stream_id='stdout'`)[0];
const res = await L.api('GET', `/v1/agents/sessions/${old}/items/${item}/tool-result`);
const md = await L.api('GET', `/v1/agents/sessions/${old}/artifacts/${art[0]}`);
const list = await L.api('GET', `/v1/agents/sessions/${old}/artifacts`);
const c = await L.content(old, art[0], { revision: art[1], range: 'bytes=0-3' });
const bad = await L.content(old, art[0], { revision: art[1], range: 'bytes=zzz' });
const ev = (await L.events(old)).find((e) => e.type === 'item.tool_result.updated');
row.earlierResult = {
  result: `${res.status}${res.json.access ? ' canRead=' + res.json.access.can_read_content : ' ' + (res.json.error?.code ?? '')}`,
  artifact: `${md.status}${md.json.access ? ' canRead=' + md.json.access.can_read_content : ' ' + (md.json.error?.code ?? '')}`,
  list: list.status,
  content: `${c.status} ${c.code ?? ''}`.trim(),
  malformedRange: `${bad.status} ${bad.code ?? ''}`.trim(),
  previewStillInSharedEvent: ev ? JSON.stringify(ev.data.result.preview?.text ?? null) : 'no event',
};
// --- a new Shell result under this configuration
const n = process.env.WS;
const name = `ws-s7-${n}`;
L.register(name, `st-s${n}`);
const session = await L.createShellSession(name, L.shellPrompt(`Policy case ${CONF}`, `echo secret-token-for-${n}; echo diag-${n} >&2`));
const turn = await L.waitTurn(session);
const proj = await L.waitProjection(session, { timeoutMs: 12000 });
all.sessions[CONF] = session;
const r = proj.rows[0] ?? {};
const evs = await L.events(session);
const nev = evs.find((e) => e.type === 'item.tool_result.updated');
row.newResult = {
  turn: turn.status,
  source: `${r.state}${r.failure ? '/' + r.failure : ''}`,
  policyVersion: r.policy || null,
  event: nev ? { execution: nev.data.result.execution_status, delivery: nev.data.result.delivery_status, artifacts: nev.data.result.artifacts.length, preview: nev.data.result.preview?.text ?? null } : null,
  artifactRows: +L.one(`SELECT COUNT(*) FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${session}'`),
  outputLeakedIntoEvents: JSON.stringify(evs).includes(`secret-token-for-${n}`),
};
// --- results created under earlier configurations: what do they look like now?
row.earlierConfigs = {};
for (const [conf, s] of Object.entries(all.sessions)) {
  if (conf === CONF) continue;
  const rr = L.resultRows(s)[0];
  const e = (await L.events(s)).find((x) => x.type === 'item.tool_result.updated');
  row.earlierConfigs[conf] = `${rr.state} policy=${rr.policy || '-'} artifacts=${e ? e.data.result.artifacts.length : '-'} preview=${e ? (e.data.result.preview ? 'yes' : 'no') : '-'} events=${(await L.events(s)).filter((x) => x.type === 'item.tool_result.updated').length}`;
}
console.log(JSON.stringify(row, null, 1));
all.configs.push(row);
fs.writeFileSync(file, JSON.stringify(all, null, 2));
