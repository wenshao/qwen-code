// VERIFICATION RIG ONLY (PR #13354): refusals, close semantics, L2 after close/archive, fence while DELETING, empty Session.
// usage: DB=.. ARM=head|base|merge node p2-edges.mjs
import * as L from './lib.mjs';
const R = new L.Report('p2-edges');
const l3 = L.ARM !== 'base';
await L.ensureWorkspace('ws-a', 'st-a');
L.setTapRules([]);
const mk = async (surface, text) => { const c = await L.createSession(surface, 'ws-a', text); return c.session; };

// ---- A. refusals persist nothing ----
for (const surface of ['public', 'web']) {
  const s = await mk(surface, `G_WRITE name=edge-${surface}-${Date.now()}.txt content=x`);
  await L.waitTurns(s, 1);
  const bob = await L.del(surface, s, { actor: 'bob' });
  const mal = await L.del(surface, s, { actor: 'mallory' });
  R.check(`[A ${surface}] readable non-creator bob -> 403`, bob.status === 403, `${bob.status} ${L.code(bob)}`);
  R.check(`[A ${surface}] no-access mallory -> 404`, mal.status === 404, `${mal.status} ${L.code(mal)}`);
  // active Turn: model holds the reply 15 s
  const inp = await L.sendInput(s, 'G_HOLD tag=edge hold=15000');
  await L.sleep(1500);
  const busy = await L.del(surface, s);
  R.check(`[A ${surface}] running Turn -> 409 turn_active${l3 ? '' : ' (base: state conflict first)'}`, busy.status === 409 && (l3 ? L.code(busy) === 'turn_active' : true), `${inp.status} -> ${busy.status} ${L.code(busy)}`);
  R.check(`[A ${surface}] refusals persisted no operation`, (await L.opsOf(s)).length === 0, await L.opsOf(s));
  await L.waitTurns(s, 2, 60_000);
  if (l3) {
    const d = await L.del(surface, s);
    const w = await L.waitOp(surface, s, L.opIdOf(surface, d));
    R.check(`[A ${surface}] after the Turn settles, the same Session deletes`, d.status === 202 && w.json.status === 'completed', `${d.status} ${w.json.status} ${w.waited} ms`);
  }
}

// ---- B. close semantics + L2 delete after close / archive ----
for (const surface of ['public', 'web']) {
  const s = await mk(surface, `G_WRITE name=close-${surface}-${Date.now()}.txt content=c`);
  await L.waitTurns(s, 1);
  const w0 = await L.workerOf(s);
  const t0 = L.tapLen();
  const c = await L.closeS(surface, s);
  const cw = await L.waitOp(surface, s, L.opIdOf(surface, c));
  const wire = L.tapFor2(s, t0);
  const row = await L.opRow(L.opIdOf(surface, c));
  const w1 = await L.workerOf(s);
  R.check(`[B ${surface}] ACTIVE close completes -> CLOSED, worker stopped`, cw.json.status === 'completed' && (await L.sessRow(s)).status === 'CLOSED' && !L.alive(w0.pid) && w1.regState === 'RETIRED', { status: cw.json.status, ms: cw.waited, row, w1 });
  R.note(`[B ${surface}] close wire (${L.ARM})`, wire);
  if (l3) R.check(`[B ${surface}] close uses lifecycle protocol 1, detach with authority, no legacy DELETE /session`, row.proto === 1 && wire.some((x) => x.startsWith('POST /session/:id/detach -> 204 auth=')) && !wire.some((x) => x.startsWith('DELETE')), wire);
  else R.check(`[B ${surface}] base close uses legacy DELETE /session`, wire.some((x) => x.startsWith('DELETE /session/:id')), wire);
  const r = await L.read(surface, s);
  R.check(`[B ${surface}] closed Session stays readable; capability delete=true (L2)`, r.status === 200 && L.caps(surface, r).delete === true, { status: r.status, caps: L.caps(surface, r) });
  let target = s;
  if (surface === 'web') { const a = await L.archive(surface, s); const aw = await L.waitOp(surface, s, L.opIdOf(surface, a)); R.check(`[B ${surface}] archive after close completes`, aw.json.status === 'completed', aw.json.status); }
  const t1 = L.tapLen();
  const d = await L.del(surface, target);
  const dw = await L.waitOp(surface, target, L.opIdOf(surface, d));
  const drow = await L.opRow(L.opIdOf(surface, d));
  R.check(`[B ${surface}] L2 delete of ${surface === 'web' ? 'ARCHIVED' : 'CLOSED'} Session completes with zero Harness calls`, dw.json.status === 'completed' && L.tapFor2(target, t1).length === 0 && (await L.sessRow(target)).status === 'DELETED', { op: drow, wire: L.tapFor2(target, t1) });
}

