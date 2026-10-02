// s5: retention evidence + observer classification on one database (o41obs).
//   PHASE=legacy  (base jar)  one output written before O4-1
//   PHASE=make    (head jar, default 24 h grace)  upgrade checks + E/P/T/Q/K outputs, retire all, observe
//   PHASE=crash   (head jar)  throttled download of D, then SIGKILL the JVM mid-read (lease row left behind)
//   PHASE=final   (head jar, grace 0)  retire D, observe the next tick
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const PHASE = process.env.PHASE;
L.openLog(`s5-${PHASE}`);
const SF = `${L.R}/out/s5-state.json`;
const state = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : {};
const save = () => fs.writeFileSync(SF, JSON.stringify(state, null, 1));
const springLog = () => fs.readFileSync(`${L.S}/logs/${process.env.SPRING_LOG}`, 'utf8');
const ticks = () => springLog().split('\n').filter((l) => l.includes('tool_output_retention sample=')).map((l) => l.replace(/^(\S+).*tool_output_retention /, '$1 '));
async function nextTick(after) {
  const n0 = ticks().length;
  for (let i = 0; i < 150; i++) { const t = ticks(); if (t.length > n0 && Date.parse(t.at(-1).split(' ')[0]) > after) return t.at(-1); await L.sleep(1000); }
  return 'NO TICK';
}
const pub = (s) => L.pubRows(s)[0];
const make = async (name, st, cmd) => { const m = await L.makeOutput(`obs-${name}`, `ws-obs-${name}`, st, cmd); state[name] = { session: m.session, arts: m.arts.map((a) => ({ id: a.id, revision: a.revision, role: a.stream_role, bytes: a.byte_length, sha256: a.sha256 })) }; save(); L.say(`made-${name}`, { session: m.session, turn: m.turn.status, results: m.results, pub: pub(m.session) }); return m; };
if (PHASE === 'legacy') {
  await make('L', 'st-s40', L.genCmd('obsL', 1024 * 1024 + 5, 0, 0));
}
if (PHASE === 'make') {
  const l = pub(state.L.session);
  L.say('L-after-upgrade', { ...l, attempts: L.putAttempts(l.id) || 'none' });
  for (const a of state.L.arts) L.say('L-download', `${a.role} ${await L.downloadCheck(state.L.session, a, a.sha256)}`);
  await make('E', 'st-s41', L.genCmd('obsE', 2 * 1024 * 1024 + 1, 0, 0));
  // P: the reply of the first object PUT is lost after OSS stored the object; the Worker's retry succeeds
  const tp = Date.now();
  await L.oss('/fault', { op: 'put', mode: 'drop-reply', count: 1 });
  const P = await make('P', 'st-s42', L.genCmd('obsP', 3 * 1024 * 1024 + 2, 0, 0));
  const pp = pub(P.session);
  const puts = (await L.ossLedger()).filter((e) => e.t >= tp && e.method === 'PUT').map((e) => `${e.key.split('/').slice(-2).join('/')} ${e.status}`);
  L.say('P-oss-puts', puts.slice(0, 6));
  L.say('P-attempts', { attempts: L.putAttempts(pp.id), unknown: L.sql(`SELECT object_key FROM qwen_output_put_attempt WHERE publication_id='${pp.id}' AND state<>'RETURNED'`).map((r) => r[0].split('/').slice(-2).join('/')) });
  // T: capture budget 1 MiB for a 3 MiB output -> truncated capture
  fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: 1024 * 1024 }));
  const T = await make('T', 'st-s43', L.genCmd('obsT', 3 * 1024 * 1024 + 3, 0, 0));
  fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: 2 * 1024 * 1024 * 1024 }));
  L.say('T-capture', L.sql(`SELECT capture_bytes, accepted_complete FROM qwen_tool_publication WHERE session_id='${T.session}'`));
  // Q: one stored segment is corrupted after publication; the next read detects and quarantines it
  const Q = await make('Q', 'st-s44', L.genCmd('obsQ', 2 * 1024 * 1024 + 4, 0, 0));
  const qkey = L.objectKeys(Q.session).find((k) => /stdout/.test(k)) ?? L.objectKeys(Q.session)[0];
  L.say('Q-corrupt', await L.oss('/corrupt', { key: qkey }));
  const qa = state.Q.arts.find((a) => a.role === 'stdout');
  const qr = await L.content(Q.session, qa.id, { revision: qa.revision });
  L.say('Q-read', `${qr.status} ${qr.code ?? ''} bytes=${qr.body.length}; quarantined=${pub(Q.session).quarantined}`);
  // K: recovery is blocked before deletion (writer = this rig, through the internal Session Store API)
  const K = await make('K', 'st-s45', L.genCmd('obsK', 1024 * 1024 + 6, 0, 0));
  L.say('K-close', L.opSeam(K.session, 'CLOSE').split('\n').at(-1));
  const kws = L.sessionWs(K.session);
  const w = await L.acquire(K.session, kws, { leaseMillis: 2000 });
  const b = await L.storeCall('POST', K.session, 'recovery:block', { token: w.token, body: { workspaceId: kws, writerId: w.writerId, writerGeneration: w.json.writerGeneration, recoveryStatus: 'BLOCKED_RESOURCE', recoveryDetailCode: 'rig_missing_resource' } });
  L.say('K-block', `${w.status} gen=${w.json?.writerGeneration} -> ${b.status} ${JSON.stringify(b.json).slice(0, 120)}`);
  await L.sleep(3000);
  await make('D', 'st-s46', L.genCmd('obsD', 16 * 1024 * 1024, 0, 0));
  const held0 = {};
  for (const n of ['L', 'E', 'P', 'T', 'Q', 'K']) held0[n] = pub(state[n].session).held;
  const tr = Date.now();
  for (const n of ['L', 'E', 'P', 'T', 'Q', 'K']) L.say(`retire-${n}`, L.opSeam(state[n].session, 'DELETE').split('\n').at(-1).replace(/^op \S+ /, ''));
  for (const n of ['L', 'E', 'P', 'T', 'Q', 'K']) { const p = pub(state[n].session); L.say(`pub-${n}`, `${p.retention} writeEvidence=${p.writeEvidence} accepted=${p.acceptedComplete} quarantined=${p.quarantined} held ${held0[n]} -> ${p.held} root=${JSON.stringify(L.retirement(state[n].session))}`); }
  state.retiredAt = tr; save();
  L.say('tick-24h-grace', await nextTick(tr));
}
if (PHASE === 'crash') {
  const d = state.D, a = d.arts.find((x) => x.role === 'stdout');
  await L.throttle(262144);
  const progress = { bytes: 0 };
  L.streamDownload(d.session, a, { progress });
  await L.sleep(3000);
  const pid = L.springPid();
  const kids = execFileSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number);
  process.kill(pid, 'SIGKILL');
  for (const k of kids) { try { process.kill(k, 'SIGKILL'); } catch {} }
  state.crashAt = Date.now(); save();
  await L.throttle(0);
  L.say('crash', `SIGKILL Spring ${pid} with ${progress.bytes} bytes of D delivered; lease rows=${L.one(`SELECT COUNT(*) FROM qwen_output_read_lease`)} expires_in_ms=${L.one(`SELECT MAX(expires_at) - (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000) FROM qwen_output_read_lease`)}`);
  process.exit(0);
}
if (PHASE === 'final') {
  L.say('startup-tick', ticks().at(-1) ?? 'none');
  const tr = Date.now();
  L.say('retire-D', L.opSeam(state.D.session, 'DELETE').split('\n').at(-1).replace(/^op \S+ /, ''));
  L.say('D-lease', `rows=${L.one(`SELECT COUNT(*) FROM qwen_output_read_lease`)} expires_in_ms=${L.one(`SELECT MAX(expires_at) - (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000) FROM qwen_output_read_lease`)}`);
  L.say('tick-grace-0', await nextTick(tr));
  for (const n of ['L', 'E', 'P', 'T', 'Q', 'K', 'D']) { const p = pub(state[n].session); L.say(`final-${n}`, `${p.retention} held=${p.held} attempts=${L.putAttempts(p.id)}`); }
  const st = await L.ossState();
  L.say('oss', `deletes=${st.counters.delete} objects=${st.objects}`);
  await L.sleep(70_000);
  L.say('tick-after-lease-expiry', await nextTick(Date.now() - 1000));
}
