// VERIFICATION RIG ONLY (PR #13673): control without any Hook or delete. A plain idle Session (own workspace) on a
// retained Harness; Spring TERM restart; then a new Turn. usage: DB=.. ARM=.. DIST=.. node p-restart-turn.mjs
import * as L from './lib.mjs';
const R = new L.Report(`restart-turn${process.env.DOWN_MS ? '-down' + process.env.DOWN_MS : ''}`);
const DIST = process.env.DIST ?? L.ARM;
await L.ensureWorkspace('ws-b', 'st-b');
const s = await L.createSession('public', 'ws-b', `G_WRITE name=plain-${Date.now().toString(36)}.txt content=plain`);
const t = await L.waitTurns(s.session, 1, 180_000);
R.check('plain Session first Turn completes', t.rows.at(-1)?.status === 'COMPLETED', t.rows.at(-1));
await L.closeDb();
R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]);
const DOWN = Number(process.env.DOWN_MS ?? 0); if (DOWN) { R.note('Spring kept down', `${DOWN} ms`); await L.sleep(DOWN); }
R.say(L.sh(`HOOKS=${L.LOGD}/hooks.json DIST=${DIST} ${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }).split('\n').at(-1));
await L.api('GET', `/v1/agents/sessions/${s.session}`);
const t0 = L.tapLen();
const inp = await L.sendInput(s.session, `G_WRITE name=plain2-${Date.now().toString(36)}.txt content=again`);
const t2 = await L.waitTurns(s.session, 2, 150_000);
const fails = L.tap().slice(t0).filter((e) => e.path.includes(s.session) && e.status >= 400).map((e) => `${e.method} ${e.path.replace(s.session, ':id')} ${e.status} ${e.upstreamBody?.code ?? ''}`);
R.check('control: new Turn on the untouched Session after the Spring restart completes', t2.rows.at(-1)?.status === 'COMPLETED', { input: inp.status, last: t2.rows.at(-1), ms: t2.ms, timeout: !!t2.timeout, harness4xx5xx: [...new Set(fails)] });
R.done();
await L.closeDb();
