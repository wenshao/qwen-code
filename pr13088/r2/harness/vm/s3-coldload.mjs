// S3: strict retained-history validation at cold load, against the real MySQL Session Store.
//   MODE=kinds  one fresh Shell Session per resource kind: make one resource of that kind unavailable, cold load,
//               (if the load succeeds) send the next input; then repair, load and run the next Turn.  ARM=base|head
//   MODE=sweep  one Session; every retained resource in turn is made unavailable / emptied / bit-flipped; cold load only.
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head';
const MODE = process.env.MODE ?? 'kinds';
L.openLog(`s3-coldload-${MODE}-${process.env.TAG ?? ARM}`);
const { say } = L;
const PROFILE = ARM === 'base' ? L.SHELL : undefined;
say(L.hostFacts()); say(`arm=${ARM} mode=${MODE} |`, L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig(`s3-${MODE}-${process.env.TAG ?? ARM}`, process.env.HDIST ? { dist: process.env.HDIST } : {});
if (process.env.HDIST) say(`Harness bundle: ${process.env.HDIST}`);
const CMD1 = 'echo "call $(date +%s.%N)" >> .calls; seq 1 200; echo warn-on-stderr >&2';
const CMD2 = 'echo "call $(date +%s.%N)" >> .calls; echo only-stdout';   // empty stderr: its seal is still required
const calls = () => { try { return fs.readFileSync('/srv/w1a/a/project/.calls', 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const resources = (sid) => L.sql(`SELECT resource_id, kind, byte_length, DATE_FORMAT(created_at,'%H:%i:%s.%f') FROM qwen_managed_session_resource WHERE session_id='${sid}' ORDER BY created_at, resource_id`)
  .map(([id, kind, bytes, at]) => ({ id, kind, bytes: Number(bytes), at }));
async function freshSession() {
  const s = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
  const c = await s.create(L.SHELL); if (c.status !== 200) throw new Error(`create ${c.status}`);
  let r = await s.prompt(L.shell64(CMD1)); if (r.terminal?.[0]?.type !== 'turn_complete') throw new Error(`turn 1: ${L.turnStr(r)}`);
  r = await s.prompt(L.shell64(CMD2)); if (r.terminal?.[0]?.type !== 'turn_complete') throw new Error(`turn 2: ${L.turnStr(r)}`);
  await s.title('Renamed Shell Workspace');
  if (process.env.TWO_TITLES) await s.title('Renamed twice');
  await s.detach();
  return s;
}
const where = (sid, id) => `session_id='${sid}' AND resource_id='${id}'`;
const damage = {
  missing: (sid, id) => { L.sql(`UPDATE qwen_managed_session_resource SET resource_id=CONCAT(resource_id,'~gone') WHERE ${where(sid, id)}`); return () => L.sql(`UPDATE qwen_managed_session_resource SET resource_id='${id}' WHERE session_id='${sid}' AND resource_id='${id}~gone'`); },
  emptied: (sid, id) => { const hex = L.one(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE ${where(sid, id)}`) ?? ''; L.sql(`UPDATE qwen_managed_session_resource SET inline_bytes='' WHERE ${where(sid, id)}`); return () => L.sql(`UPDATE qwen_managed_session_resource SET inline_bytes=UNHEX('${hex}') WHERE ${where(sid, id)}`); },
  flipped: (sid, id) => { const hex = L.one(`SELECT HEX(inline_bytes) FROM qwen_managed_session_resource WHERE ${where(sid, id)}`) ?? ''; if (hex.length < 2) return null;
    const b = (parseInt(hex.slice(-2), 16) ^ 0x01).toString(16).padStart(2, '0'); L.sql(`UPDATE qwen_managed_session_resource SET inline_bytes=UNHEX('${hex.slice(0, -2)}${b}') WHERE ${where(sid, id)}`);
    return () => L.sql(`UPDATE qwen_managed_session_resource SET inline_bytes=UNHEX('${hex}') WHERE ${where(sid, id)}`); },
};
const head = () => L.sql(`SELECT committed_sequence FROM qwen_managed_session_journal_head WHERE session_id='%SID%'`);

if (MODE === 'kinds') {
  const probe = await freshSession();
  const kinds = [...new Set(resources(probe.sessionId).map((r) => r.kind))];
  say(`resource kinds in a 2-Turn renamed Shell Session: ${kinds.length} -> ${kinds.map((k) => k.replace('managed-', '')).join(', ')}`);
  const rows = [];
  for (const kind of kinds) {
    const s = await freshSession();
    const all = resources(s.sessionId);
    // The OLDEST resource of the kind: damage in an older settled Turn, not in the latest checkpoint.
    const target = all.find((r) => r.kind === kind);
    const undo = damage.missing(s.sessionId, target.id);
    const m0 = rig.model.state.calls; const b0 = rig.proxy.ledger.length; const c0 = calls();
    const l = await s.load(PROFILE);
    let next = '-';
    if (l.status === 200) {
      const r = await s.prompt('HISTORY', 60000);
      const st = await s.status();
      next = `${r.terminal?.map((t) => t.type).join(',') || '<no terminal event>'}${st?.recoveryBlocked ? ' recoveryBlocked' : ''}`;
      await s.detach();
    }
    const row = { kind: kind.replace('managed-', ''), of: all.filter((r) => r.kind === kind).length, bytes: target.bytes, load: `${l.status}${l.status === 200 ? '' : ' ' + (l.json?.code ?? '')}`, loadMs: l.ms, next, model: rig.model.state.calls - m0, broker: rig.proxy.ledger.length - b0, shell: calls() - c0 };
    undo();
    // Repair, then the Session must load and take its next Turn.
    const l2 = await s.load(PROFILE); let after = `load ${l2.status}${l2.status === 200 ? '' : ' ' + (l2.json?.code ?? '')}`;
    if (l2.status === 200) { const r2 = await s.prompt(L.shell64(CMD2), 60000); after += `, next Shell Turn ${r2.terminal?.map((t) => t.type).join(',') || '<none>'}`; await s.detach(); }
    row.after = after; rows.push(row);
    say(`${row.kind.padEnd(22)} (oldest of ${String(row.of).padStart(2)}, ${String(row.bytes).padStart(5)} B) unavailable -> load ${row.load.padEnd(34)} ${String(row.loadMs).padStart(5)} ms | next input: ${row.next.padEnd(30)} | model +${row.model} Broker +${row.broker} Shell +${row.shell} | repaired: ${row.after}`);
  }
  fs.writeFileSync(`${L.OUT}/s3-kinds-${ARM}.json`, JSON.stringify(rows, null, 1));
  const refusedAtLoad = rows.filter((r) => !r.load.startsWith('200')).length;
  say(`== ${ARM}: ${refusedAtLoad}/${rows.length} kinds refused at load; ${rows.filter((r) => r.load.startsWith('200')).length} loaded with a missing resource (of those, next input failed: ${rows.filter((r) => r.load.startsWith('200') && !r.next.startsWith('turn_complete')).length}, next input completed: ${rows.filter((r) => r.load.startsWith('200') && r.next.startsWith('turn_complete')).length})`);
} else {
  const s = await freshSession();
  const all = resources(s.sessionId);
  say(`Session ${s.sessionId}: ${all.length} retained resources, ${all.reduce((a, r) => a + r.bytes, 0)} bytes`);
  const l0 = await s.load(); say(`control load: ${l0.status} ${l0.ms} ms`); await s.detach();
  const tally = {}; const surprises = [];
  const m0 = rig.model.state.calls; const b0 = rig.proxy.ledger.length; const c0 = calls(); const t0 = Date.now();
  for (const how of ['missing', 'emptied', 'flipped']) {
    for (const r of all) {
      const undo = damage[how](s.sessionId, r.id); if (!undo) continue;
      const l = await s.load();
      const k = `${how} ${r.kind.replace('managed-', '')}`; tally[k] ??= { refused: 0, loaded: 0, codes: new Set() };
      if (l.status === 200) { tally[k].loaded += 1; surprises.push(`${how} ${r.kind} ${r.id.slice(0, 12)} (${r.bytes} B, created ${r.at}) -> load 200`); await s.detach(); }
      else { tally[k].refused += 1; tally[k].codes.add(`${l.status} ${l.json?.code}`); }
      undo();
    }
  }
  for (const [k, v] of Object.entries(tally)) say(`${k.padEnd(34)} refused ${String(v.refused).padStart(2)} / ${String(v.refused + v.loaded).padStart(2)}   ${[...v.codes].join(' | ')}`);
  const tot = Object.values(tally).reduce((a, v) => ({ r: a.r + v.refused, n: a.n + v.refused + v.loaded }), { r: 0, n: 0 });
  say(`== sweep: ${tot.r}/${tot.n} damaged loads refused in ${Math.round((Date.now() - t0) / 1000)} s; model calls +${rig.model.state.calls - m0}, Broker calls +${rig.proxy.ledger.length - b0}, Shell runs +${calls() - c0}`);
  for (const x of surprises) say('   loaded despite damage:', x);
  const after = resources(s.sessionId);
  say(`resources after the sweep: ${after.length} (+${after.length - all.length}); new kinds: ${[...new Set(after.slice(all.length).map((r) => r.kind))].join(', ') || 'none'}`);
  const l2 = await s.load(); say(`everything repaired: load ${l2.status} ${l2.ms} ms`);
  if (l2.status === 200) { const r2 = await s.prompt(L.shell64(CMD2), 60000); say('   next Shell Turn:', L.turnStr(r2).slice(0, 100)); await s.detach(); }
  fs.writeFileSync(`${L.OUT}/s3-sweep-${process.env.TAG ?? ARM}.json`, JSON.stringify({ tally: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, { ...v, codes: [...v.codes] }])), surprises }, null, 1));
}
await rig.stop(); say('S3-DONE');
