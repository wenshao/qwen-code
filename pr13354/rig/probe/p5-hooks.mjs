// VERIFICATION RIG ONLY (PR #13354): SIMULATED hook-pinning coordinator — the tap injects a Hook catalog pin into the
// Harness create (Spring itself never sends hookCatalog). Catalog: HTTP SessionEnd -> /end, SessionDelete -> /delete.
//   H1 close -> End only;  H2 delete -> End then Delete
//   R3-1: Spring restart (Harness keeps attachments) -> H3 delete / H4 close of hooked Sessions; H5 control = ordinary Turn first, then delete
//   then restart the Harness and watch whether H3/H4 recover.
// usage: DB=h2 ARM=head node p5-hooks.mjs <basic|r31>
import * as L from './lib.mjs';
import fs from 'node:fs';
const mode = process.argv[2] ?? 'basic';
const R = new L.Report(`p5-hooks-${mode}`);
const pin = JSON.parse(fs.readFileSync(`${L.LOGD}/hook-pin.json`, 'utf8'));
const REC = `${L.LOGD}/hooks-rec.jsonl`;
const rec = (s) => (fs.existsSync(REC) ? fs.readFileSync(REC, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.session === s) : []);
const evs = (s) => rec(s).map((e) => `${e.event}@${e.t.slice(11, 23)}`);
const HWS = { a: ['ws-ha', 'st-b'], b: ['ws-hb', 'st-c'], c: ['ws-hc', 'st-d'] };
for (const [w, st] of Object.values(HWS)) await L.ensureWorkspace(w, st);
await L.ensureWorkspace('ws-h', 'st-b');
async function mkHooked(name, ws = 'ws-h') {
  L.setTapRules([{ match: '^POST /session$', action: 'inject', merge: { hookCatalog: pin }, times: 1 }]);
  const c = await L.createSession('public', ws, `G_WRITE name=${name}-${Date.now().toString(36)}.txt content=${name}`);
  const t = await L.waitTurns(c.session, 1);
  L.setTapRules([]);
  const created = L.tap().find((e) => e.method === 'POST' && e.path === '/session' && JSON.stringify(e.body ?? {}).includes(c.session));
  const cat = await L.api('GET', `/v1/agents/sessions/${c.session}/hook-catalog`);
  R.check(`[${name}] hooked Session created (catalog injected at the Harness create), first Turn completes`, created?.injected?.includes('hookCatalog') && t.rows.at(-1)?.status === 'COMPLETED', { injected: created?.injected, turn: t.rows.at(-1)?.status, hookCatalogApi: `${cat.status} ${cat.json?.catalogId ?? cat.json?.catalog_id ?? L.code(cat)}` });
  return c.session;
}
const opDone = async (s, op, ms) => L.waitFor(async () => { const r = await L.opRow(op); return ['COMPLETED', 'FAILED'].includes(r?.state) ? r : null; }, ms, 500);

if (mode === 'basic') {
  const s1 = await mkHooked('h1');
  const t1 = L.tapLen();
  const c = await L.closeS('public', s1);
  const cw = await L.waitOp('public', s1, L.opIdOf('public', c), 60_000);
  R.check('[H1] ACTIVE close with catalog: completes, SessionEnd x1, SessionDelete x0, via /lifecycle kind=close', cw.json.status === 'completed' && rec(s1).filter((e) => e.event === 'SessionEnd').length === 1 && rec(s1).filter((e) => e.event === 'SessionDelete').length === 0 && L.tapFor2(s1, t1).some((x) => x.includes('/lifecycle') && x.includes('kind=close')), { op: cw.json.status, ms: cw.waited, hooks: evs(s1), wire: L.tapFor2(s1, t1), row: await L.opRow(L.opIdOf('public', c)) });
  const s2 = await mkHooked('h2');
  const t2 = L.tapLen();
  const d = await L.del('public', s2);
  const dw = await L.waitOp('public', s2, L.opIdOf('public', d), 60_000);
  const r2 = rec(s2);
  const end = r2.findIndex((e) => e.event === 'SessionEnd'), del = r2.findIndex((e) => e.event === 'SessionDelete');
  R.check('[H2] ACTIVE delete with catalog: completes, SessionEnd x1 then SessionDelete x1 (deleted_session_id matches)', dw.json.status === 'completed' && r2.length === 2 && end === 0 && del === 1 && r2[1].deleted === s2, { op: dw.json.status, ms: dw.waited, hooks: evs(s2), deleted: r2[1]?.deleted === s2, wire: L.tapFor2(s2, t2), row: await L.opRow(L.opIdOf('public', d)) });
  // retry of the same key after completion must not re-run hooks
  await L.del('public', s2, { key: 'unused' });
  await L.sleep(3000);
  R.check('[H2] no Hook re-run after completion', rec(s2).length === 2, evs(s2));
}

