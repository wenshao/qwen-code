// S14: W1a cold-load validation on Sessions that use O2 remote Shell publication (main #12894): Shell profile + captureBytes,
// output pages and seals in SQL, segments in object storage (the OSS double), receipts committed by the Java store.
// Each case: one Session runs one Shell Turn (3,000,001 bytes of stdout in 3 segments, empty stderr), detaches, one stored
// artifact is damaged, then the Session is cold loaded without a profile. ARM=base runs main 3a8fd11711 for comparison
// (the base Harness needs the profile and captureBytes on load).
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head'; const ONLY = process.env.ONLY?.split(',');
L.openLog(`s14-o2-${ARM}`);
const { say } = L; const R = '/srv/w1a'; const CAP = 16 * 1024 * 1024;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig(`s14-${ARM}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const term = (r) => r.terminal?.map((t) => `${t.type}${t.type === 'turn_error' ? ` ${JSON.stringify(t.data).slice(0, 120)}` : ''}`).join(',') || `<admit ${r.status} ${JSON.stringify(r.json ?? {}).slice(0, 120)}>`;
const out = (r) => { for (const t of L.toolTrace(r.events)) if (t.startsWith('result')) return t.replace(/\\n/g, ' ').replace(/x{20,}/g, 'x…').slice(0, 200); return '<no tool result>'; };
const load = (S, cap = CAP) => (ARM === 'base' ? S.load(L.SHELL, undefined, { captureBytes: cap }) : S.load());
const sqlExec = (q) => L.sql(q);
const scope = (p) => `publication_id='${p.id}'`;
const calls = (n) => { try { return fs.readFileSync(`${R}/a/project/.calls-${n}`, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const ossGets = async (t0) => { const l = (await L.oss(`/ledger?since=${t0}`)).filter((e) => e.method === 'GET' && e.key); return `${l.length} object GETs, ${l.reduce((a, e) => a + (e.bytes || 0), 0)} bytes`; };

const CASES = [
  { id: 'control', what: 'nothing damaged', damage: async () => 'none' },
  { id: 'segment-flip', what: 'one bit flipped in an OSS segment (segment:stdout:1)', damage: async (p, o) => `corrupted ${JSON.stringify(await L.oss('/corrupt', { key: o.find((x) => x.slot === 'segment:stdout:1').objectKey })).slice(0, 80)}` },
  { id: 'segment-missing', what: 'an OSS segment object deleted (segment:stdout:2)', damage: async (p, o) => `deleted ${JSON.stringify(await L.oss('/delete', { key: o.find((x) => x.slot === 'segment:stdout:2').objectKey }))}` },
  { id: 'page-tamper', what: 'SQL page row: one byte of page:stdout:0 changed', damage: async (p) => { sqlExec(`UPDATE qwen_tool_publication_object SET inline_bytes=INSERT(inline_bytes, 20, 1, CHAR(ASCII(SUBSTRING(inline_bytes, 20, 1)) ^ 1)) WHERE ${scope(p)} AND slot_key='page:stdout:0'`); return 'page byte 20 xor 1'; } },
  { id: 'page-missing', what: 'SQL page row deleted (page:stdout:0)', damage: async (p) => { sqlExec(`DELETE FROM qwen_tool_publication_object WHERE ${scope(p)} AND slot_key='page:stdout:0'`); return 'row deleted'; } },
  { id: 'seal-count', what: 'SQL seal for stdout: segment_count 3 -> 2', damage: async (p) => { sqlExec(`UPDATE qwen_tool_publication_seal SET segment_count=2 WHERE ${scope(p)} AND stream_id='stdout'`); return 'segment_count=2'; } },
  { id: 'seal-digest', what: 'SQL seal for stdout: digest changed', damage: async (p) => { sqlExec(`UPDATE qwen_tool_publication_seal SET sha256=REPEAT('0',64) WHERE ${scope(p)} AND stream_id='stdout'`); return 'sha256=000…'; } },
  { id: 'empty-seal-missing', what: 'SQL seal of the empty stream (stderr, 0 segments) deleted', damage: async (p) => { sqlExec(`DELETE FROM qwen_tool_publication_seal WHERE ${scope(p)} AND stream_id='stderr'`); return 'row deleted'; } },
  { id: 'manifest-tamper', what: 'SQL manifest row: one byte changed', damage: async (p) => { sqlExec(`UPDATE qwen_tool_publication_object SET inline_bytes=INSERT(inline_bytes, 40, 1, CHAR(ASCII(SUBSTRING(inline_bytes, 40, 1)) ^ 1)) WHERE ${scope(p)} AND slot_key='manifest:1'`); return 'manifest byte 40 xor 1'; } },
  { id: 'outcome-flip', what: 'the original outcome object (admission, in OSS) has one bit flipped', damage: async (p, o) => `corrupted ${JSON.stringify(await L.oss('/corrupt', { key: o.find((x) => x.slot === 'admission').objectKey })).slice(0, 80)}` },
  { id: 'not-referenced', what: 'publication row: producer_phase REFERENCED -> FINISHED', damage: async (p) => { sqlExec(`UPDATE qwen_tool_publication SET producer_phase='FINISHED' WHERE ${scope(p)}`); return 'phase=FINISHED'; } },
  { id: 'partial-capture', what: 'valid but incomplete capture: captureBytes 1 MiB, 3 MB of output', cap: 1024 * 1024, damage: async () => 'none (the capture itself stopped at the limit)' },
];
const rows = [];
let n = 0;
for (const c of CASES) {
  n++; if (ONLY && !ONLY.includes(c.id)) continue;
  const cap = c.cap ?? CAP;
  say(`== ${c.id}: ${c.what}`);
  const S = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
  const cr = await S.create(L.SHELL, { captureBytes: cap }); if (cr.status !== 200) { say(`   create ${cr.status} ${JSON.stringify(cr.json)}`); continue; }
  let r = await S.prompt(L.o2sh(`echo run >> .calls-${n}; head -c 3000000 /dev/zero | tr "\\0" x; echo`));
  const p = L.publications(S.sessionId)[0]; const o = p ? L.pubObjects(p.id) : [];
  say(`   Turn 1: ${term(r)} | ${out(r)}`);
  say(`   stored: ${p ? `publication ${p.phase}, ${o.filter((x) => x.slot.startsWith('segment')).length} segments, ${o.filter((x) => x.slot.startsWith('page')).length} pages, seals ${L.pubSeals(p.id).map((s) => `${s.stream}=${s.segments}/${s.length}`).join(' ')}` : 'no publication row'}`);
  const st = await S.status(); await S.detach();
  const d = p ? await c.damage(p, o) : 'n/a'; say(`   damage: ${d}`);
  mark = rig.proxy.ledger.length; const m0 = rig.model.state.calls; const t0 = Date.now();
  const l = await load(S, cap);
  const verdict = l.status === 200 ? 'LOADED' : `REFUSED ${l.status} ${l.json?.code ?? ''}`;
  say(`   cold load: ${verdict} in ${l.ms} ms | model calls ${rig.model.state.calls - m0} | broker: ${since()} | OSS: ${await ossGets(t0)}`);
  let next = '-';
  if (l.status === 200) {
    r = await S.prompt(L.o2sh('echo next-turn')); next = `${term(r)} | ${out(r).slice(0, 110)}`;
    say(`   next Shell Turn: ${next} | model saw ${rig.model.state.log.at(-1)?.toolResults} tool results | broker: ${since()}`);
    await S.detach();
  }
  const p2 = p ? L.publications(S.sessionId)[0] : null;
  say(`   afterwards: first command effects=${calls(n)} (1 = not repeated); publication phase=${p2?.phase} quarantined=${p2?.quarantined}; blocked before detach=${st?.recoveryBlocked}`);
  rows.push({ id: c.id, what: c.what, turn1: term(r), verdict, ms: l.ms, next, effects: calls(n), quarantined: p2?.quarantined });
}
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(20)} ${x.verdict.padEnd(44)} ${String(x.ms).padStart(6)} ms  effects=${x.effects}  ${x.verdict === 'LOADED' ? `next: ${x.next.slice(0, 60)}` : ''}`);
fs.writeFileSync(`${L.OUT}/s14-o2-${ARM}.json`, JSON.stringify(rows, null, 1));
await rig.stop(); say('S14-DONE');
