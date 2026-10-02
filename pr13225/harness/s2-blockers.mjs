// S2 (PR #13225): blockers and siblings through the public lifecycle (Linux durable stack).
//   Q: one Session, two Shell calls in one Turn = two publications. One OSS object of pub#1 is corrupted
//      and a public download detects it (production quarantine). After close+DELETE: pub#1 must stay
//      (quarantined, objects + quota kept), pub#2 (same Session) must be collected.
//   R: a live read lease (as a crashed reader on another instance would leave) -> reader_active, then
//      collected once the lease has expired.
//   P: journal recovery not READY at deletion -> recovery_protected; never collected.
//   W: write_evidence = FALSE (a pre-upgrade publication) -> legacy_write_evidence_missing; never collected.
import * as L from './lib.mjs';
const TAG = process.env.TAG ?? `s2-${Date.now().toString(36)}`;
const SO = Number(process.env.SO ?? 6 * 1024 * 1024 + 11);
L.openLog(TAG);
const sh2 = (label, a, b) => `${label} [O3_SH2:${L.b64(a)}:${L.b64(b)}]`;
async function lifecycle(session, kind, method, url) {
  const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}-${session.slice(0, 8)}` });
  const opId = r.json?.operation?.id ?? r.json?.id;
  let op = r.json;
  for (let i = 0; i < 480 && r.status < 300; i++) {
    op = (await L.api('GET', `/v1/agents/sessions/${session}/operations/${opId}`)).json;
    if (/completed|failed/i.test(String(op?.status ?? ''))) break;
    await L.sleep(250);
  }
  return `${r.status}${r.json?.error?.code ? '/' + r.json.error.code : ''} op=${op?.status}`;
}
const pubs = (s) => L.sql(`SELECT publication_id, retention_state, IFNULL(gc_blocker,'-'), capture_held_bytes+producer_held_bytes+admission_held_bytes, quarantined, write_evidence, gc_generation FROM qwen_tool_publication WHERE session_id='${s}' ORDER BY publication_id`)
  .map((r) => ({ id: r[0].slice(0, 8), full: r[0], state: r[1], blocker: r[2], held: +r[3], quarantined: r[4] === '1', evidence: r[5] === '1', gen: +r[6] }));
const keysOf = (pub) => L.sql(`SELECT object_key FROM qwen_tool_publication_object WHERE publication_id='${pub}' AND object_key IS NOT NULL`).map((r) => r[0]);
const present = (pub) => keysOf(pub).filter((k) => L.ossHas(k)).length;
const tenantHeld = () => +L.one(`SELECT IFNULL(SUM(capture_held_bytes+producer_held_bytes+admission_held_bytes),0) FROM qwen_tool_publication WHERE tenant_id='${L.TENANT}'`);
async function shellSession(name, storage, prompt) {
  const ws = `ws-${TAG}-${name}`;
  L.register(ws, storage);
  const s = await L.createShellSession(ws, prompt, { key: `k-${TAG}-${name}` });
  const t = await L.waitTurn(s, { timeoutMs: 600_000 });
  const p = await L.waitProjection(s, { timeoutMs: 300_000, count: prompt.includes('O3_SH2') ? 2 : 1 });
  L.say(`made-${name}`, { session: s, turn: t.status, results: p.rows.map((r) => r.state), pubs: pubs(s).map((x) => `${x.id} ${x.state} held=${x.held}`) });
  return s;
}
const Q = await shellSession('Q', process.env.ST_Q ?? 'st-s11', sh2('s2q', L.genCmd(`${TAG}-q1`, SO, 0, 0), L.genCmd(`${TAG}-q2`, SO, 0, 0)));
const Rs = await shellSession('R', process.env.ST_R ?? 'st-s12', L.shellPrompt('s2r', L.genCmd(`${TAG}-r`, SO, 0, 0)));
const P = await shellSession('P', process.env.ST_P ?? 'st-s13', L.shellPrompt('s2p', L.genCmd(`${TAG}-p`, SO, 0, 0)));
const W = await shellSession('W', process.env.ST_W ?? 'st-s14', L.shellPrompt('s2w', L.genCmd(`${TAG}-w`, SO, 0, 0)));

// Q: corrupt one stored object of the FIRST publication, then let a public download detect it.
const [q1, q2] = pubs(Q);
const arts = (await L.artifacts(Q)).list.filter((a) => a.stream_role === 'stdout');
const victimKey = keysOf(q1.full)[0];
L.say('corrupt', await L.oss('/corrupt', { key: victimKey }));
const reads = [];
for (const a of arts) {
  const r = await L.content(Q, a.id, { revision: a.revision });
  reads.push(`${a.id.slice(0, 12)} -> ${r.status}${r.code ? '/' + r.code : ''}`);
}
L.say('detect', { reads, pubs: pubs(Q).map((x) => `${x.id} quarantined=${x.quarantined}`) });

// P: journal recovery not READY when the Session is deleted (the retirement records recovery_protected).
L.sql(`UPDATE qwen_managed_session_journal_head SET recovery_status='BLOCKED' WHERE session_id='${P}'`);
// W: a publication written before write evidence existed.
L.sql(`UPDATE qwen_tool_publication SET write_evidence=FALSE WHERE session_id='${W}'`);

const heldBefore = tenantHeld();
for (const [n, s] of [['Q', Q], ['R', Rs], ['P', P], ['W', W]]) {
  const c = await lifecycle(s, 'close', 'POST', `/v1/agents/sessions/${s}/close`);
  const d = await lifecycle(s, 'delete', 'DELETE', `/v1/agents/sessions/${s}`);
  L.say(`lifecycle-${n}`, { close: c, delete: d, retirement: L.retirement(s) });
  if (n === 'R') {
    // a crashed reader elsewhere: lease row live for 40 s more (same shape ReadLease inserts)
    const now = Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)'));
    L.sql(`INSERT INTO qwen_output_read_lease (lease_id, tenant_key, session_key, retirement_generation, expires_at) VALUES (UUID(), SHA2('${L.TENANT}',256), SHA2('${s}',256), 0, ${now + 40_000})`);
  }
}
const t0 = Date.now();
const snap = () => ({
  Q: pubs(Q).map((x) => `${x.id} ${x.state} ${x.blocker} held=${x.held} oss=${present(x.full)}/${keysOf(x.full).length}`),
  R: pubs(Rs).map((x) => `${x.id} ${x.state} ${x.blocker} held=${x.held} oss=${present(x.full)}/${keysOf(x.full).length}`),
  P: pubs(P).map((x) => `${x.id} ${x.state} ${x.blocker} held=${x.held} oss=${present(x.full)}/${keysOf(x.full).length}`),
  W: pubs(W).map((x) => `${x.id} ${x.state} ${x.blocker} held=${x.held} oss=${present(x.full)}/${keysOf(x.full).length}`),
});
let last = '';
while (Date.now() - t0 < Number(process.env.WATCH_S ?? 150) * 1000) {
  const s = snap(); const k = JSON.stringify(s);
  if (k !== last) { L.say(`t+${((Date.now() - t0) / 1000).toFixed(1)}s`, s); last = k; }
  await L.sleep(500);
}
L.say('tenant-held', { before: heldBefore, after: tenantHeld(), q1Held: pubs(Q)[0].held });
L.say('reader-lease-left', L.one(`SELECT COUNT(*) FROM qwen_output_read_lease WHERE session_key=SHA2('${Rs}',256)`));
L.out(`${TAG}.json`, { Q, R: Rs, P, W, final: snap() });