if (mode === 'r31') {
  const s3 = await mkHooked('r31-del', 'ws-ha'), s4 = await mkHooked('r31-close', 'ws-hb'), s5 = await mkHooked('r31-ctrl', 'ws-hc');
  const w = {}; for (const s of [s3, s4, s5]) w[s] = await L.workerOf(s);
  await L.closeDb();
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} spring TERM`, { allowFail: true }).split('\n')[0]);
  R.say(L.sh(`HOOKS=${L.LOGD}/hooks.json ${L.RIG}/lx/spring.sh ${L.ARM} ${L.DB}`, { allowFail: true }));
  const t0 = L.tapLen();
  const tStart = Date.now();
  // control first: an ordinary Turn repopulates the connector cache for s5 only
  const inp = await L.sendInput(s5, `G_WRITE name=r31-ctrl2-${Date.now().toString(36)}.txt content=again`);
  const tt = await L.waitTurns(s5, 2, 90_000);
  const d5 = await L.del('public', s5);
  const d5w = await opDone(s5, L.opIdOf('public', d5), 60_000);
  R.check('[H5 control] after Spring restart, an ordinary Turn first, then delete: completes with End then Delete', tt.rows.at(-1)?.status === 'COMPLETED' && d5w.v?.state === 'COMPLETED' && evs(s5).length === 2, { turn: tt.rows.at(-1)?.status, op: d5w.v ?? (await L.opRow(L.opIdOf('public', d5))), hooks: evs(s5), wire: L.tapFor2(s5, t0) });
  const d3 = await L.del('public', s3);
  const c4 = await L.closeS('public', s4);
  const op3 = L.opIdOf('public', d3), op4 = L.opIdOf('public', c4);
  R.say(`admitted delete ${d3.status} op=${op3}; close ${c4.status} op=${op4}`);
  const timeline = [];
  for (let i = 0; i < 18; i++) {
    await L.sleep(10_000);
    const a = await L.opRow(op3), b = await L.opRow(op4);
    timeline.push({ s: Math.round((Date.now() - tStart) / 1000), del: `${a.state}/${a.err}/gen${a.gen}/att${a.attempts}`, close: `${b.state}/${b.err}/gen${b.gen}/att${b.attempts}` });
    if (a.state === 'COMPLETED' && b.state === 'COMPLETED') break;
  }
  R.note('[R3-1] timeline after Spring restart (10 s samples)', timeline);
  const a = await L.opRow(op3), b = await L.opRow(op4);
  const wire3 = L.tapFor2(s3, t0), wire4 = L.tapFor2(s4, t0);
  R.check('[H3 R3-1] hooked ACTIVE delete after Spring restart (Harness kept) is stuck: not completed, Session DELETING', a.state !== 'COMPLETED' && (await L.sessRow(s3)).status === 'DELETING', { op: a, wire: wire3.slice(0, 4), wireCount: wire3.length, hooks: evs(s3) });
  R.check('[H3 R3-1] every attempt is a lifecycle load refused 409 hosted_session_already_attached; no /lifecycle, no Hook ran', wire3.length > 0 && wire3.every((x) => x.startsWith('POST /session/:id/load -> 409') && x.includes('lifecycleLoad')) && evs(s3).length === 0, wire3);
  R.check('[H4 R3-1] hooked ACTIVE close after Spring restart is stuck the same way', b.state !== 'COMPLETED' && (await L.sessRow(s4)).status === 'CLOSING' && wire4.every((x) => x.startsWith('POST /session/:id/load -> 409')) && evs(s4).length === 0, { op: b, wireCount: wire4.length, hooks: evs(s4) });
  R.check('[H3/H4] original workers still alive (never stopped)', L.alive(w[s3].pid) && L.alive(w[s4].pid), { s3: w[s3].pid, s4: w[s4].pid });
  // recovery attempt: restart the Harness (its attachments go away with it)
  await L.closeDb();
  const tH = Date.now();
  R.say(L.sh(`${L.RIG}/lx/stop.sh ${L.DB} harness TERM`, { allowFail: true }).split('\n')[0]);
  R.say(L.sh(`${L.RIG}/lx/harness.sh ${L.DB} ${L.ARM}`, { allowFail: true }));
  const t1 = L.tapLen();
  const after = [];
  for (let i = 0; i < 30; i++) {
    await L.sleep(10_000);
    const x = await L.opRow(op3), y = await L.opRow(op4);
    after.push({ s: Math.round((Date.now() - tH) / 1000), del: `${x.state}/${x.err}/gen${x.gen}/att${x.attempts}`, close: `${y.state}/${y.err}/gen${y.gen}/att${y.attempts}` });
    if (x.state === 'COMPLETED' && y.state === 'COMPLETED') break;
  }
  R.note('[R3-1] timeline after Harness restart (10 s samples)', after);
  const x = await L.opRow(op3), y = await L.opRow(op4);
  R.note('[R3-1] after Harness restart', { del: x, close: y, sessions: [(await L.sessRow(s3)).status, (await L.sessRow(s4)).status], hooksDel: evs(s3), hooksClose: evs(s4), wireDel: L.tapFor2(s3, t1).slice(0, 6), wireClose: L.tapFor2(s4, t1).slice(0, 6), workersAlive: [L.alive(w[s3].pid), L.alive(w[s4].pid)] });
  fs.writeFileSync(`${L.OUT}/p5-r31-ids.json`, JSON.stringify({ s3, s4, s5, op3, op4 }));
}
R.done();
await L.closeDb();
