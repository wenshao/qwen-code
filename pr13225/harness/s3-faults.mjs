// S3 (PR #13225): collector under storage faults, through the public lifecycle on the Linux durable stack.
// CASE=del500 | delreset | versioning | crash | multipage
import * as L from './lib.mjs';
import { execFileSync } from 'node:child_process';
const CASE = process.env.CASE;
const TAG = process.env.TAG ?? `s3-${CASE}-${Date.now().toString(36)}`;
const SO = Number(process.env.SO ?? 6 * 1024 * 1024 + 11);
L.openLog(TAG);
const LXX = '/Users/wenshao/pr13225-rig/lxx.sh';
const lx = (cmd) => execFileSync(LXX, [cmd], { encoding: 'utf8' }).trim();
async function lifecycle(session, kind, method, url) {
  const r = await L.api(method, url, undefined, { key: `${kind}-${TAG}` });
  const opId = r.json?.operation?.id ?? r.json?.id;
  let op = r.json;
  for (let i = 0; i < 240 && r.status < 300; i++) {
    op = (await L.api('GET', `/v1/agents/sessions/${session}/operations/${opId}`)).json;
    if (/completed|failed/i.test(String(op?.status ?? ''))) break;
    await L.sleep(250);
  }
  return `${r.status}${r.json?.error?.code ? '/' + r.json.error.code : ''} op=${op?.status}`;
}
const dbNow = () => Number(L.one('SELECT ROUND(UNIX_TIMESTAMP(NOW(3))*1000)'));
const tenantHeld = () => +L.one(`SELECT IFNULL(SUM(capture_held_bytes+producer_held_bytes+admission_held_bytes),0) FROM qwen_tool_publication WHERE tenant_id='${L.TENANT}'`);
const pubRow = (s) => { const r = L.sql(`SELECT publication_id, retention_state, IFNULL(gc_blocker,'-'), gc_generation, IFNULL(LEFT(gc_owner,8),'-'), gc_cursor, capture_held_bytes+producer_held_bytes+admission_held_bytes, IFNULL(released_held_bytes,'-'), gc_next_at, IFNULL(gc_claim_until,0) FROM qwen_tool_publication WHERE session_id='${s}'`)[0];
  return { id: r[0], state: r[1], blocker: r[2], gen: +r[3], owner: r[4], cursor: r[5], held: +r[6], released: r[7], next: +r[8], claimUntil: +r[9] }; };
const keys = (pubId) => L.sql(`SELECT object_key FROM qwen_tool_publication_object WHERE publication_id='${pubId}' AND object_key IS NOT NULL ORDER BY slot_key`).map((r) => r[0]);

const ws = `ws-${TAG}`; L.register(ws, process.env.ST ?? 'st-s21');
const t00 = Date.now();
const S = await L.createShellSession(ws, L.shellPrompt('s3', L.genCmd(`${TAG}`, SO, 0, 0)), { key: `k-${TAG}` });
const turn = await L.waitTurn(S, { timeoutMs: 900_000 }); const proj = await L.waitProjection(S, { timeoutMs: 600_000 });
const p0 = pubRow(S); const K = keys(p0.id);
L.say('made', { session: S, turn: turn.status, results: proj.rows.map((r) => r.state), publication: p0.id, ossKeys: K.length, held: p0.held, ms: Date.now() - t00 });
L.say('close', await lifecycle(S, 'close', 'POST', `/v1/agents/sessions/${S}/close`));

// arm the fault (fake OSS faults match on a key substring: the publication id)
if (CASE === 'del500') L.say('fault', await L.oss('/fault', { op: 'delete', mode: 'status', status: 500, code: 'InternalError', count: 1, skip: 4, match: p0.id }));
if (CASE === 'delreset') L.say('fault', await L.oss('/fault', { op: 'delete', mode: 'reset', count: 1, skip: 4, match: p0.id }));
if (CASE === 'versioning') L.say('versioning', await L.oss('/versioning', { status: process.env.VSTATE ?? 'Enabled' }));
if (CASE === 'crash') L.say('fault', await L.oss('/fault', { op: 'delete', mode: 'hold', count: 1, skip: 4, match: p0.id }));
const heldBefore = tenantHeld();
const ledger0 = Date.now();
L.say('delete', await lifecycle(S, 'delete', 'DELETE', `/v1/agents/sessions/${S}`));
const retiredAt = Number(L.retirement(S)[2]);

let last = '', crashed = false, restored = false;
const watchEnd = Date.now() + Number(process.env.WATCH_S ?? 200) * 1000;
const timeline = [];
for (;;) {
  const p = pubRow(S); const now = dbNow();
  const k = `${p.state} g${p.gen} owner=${p.owner} ${p.blocker} cursor=${p.cursor ? p.cursor.slice(0, 22) : '-'} held=${p.held} oss=${K.filter(L.ossHas).length}/${K.length}`;
  if (k !== last) { const row = `+${((now - retiredAt) / 1000).toFixed(1)}s ${k}${p.next > now ? ` next+${((p.next - now) / 1000).toFixed(0)}s` : ''}`; timeline.push(row); L.say('watch', row); last = k; }
  if (CASE === 'crash' && !crashed && (await L.oss('/held')).length) {
    const pid = lx('cat /var/rig/run/lx1/spring.pid');
    lx(`kill -9 ${pid}`); crashed = true;
    L.say('crash', { springPid: pid, at: `+${((dbNow() - retiredAt) / 1000).toFixed(1)}s`, claimUntilIn: `${((pubRow(S).claimUntil - dbNow()) / 1000).toFixed(1)}s` });
    await L.oss('/release', {});
    L.say('restart', lx('cd /tmp && GC=true GRACE=10s /Users/wenshao/pr13225-rig/lx/spring.sh merge34 lx1 | tail -1'));
  }
  if (CASE === 'versioning' && !restored && now - retiredAt > Number(process.env.RESTORE_AFTER_S ?? 75) * 1000) {
    L.say('versioning', await L.oss('/versioning', { status: 'none' })); restored = true;
  }
  if (p.state === 'COLLECTED' || Date.now() > watchEnd) break;
  await L.sleep(150);
}
const ledger = (await L.ossLedger()).filter((e) => e.t >= ledger0);
const dels = ledger.filter((e) => e.method === 'DELETE' && e.key.includes(p0.id));
const per = new Map(); for (const d of dels) per.set(d.key, [...(per.get(d.key) ?? []), d.status]);
const multi = [...per.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${K.indexOf(k)}:${v.join(',')}`);
L.say('ledger', { deleteRequests: dels.length, distinctKeys: per.size, keysWithMoreThanOne: multi, versioningProbes: ledger.filter((e) => e.query === '?versioning').length, faultStatuses: [...new Set(dels.map((d) => d.status))] });
const pf = pubRow(S);
L.say('final', { state: pf.state, gen: pf.gen, held: pf.held, released: pf.released, heldOriginally: p0.held, tenantHeldDelta: heldBefore - tenantHeld(), ossLeft: K.filter(L.ossHas).length });
L.out(`${TAG}.json`, { CASE, session: S, publication: p0.id, timeline, ledger: dels.map((d) => ({ t: d.t - ledger0, i: K.indexOf(d.key), status: d.status })) });
