// VERIFICATION RIG ONLY: state made by the base server (main, before this PR) for the upgrade check.
// usage: DB=d6up node s8a-base.mjs
import fs from 'node:fs';
import { api, one, sql, ensureWorkspace, createSession, listActions, waitTurn, waitOp, readWs, executions, Report, sleep, j, RIG, DB } from './lib.mjs';
const BASE_V = process.env.BASE_V ?? '22';
const R = new Report(`s8a-base-v${BASE_V}`);
ensureWorkspace('ws-a', 'st-a');
const flyway = sql(`SELECT version FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1`)[0][0];
R.check(`base schema is at V${BASE_V} (no Actions table)`, flyway === BASE_V && one(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}' AND table_name='managed_agent_action'`) === '0', `flyway=${flyway}`);
const c = await createSession('public', 'ws-a', 'D6_FILES name=base-yolo.txt');
const t = await waitTurn(c.session);
R.check('base: a yolo Workspace Session runs write -> edit -> read unasked', t.status === 'COMPLETED' && readWs('a', 'child/base-yolo.txt') === 'after' && executions(c.session) === 3, `turn=${t.status} executions=${executions(c.session)}`);
const pub = await api('GET', `/v1/agents/sessions/${c.session}`);
R.check('base: no actions capability field', pub.json.capabilities && !('actions' in pub.json.capabilities), j(pub.json.capabilities));
const la = await listActions('public', c.session);
const lw = await listActions('web', c.session);
R.check('base: the Action routes do not exist', la.status >= 400 && lw.status >= 400, `public HTTP ${la.status} ${j(la.json.error ?? la.json).slice(0, 120)} / web HTTP ${lw.status}`);
const u = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'hello' }] }, { key: 'unbound-1' });
const ut = await waitTurn(u.json.id);
const close = await api('POST', `/v1/agents/sessions/${u.json.id}/close`, undefined, { key: 'close-1' });
const cd = await waitOp(u.json.id, close.json.id);
R.check('base: a Session without a Workspace completes and closes (durable lifecycle operation)', ut.status === 'COMPLETED' && close.status === 202 && cd.json.status === 'completed', `turn=${ut.status} close HTTP ${close.status} op=${cd.json.status}`);
const u2 = await api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'hello again' }] }, { key: 'unbound-2' });
await waitTurn(u2.json.id);
fs.writeFileSync(`${RIG}/out/${DB}/base-state.json`, JSON.stringify({ bound: c.session, closed: u.json.id, closeOp: close.json.id, closeOpBody: cd.json, open: u2.json.id }, null, 2));
R.done();
