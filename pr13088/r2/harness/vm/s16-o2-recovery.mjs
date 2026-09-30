// S16: O2 original-receipt recovery together with the W1a cold-load validation.
// The Harness is killed (SIGKILL) when its Broker acknowledge for a finished Shell call arrives at the proxy: the journal has
// the original receipt, the Broker execution is not acknowledged, the Turn is unsettled. A new Harness then cold loads.
//   clean          nothing damaged          -> the original Turn must continue exactly once, the command must not run again
//   corrupt        one OSS segment bit flip -> the load must refuse before any model call or Broker prepare / execute
// ARM=base runs main 3a8fd11711 for comparison.
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head';
L.openLog(`s16-o2-recovery-${ARM}`);
const { say, sleep } = L; const R = '/srv/w1a'; const CAP = 16 * 1024 * 1024;
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a'); L.seedWs('ws-b', 'b');
const rig = await L.startRig(`s16-${ARM}`);
let mark = 0; const since = () => { const s = L.ledgerStr(rig.proxy.ledger, mark); mark = rig.proxy.ledger.length; return s; };
const load = (S) => (ARM === 'base' ? S.load(L.SHELL, undefined, { captureBytes: CAP }) : S.load());
const calls = (st, n) => { try { return fs.readFileSync(`${R}/${st}/project/.calls-${n}`, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
const rows = [];
let n = 0;
for (const [id, st, damage] of [['clean', 'a', null], ['corrupt', 'b', 'segment']]) {
  n++;
  say(`== ${id}: Harness killed at the acknowledge of a finished Shell call${damage ? '; then one bit of a stored OSS segment is flipped' : ''}`);
  const S = new L.HSession(rig.h, await L.createSession(`ws-${st}`), `ws-${st}`);
  say(`   create (Shell, captureBytes ${CAP}): ${(await S.create(L.SHELL, { captureBytes: CAP })).status}`);
  let killed = false;
  rig.proxy.state.hook = async (entry) => {
    if (!killed && /:acknowledge$/.test(entry.url)) { killed = true; await rig.h.stop('SIGKILL'); throw new Error('harness killed before the acknowledge was forwarded'); }
  };
  const sub = await S.submit(L.o2sh(`echo run >> .calls-${n}; head -c 3000000 /dev/zero | tr "\\0" x; echo`));
  for (let i = 0; i < 300 && !killed; i++) await sleep(100);
  rig.proxy.state.hook = null;
  const p = L.publications(S.sessionId)[0]; const o = p ? L.pubObjects(p.id) : [];
  const receipts = L.one(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE session_id='${S.sessionId}'`);
  say(`   prompt admitted ${sub.status}; Harness killed=${killed}; publication phase=${p?.phase} receipt_sequence=${p?.receiptSequence}; command effects=${calls(st, n)}; journal transactions=${receipts}`);
  if (damage) say(`   damage: ${JSON.stringify(await L.oss('/corrupt', { key: o.find((x) => x.slot === 'segment:stdout:1').objectKey })).slice(0, 90)}`);
  const h2 = await rig.restartHarness(`s16-${ARM}-${id}`); S.bind(h2);
  mark = rig.proxy.ledger.length; const m0 = rig.model.state.calls; const t0 = Date.now(); let l; let tries = 0;
  do { tries++; l = await load(S); if (l.status === 503) await sleep(2000); } while (l.status === 503 && Date.now() - t0 < 120000);
  say(`   new Harness, cold load: ${l.status} ${l.status === 200 ? '' : l.json?.code} after ${Math.round((Date.now() - t0) / 1000)} s, ${tries} attempts (the dead writer's lease must lapse)`);
  let terminal = '-';
  if (l.status === 200) {
    let stt; for (let i = 0; i < 600; i++) { stt = await S.status(); if (stt && !stt.hasActivePrompt) break; await sleep(100); }
    const ev = (await S.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_'));
    terminal = ev.map((e) => e.type).join(',') || '<no terminal event>';
    say(`   original Turn after the load: ${terminal}; recoveryBlocked=${stt?.recoveryBlocked}`);
  }
  say(`   model calls ${rig.model.state.calls - m0}; broker: ${since()}`);
  say(`   command effects=${calls(st, n)} (1 = not repeated); publication quarantined=${p ? L.publications(S.sessionId)[0]?.quarantined : '-'}`);
  rows.push({ id, load: l.status, code: l.json?.code, terminal, model: rig.model.state.calls - m0, effects: calls(st, n) });
  if (l.status === 200) await S.detach();
}
say('== summary');
for (const x of rows) say(`   ${x.id.padEnd(8)} load=${x.load}${x.code ? ` ${x.code}` : ''}  original Turn: ${x.terminal}  model calls=${x.model}  command effects=${x.effects}`);
fs.writeFileSync(`${L.OUT}/s16-o2-recovery-${ARM}.json`, JSON.stringify(rows, null, 1));
await rig.stop(); say('S16-DONE');