// ---- C. fence while DELETING (hold the lifecycle detach 8 s at the tap) ----
if (l3) {
  for (const surface of ['public', 'web']) {
    const s = await mk(surface, `G_WRITE name=fence-${surface}-${Date.now()}.txt content=f`);
    await L.waitTurns(s, 1);
    L.setTapRules([{ match: `POST /session/${s}/detach`, action: 'delay', delayMs: 8000, times: 1 }]);
    const d = await L.del(surface, s, { key: 'fence-key-' + s });
    const op = L.opIdOf(surface, d);
    await L.sleep(1200);
    const mid = await L.sessRow(s);
    const inp = await L.sendInput(s, 'PLAIN during delete');
    const warm = await L.warm(s);
    const close2 = await L.closeS(surface, s);
    const del2 = await L.del(surface, s);
    const replay = await L.del(surface, s, { key: 'fence-key-' + s });
    const readMid = await L.read(surface, s);
    R.check(`[C ${surface}] Session DELETING while detach is held`, mid.status === 'DELETING', mid.status);
    R.check(`[C ${surface}] ordinary input refused during DELETING`, inp.status === 409, `${inp.status} ${L.code(inp)}`);
    R.check(`[C ${surface}] Broker warm refused during DELETING`, warm.status === 409, `${warm.status} ${warm.body.slice(0, 120)}`);
    R.check(`[C ${surface}] concurrent close / new-key delete refused 409, same-key replay returns the same operation`, close2.status === 409 && del2.status === 409 && L.opIdOf(surface, replay) === op, `close=${close2.status} ${L.code(close2)} del=${del2.status} ${L.code(del2)} replay=${replay.status} ${L.opIdOf(surface, replay) === op}`);
    R.note(`[C ${surface}] read while DELETING`, `${readMid.status} ${readMid.json.status ?? ''} caps=${L.j(L.caps(surface, readMid))}`);
    const w = await L.waitOp(surface, s, op, 60_000);
    R.check(`[C ${surface}] operation completes after the held detach is released`, w.json.status === 'completed', `${w.json.status} after ${w.waited} ms`);
    L.setTapRules([]);
  }
}

// ---- D. empty / never-initialized Session (no first input) ----
{
  const c = await L.api('POST', '/v1/agents/sessions', { agent_id: 'qwen-code', workspace: { workspace_id: 'ws-a', cwd_relative: 'child' } }, { key: L.uid('empty') });
  const s = c.json.id ?? c.json.sessionId;
  R.note('[D] create without input', `${c.status} ${L.code(c)} session=${s} status=${s ? (await L.sessRow(s))?.status : ''}`);
  if (s && c.status < 300) {
    const t0 = L.tapLen();
    const r = await L.read('public', s);
    const d = await L.del('public', s);
    if (l3) {
      const w = await L.waitOp('public', s, L.opIdOf('public', d));
      R.check('[D] empty ACTIVE Session deletes (never-initialized evidence)', d.status === 202 && w.json.status === 'completed', { caps: L.caps('public', r), del: d.status, op: w.json.status, row: await L.opRow(L.opIdOf('public', d)), wire: L.tapFor2(s, t0), bindings: (await L.bindings(s)).length });
    } else R.note('[D] base empty Session delete', `${d.status} ${L.code(d)}`);
  }
}
R.done();
await L.closeDb();
