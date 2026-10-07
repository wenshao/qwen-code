// VERIFICATION RIG ONLY (PR #13354): base -> head upgrade on one DB, plus the mixed fleet head Spring + base Harness.
// phase prep    (base stack running): ACTIVE Session U1 for later delete; CLOSE of U2 admitted by base, its Harness call dropped, base Spring SIGKILLed
// phase upgrade (switches to head Spring + head Harness): historical op keeps protocol 0 and completes; U1 (base-created) ACTIVE delete completes
// phase mixed   (head Spring + base Harness): capabilities, ACTIVE delete and close on a Session created under this fleet
// usage: DB=b1 ARM=<arm of running Spring> node p6-upgrade.mjs <prep|upgrade|mixed>
import * as L from './lib.mjs';
import fs from 'node:fs';
const phase = process.argv[2];
const R = new L.Report(`p6-${phase}`);
const stateFile = `${L.OUT}/p6-state.json`;
const st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));
await L.ensureWorkspace('ws-a', 'st-a');
const mk = async (name) => { const c = await L.createSession('public', 'ws-a', `G_WRITE name=${name}-${Date.now().toString(36)}.txt content=${name}`); await L.waitTurns(c.session, 1); return c.session; };

if (phase === 'prep') {
  st.u1 = await mk('u1'); st.u2 = await mk('u2');
  st.u1w = await L.workerOf(st.u1); st.u2w = await L.workerOf(st.u2);
  L.setTapRules([{ match: `DELETE /session/${st.u2}`, action: 'drop-before' }]);
  const c = await L.closeS('public', st.u2);
  st.u2op = L.opIdOf('public', c);
  await L.waitFor(async () => L.tap().some((e) => e.path.includes(st.u2) && e.method === 'DELETE'), 20_000);
  R.note('base CLOSE admitted, its Harness DELETE dropped', { admit: c.status, row: await L.opRow(st.u2op), sess: (await L.sessRow(st.u2)).status });
  save();
  await L.closeDb();
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring KILL`, { allowFail: true }).split('\n')[0]);
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} harness TERM`, { allowFail: true }).split('\n')[0]);
  L.setTapRules([]);
  R.check('prep done', true, st);
}

if (phase === 'upgrade') {
  const t0 = Date.now();
  R.say(L.sh(`${L.RIG}/lx/spring.sh ${process.env.UP ?? 'head'} ${L.DB}`, { allowFail: true }));
  R.say(L.sh(`${L.RIG}/lx/harness.sh ${L.DB} ${process.env.UP ?? 'head'}`, { allowFail: true }));
  const mig = await L.sql('SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1');
  R.check(`V${process.env.EXPECT_V ?? '41'} applied on the base database`, mig[0].version === (process.env.EXPECT_V ?? '41') && mig[0].success === 1, mig[0]);
  const hist = await L.sql("SELECT lifecycle_protocol_version AS proto, COUNT(*) AS n FROM managed_agent_operation GROUP BY lifecycle_protocol_version");
  R.check('every historical operation defaults to protocol 0', hist.length === 1 && hist[0].proto === 0, hist);
  const tap0 = L.tapLen();
  const c = await L.waitFor(async () => { const r = await L.opRow(st.u2op); return r.state === 'COMPLETED' || r.state === 'FAILED' ? r : null; }, 240_000, 500);
  const u2w = await L.workerOf(st.u2);
  R.check('in-flight base CLOSE completes under the head coordinator with its original protocol 0', c.v?.state === 'COMPLETED' && c.v.proto === 0 && (await L.sessRow(st.u2)).status === 'CLOSED' && !L.alive(st.u2w.pid), { row: await L.opRow(st.u2op), ms: Date.now() - t0, wire: L.tapFor2(st.u2, tap0), worker: u2w });
  const r = await L.read('public', st.u1);
  const d = await L.del('public', st.u1);
  const w = await L.waitOp('public', st.u1, L.opIdOf('public', d), 180_000);
  R.check('base-created ACTIVE Session deletes after the upgrade (L3, protocol 1)', d.status === 202 && w.json.status === 'completed' && (await L.opRow(L.opIdOf('public', d))).proto === 1 && !L.alive(st.u1w.pid), { caps: L.caps('public', r), admit: d.status, waited: w.waited, row: await L.opRow(L.opIdOf('public', d)), wire: L.tapFor2(st.u1, tap0) });
}

if (phase === 'mixed') {
  const caps = await (await fetch(`http://127.0.0.1:${L.HARNESS_PORT}/capabilities`, { headers: { Authorization: `Bearer ${L.HTOKEN}` } })).json();
  R.note('running Harness capabilities (lifecycle protocol)', { lifecycleProtocolVersion: caps.lifecycleProtocolVersion ?? caps.lifecycle_protocol_version ?? null, keys: Object.keys(caps).filter((k) => /lifecycle/i.test(k)) });
  for (const surface of ['public', 'web']) {
    const s = await mk(`mixed-${surface}`);
    const w0 = await L.workerOf(s);
    const r = await L.read(surface, s);
    const d = await L.del(surface, s);
    const c = await L.closeS(surface, s);
    const cw = c.status === 202 ? await L.waitOp(surface, s, L.opIdOf(surface, c), 60_000) : { json: {} };
    R.note(`[${surface}] head Spring + base Harness`, { caps: L.caps(surface, r), del: `${d.status} ${L.code(d)}`, close: `${c.status} ${L.code(c)} ${cw.json.status ?? ''}`, closeRow: c.status === 202 ? await L.opRow(L.opIdOf(surface, c)) : null, workerAlive: L.alive(w0.pid) });
    st[`mixed_${surface}`] = { s, del: d.status, delCode: L.code(d), close: c.status, closeCode: L.code(c), closeStatus: cw.json.status, caps: L.caps(surface, r) };
  }
  save();
}
R.done({ st });
await L.closeDb();
