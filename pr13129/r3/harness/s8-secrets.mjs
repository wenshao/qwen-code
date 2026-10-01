// S8: public read-only catalog projection and secret containment. The manifest's HTTP header / URL token, command text,
// prompt text and handler module path must not appear in any public response or any MySQL row.
import { repairLeak, Report, Harness, HSession, startModel, startHookHttp, workspace, createWorkspaceSession, storeConnection, script, pin, hookRecords, setControl, api, j, sql, DB, RIG } from './lib.mjs';
import { STORAGE, HTTP_PORT } from './manifest.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const R = new Report('s8-secrets');
const env = Object.fromEntries(fs.readFileSync(`${RIG}/rig.env`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const model = await startModel();
const web = await startHookHttp(HTTP_PORT);
const h = await new Harness({ name: 's8', modelUrl: model.url }).start();
const SECRETS = ['RIG-SECRET-HEADER-7f3a', 'RIG-SECRET-URL-91c2', 'RIG-SECRET-CMD-5d1e', 'RIG-PROMPT-TEXT-SENSITIVE', 'probe/handlers.mjs', `127.0.0.1:${HTTP_PORT}`];
try {
  setControl({});
  const w = await workspace(STORAGE['ws-t7'], 'ws-t7');
  R.note('rig repair', String(await repairLeak(STORAGE['ws-t7'])));
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  await s.create({ hookCatalog: pin('ws-t7') });
  const op = await s.hookOp('Notification', { message: 'sec', notification_type: 'rig' });
  R.check('HTTP hook received the deployment header (credential lives only at the Runtime)', web.ledger.some((e) => e.auth === 'Bearer RIG-SECRET-HEADER-7f3a'), `op=${op.status} http=${web.ledger.length} auth=${web.ledger.map((e) => e.auth).join(',')}`);
  const pub = await api('GET', `/v1/agents/sessions/${id}/hook-catalog`);
  const pubText = JSON.stringify(pub.json);
  R.check('public catalog lists the 4 Hooks with display metadata only', pub.status === 200 && pub.json.catalogs?.[0]?.hooks?.length === 4, `${pub.status} ${pubText.slice(0, 500)}`);
  R.check('public catalog contains none of the secrets / recipes / module paths', !SECRETS.some((x) => pubText.includes(x)), SECRETS.filter((x) => pubText.includes(x)).join(',') || 'clean');
  const priv = JSON.stringify((await s.hooks()).json);
  R.note('private GET /session/:id/hooks contains', SECRETS.filter((x) => priv.includes(x)).join(',') || 'none of the secrets');
  const other = await api('GET', `/v1/agents/sessions/${id}/hook-catalog`, { actor: 'mallory' });
  R.check('another actor cannot read the catalog', other.status === 404 || other.status === 403, `${other.status} ${j(other.json).slice(0, 120)}`);
  const noActor = await api('GET', `/v1/agents/sessions/${id}/hook-catalog`, { actor: null });
  R.check('unauthenticated request is refused', noActor.status === 401 || noActor.status === 403 || noActor.status === 404, `${noActor.status}`);
  const noHooks = await createWorkspaceSession(w.workspaceId);
  const nh = await api('GET', `/v1/agents/sessions/${noHooks}/hook-catalog`);
  R.check('a Session without Hooks reports an empty catalog list', nh.status === 200 && Array.isArray(nh.json.catalogs) && nh.json.catalogs.length === 0, `${nh.status} ${j(nh.json)}`);
  const dump = execFileSync('/bin/sh', ['-c', `${env.MYSQL.replace(/mysql$/, 'mysqldump')} -h127.0.0.1 -P${env.DBPORT} -uroot -p${env.DBPASS} --skip-extended-insert ${DB} 2>/dev/null`], { maxBuffer: 2 * 1024 * 1024 * 1024 }).toString('latin1');
  const found = SECRETS.filter((x) => dump.includes(x));
  R.check('no secret / recipe / module path appears anywhere in the MySQL database', found.length === 0, found.length ? found.join(',') : `clean (${Math.round(dump.length / 1e6)} MB dump)`);
  const promptText = dump.includes('RIG-PROMPT-TEXT-SENSITIVE');
  R.note('prompt Hook text stored in the Store (design: Harness receives prompt definitions)', String(promptText));
  await s.detach();
} finally {
  await h.close();
  await model.close();
  await web.close();
  R.done();
}
