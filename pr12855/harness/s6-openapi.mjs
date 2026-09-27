// S6: validate real responses of the four served task routes, the Session
// capabilities, and the error envelopes against the PR's OpenAPI 1.17.0 with
// Ajv (2020-12), independent of the Java contract test.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import {
  FIXTURES, RefMapper, WT, api, commitMonitor, createPublicSession, openLog, openSession, say,
} from './lib.mjs';

openLog('s6-openapi');
const require = createRequire(`${WT}/package.json`);
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default ?? require('ajv-formats');
const spec = JSON.parse(fs.readFileSync(`${WT}/packages/sdk-java/managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`, 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'spec', components: spec.components });
const statuses = {};
function responseSchema(path, method, status) {
  const op = spec.paths[path][method];
  statuses[op.operationId] = op['x-qwen-implementation-status'];
  const r = op.responses[String(status)];
  const resolved = r.$ref ? spec.components.responses[r.$ref.split('/').pop()] : r;
  const schema = resolved.content['application/json'].schema;
  return JSON.parse(JSON.stringify(schema).replaceAll('"#/components/', '"spec#/components/'));
}
function check(label, path, method, res) {
  const v = ajv.compile(responseSchema(path, method, res.status));
  const ok = v(res.json);
  return { label, status: res.status, ok, errors: ok ? undefined : v.errors.slice(0, 3).map((e) => `${e.instancePath} ${e.message}`) };
}

const pub = await createPublicSession({ actor: 'alice' });
const sessionId = pub.id;
const { session, sessionKey } = await openSession({ sessionId, writerId: 'oa', create: true });
const refs = new RefMapper(session.resources);
const chain = FIXTURES.monitorChainCases[0].revisions.map((r) => r.monitorRun);
const bodies = await Promise.all(chain.map((b) => refs.remap(b)));
for (let i = 0; i < 6; i++) await commitMonitor(session, sessionKey, `m1:${i}`, bodies[i]); // degraded/ready
await commitMonitor(session, sessionKey, 'm2:0', { ...bodies[0], monitorId: 'monitor-2' }); // pending/unbound
const taskId = session.authority.taskViews()[1].taskId;
const S = '/v1/agents/sessions/{sessionId}';
const W = '/api/agent/web-shell/v1';
const results = [
  check('list 200', `${S}/tasks`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=1`, { actor: 'alice' })),
  check('detail 200', `${S}/tasks/{taskId}`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${taskId}`, { actor: 'alice' })),
  check('list 400 cursor', `${S}/tasks`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks?cursor=x`, { actor: 'alice' })),
  check('list 400 limit', `${S}/tasks`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks?limit=0`, { actor: 'alice' })),
  check('list 404 session', `${S}/tasks`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks`, { tenant: 't-other' })),
  check('detail 404 task', `${S}/tasks/{taskId}`, 'get', await api('GET', `/v1/agents/sessions/${sessionId}/tasks/task_${'f'.repeat(64)}`, { actor: 'alice' })),
  check('webshell query 200', `${W}/tasks/query`, 'post', await api('POST', `${W}/tasks/query`, { actor: 'alice', body: { sessionId, limit: 1 } })),
  check('webshell get 200', `${W}/tasks/get`, 'post', await api('POST', `${W}/tasks/get`, { actor: 'alice', body: { sessionId, taskId } })),
  check('webshell get 404', `${W}/tasks/get`, 'post', await api('POST', `${W}/tasks/get`, { actor: 'alice', body: { sessionId, taskId: `task_${'f'.repeat(64)}` } })),
  check('webshell query 400', `${W}/tasks/query`, 'post', await api('POST', `${W}/tasks/query`, { actor: 'alice', body: { sessionId, limit: 500 } })),
  check('session get 200', S, 'get', await api('GET', `/v1/agents/sessions/${sessionId}`, { actor: 'alice' })),
  check('webshell session get 200', `${W}/sessions/get`, 'post', await api('POST', `${W}/sessions/get`, { actor: 'alice', body: { sessionId } })),
];
// Mutation sanity: the validator must reject a wrong state or a missing field.
const good = (await api('GET', `/v1/agents/sessions/${sessionId}/tasks/${taskId}`, { actor: 'alice' })).json;
const vDetail = ajv.compile(responseSchema(`${S}/tasks/{taskId}`, 'get', 200));
const negatives = {
  badState: vDetail({ ...good, state: 'exploded' }),
  missingKind: vDetail(Object.fromEntries(Object.entries(good).filter(([k]) => k !== 'kind'))),
  extraField: vDetail({ ...good, surprise: 1 }),
  secondsNotChecked: vDetail({ ...good, created_at: Math.floor(good.created_at / 1000) }),
};
say('results', results);
say('route-status', statuses);
say('validator-negatives (false = rejected)', negatives);
say('timestamps', { task_created_at: good.created_at, session_created_at: pub.created_at });
await session.close();
