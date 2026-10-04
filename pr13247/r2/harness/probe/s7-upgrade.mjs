// VERIFICATION RIG ONLY (PR #13247) S7: base → head upgrade, head → base rollback (incl. an open cwd operation).
// Drives Spring jars itself (Harness stays up across Spring restarts; only the first Session per jar runs a Turn).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { api, Report, ensureWorkspace, createSession, waitTurn, sleep, j, sql, one, RIG, DB, RUN } from './lib.mjs';
import { pubChange, webChange, opId, pubOp, webOp, waitCwdOp, binding, cwdOpRow, ctxEvents, mkdirWs } from './cwd.mjs';

const R = new Report(process.env.NAME ?? 's7-upgrade');
const BASEJAR = process.env.BASEJAR ?? 'base', HEADJAR = process.env.HEADJAR ?? 'head', BASEV = process.env.BASEV ?? '33', HEADV = process.env.HEADV ?? '34';
const sh = (...a) => spawnSync('bash', a, { encoding: 'utf8', cwd: RIG });
const spring = (jar) => { sh(`${RIG}/stop.sh`, DB, 'spring', 'TERM'); const r = sh(`${RIG}/spring.sh`, jar, DB, 'absent', 'absent'); return r.stdout.trim().split('\n').at(-1); };
const springLog = () => { const f = fs.readdirSync(RUN).filter((x) => /^spring-\d+\.log$/.test(x)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/))).at(-1); return fs.readFileSync(`${RUN}/${f}`, 'utf8'); };
const flyway = () => sql(`SELECT version FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank DESC LIMIT 1`)[0]?.[0];

R.say('## 1. base jar (merge base a011f669): routes do not exist');
R.note('start base', spring(BASEJAR));
ensureWorkspace('ws-up', 'st-a');
mkdirWs('a', 'child2');
const c = await createSession('public', 'ws-up', 'PLAIN');
const s = c.session;
const t = await waitTurn(s);
R.check('base: bound Session created, initial Turn completes', t.status === 'COMPLETED', j(t));
const bp = await pubChange(s, 'child2', 1, { key: `s7-bp-${Date.now()}` });
const bw = await webChange(s, 'child2', 1, { key: `s7-bw-${Date.now()}` });
R.note('base: POST /v1/agents/sessions/{id}/cwd', `${bp.status} ${bp.json.error?.code ?? j(bp.json).slice(0, 120)}`);
R.note('base: POST /api/agent/web-shell/v1/sessions/cwd/change', `${bw.status} ${bw.json.error?.code ?? j(bw.json).slice(0, 120)}`);
R.check('base: neither cwd route is mapped (no 202)', bp.status !== 202 && bw.status !== 202, `${bp.status}/${bw.status}`);
R.check(`base schema at V${BASEV}`, flyway() === BASEV, `flyway=${flyway()}`);

R.say('## 2. upgrade to head jar on the same database');
R.note('start head', spring(HEADJAR));
{ const env=Object.fromEntries(fs.readFileSync(`${RIG}/rig.env`,'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])); const r=spawnSync(env.MYSQL,['-h127.0.0.1',`-P${env.DBPORT}`,'-uroot',`-p${env.DBPASS}`,DB],{input:fs.readFileSync(`${RIG}/probe/traps.sql`),encoding:'utf8'}); R.note('traps installed', String(r.status)); }
R.check(`head applied V${HEADV} on the base database`, flyway() === HEADV, `flyway=${flyway()}`);
const a1 = await pubChange(s, 'child2', 1, { key: `s7-h1-${Date.now()}` });
const w1 = await waitCwdOp(s, opId(a1));
R.check('pre-upgrade Session changes directory on head (rev 1→2, one event)', w1.json.status === 'completed' && binding(s).rev === 2 && ctxEvents(s).length === 1, `${a1.status} ${w1.json.status} ${j(binding(s))}`);
const oldOps = sql(`SELECT COUNT(*) FROM managed_agent_operation WHERE operation_kind <> 'CWD_CHANGE'`)[0][0];
R.note('non-cwd operation rows carried over', oldOps);

R.say('## 3. roll back to the base jar after a COMPLETED change');
R.note('start base again', spring(BASEJAR));
R.check(`base starts on the V${HEADV} database (future migration ignored)`, flyway() === HEADV && /Started ManagedAgentServerApplication/.test(springLog()), `flyway=${flyway()}`);
const r1 = await api('GET', `/v1/agents/sessions/${s}`);
R.note('base: Session read after rollback', `${r1.status} workspace=${j(r1.json.workspace)}`);
const g1 = await pubOp(s, opId(a1));
const g2 = await webOp(s, opId(a1));
R.note('base: GET the completed cwd operation (public / WebShell)', `${g1.status} ${g1.json.error?.code ?? ''} / ${g2.status} ${g2.json.error?.code ?? ''}`);

R.say('## 4. roll back to the base jar while a cwd change is OPEN (head crashed inside the claim)');
R.note('start head', spring(HEADJAR));
sql(`UPDATE rig_trap SET secs=30 WHERE name='claim'`);
mkdirWs('a', 'trap-claim-s7');
const a2 = await pubChange(s, 'trap-claim-s7', 2, { key: `s7-h2-${Date.now()}` });
await sleep(1500);
sh(`${RIG}/stop.sh`, DB, 'spring', 'KILL');
sql(`UPDATE rig_trap SET secs=4 WHERE name='claim'`);
R.note('open operation after head crash', j(cwdOpRow(opId(a2))));
R.note('start base', spring(BASEJAR));
await sleep(8000);
const row = cwdOpRow(opId(a2));
const log = springLog();
const enumErrors = (log.match(/No enum constant[^\n]*CWD_CHANGE/g) ?? []).length;
const g3 = await pubOp(s, opId(a2));
R.note('base, 8 s later: operation row / log', `row=${j(row)} "No enum constant …CWD_CHANGE" lines=${enumErrors} GET=${g3.status} ${g3.json.error?.code ?? ''}`);
R.check('base leaves the open cwd operation open (no settlement) while it runs', row.state !== 'COMPLETED' && binding(s).rev === 2, `${row.state} rev=${binding(s).rev}`);
R.note('start head again', spring(HEADJAR));
const w3 = await waitCwdOp(s, opId(a2), { timeoutMs: 90_000 });
R.check('head picks it up again and completes once (rev 3, two events total)', w3.json.status === 'completed' && binding(s).rev === 3 && ctxEvents(s).length === 2, `${w3.ms} ms ${w3.json.status} ${j(cwdOpRow(opId(a2)))}`);
fs.writeFileSync(`${RIG}/out/${DB}/s7-base-log-excerpt.txt`, (log.match(/^.*(No enum constant|operation will retry|Exception)[^\n]*$/gm) ?? []).slice(0, 12).join('\n') + '\n');
R.done({ session: s });
