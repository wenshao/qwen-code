// S10 (trial merge with D3): Stage H chain on the merged jar; validate the
// event page (D3 shape) and the task routes against the merged spec.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { FIXTURES, PORT, RefMapper, api, commitMonitor, createPublicSession, javaRows, openLog, openSession, say, tsViewAsRow } from './lib.mjs';
openLog('s10-merge-events');
const MW = `${process.env.SPD}/wt-merge`;
const require = createRequire(`${MW}/package.json`);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default ?? require('ajv-formats');
const spec = JSON.parse(fs.readFileSync(`${MW}/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'spec', components: spec.components });
const schemaOf = (path, method, status, media = 'application/json') => {
  const r = spec.paths[path][method].responses[String(status)];
  const res = r.$ref ? spec.components.responses[r.$ref.split('/').pop()] : r;
  return JSON.parse(JSON.stringify(res.content[media].schema).replaceAll('"#/components/', '"spec#/components/'));
};
const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'merge-a', create: true });
const refs = new RefMapper(session.resources);
const bodies = await Promise.all(FIXTURES.monitorChainCases[0].revisions.map((r) => refs.remap(r.monitorRun)));
let same = 0;
for (let i = 0; i < bodies.length; i++) {
  await commitMonitor(session, sessionKey, `m:${i + 1}`, bodies[i]);
  const ts = tsViewAsRow(session.authority.extensionRecord('monitor_run', 'monitor-1'));
  const java = javaRows(sessionId)[0].slice(0, 10);
  if (JSON.stringify(ts) === JSON.stringify(java)) same++;
}
await session.close();
const ev = await api('GET', `/v1/agents/sessions/${sessionId}/events?limit=1000`, { actor: 'alice' });
const vEvents = ajv.compile(schemaOf('/v1/agents/sessions/{sessionId}/events', 'get', 200));
const okEvents = vEvents(ev.json);
const task = ev.json.data?.find((e) => e.type === 'task.updated');
const list = await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { actor: 'alice' });
const okList = ajv.compile(schemaOf('/v1/agents/sessions/{sessionId}/tasks', 'get', 200))(list.json);
const sess = await api('GET', `/v1/agents/sessions/${sessionId}`, { actor: 'alice' });
const okSess = ajv.compile(schemaOf('/v1/agents/sessions/{sessionId}', 'get', 200))(sess.json);
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { actor: 'alice', body: { sessionId } });
say('merge', {
  revisionsEqual: `${same}/${bodies.length}`,
  eventsPage: { status: ev.status, count: ev.json.data?.length, has_more: ev.json.has_more, validAgainstMergedSpec: okEvents, errors: okEvents ? undefined : vEvents.errors.slice(0, 3) },
  sampleTaskUpdated: task,
  taskUpdatedStates: ev.json.data?.filter((e) => e.type === 'task.updated').map((e) => e.data.state),
  tasksListValid: okList,
  session: { valid: okSess, capabilities: sess.json.capabilities, spec: spec.info.version },
  webShellTranscript: [tr.status, tr.json.events?.length ?? tr.json.error?.code],
});
