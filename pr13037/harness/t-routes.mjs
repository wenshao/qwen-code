// all seven O3 routes for one published result, under the current server configuration
import fs from 'node:fs';
import * as L from './lib.mjs';
const LABEL = process.env.LABEL;
const s1 = JSON.parse(fs.readFileSync(`${L.R}/out/s1a.json`, 'utf8'));
const session = s1.find((r) => r.case === 'ok').session;
const item = L.one(`SELECT item_id FROM managed_agent_tool_result WHERE session_id='${session}'`);
const art = L.sql(`SELECT a.artifact_id, JSON_UNQUOTE(JSON_EXTRACT(a.descriptor_json,'$.revision')) FROM managed_agent_artifact a JOIN managed_agent_tool_result r ON r.result_id=a.result_id WHERE r.session_id='${session}' AND a.stream_id='stdout'`)[0];
const st = async (p) => { const r = await p; return `${r.status}${r.json?.error?.code ? ' ' + r.json.error.code : r.code ? ' ' + r.code : ''}`; };
const out = {
  'GET items/{item}/tool-result': await st(L.api('GET', `/v1/agents/sessions/${session}/items/${item}/tool-result`)),
  'GET artifacts': await st(L.api('GET', `/v1/agents/sessions/${session}/artifacts`)),
  'GET artifacts/{id}': await st(L.api('GET', `/v1/agents/sessions/${session}/artifacts/${art[0]}`)),
  'GET artifacts/{id}/content': await st(L.content(session, art[0], { revision: art[1] })),
  'POST web-shell tool-results/get': await st(L.api('POST', '/api/agent/web-shell/v1/tool-results/get', { sessionId: session, itemId: item })),
  'POST web-shell artifacts/query': await st(L.api('POST', '/api/agent/web-shell/v1/artifacts/query', { sessionId: session })),
  'POST web-shell artifacts/get': await st(L.api('POST', '/api/agent/web-shell/v1/artifacts/get', { sessionId: session, artifactId: art[0] })),
};
const ev = (await L.events(session)).find((e) => e.type === 'item.tool_result.updated');
const line = `[${LABEL}] ${JSON.stringify(out)}`;
console.log(line);
fs.appendFileSync(`${L.R}/out/t-routes.log`, line + '\n');
if (LABEL === 'enabled') { const l2 = `[timestamps in one public event] ${JSON.stringify({ event_created_at: ev.created_at, artifact_created_at: ev.data.result.artifacts[0].created_at })}`; console.log(l2); fs.appendFileSync(`${L.R}/out/t-routes.log`, l2 + '\n'); }
