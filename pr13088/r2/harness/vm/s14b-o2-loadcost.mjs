// S14b: what a cold load costs on an O2 Session as a function of the Shell output it retains.
// One Session per size: one Shell Turn writes N bytes to stdout, detach, cold load (no profile), count the OSS reads.
// ARM=base runs main 3a8fd11711 (profile and captureBytes passed on load).
import fs from 'node:fs';
import * as L from './lib.mjs';
const ARM = process.env.ARM ?? 'head';
L.openLog(`s14b-o2-loadcost-${ARM}`);
const { say } = L; const CAP = 1024 * 1024 * 1024;
const SIZES = (process.env.SIZES ?? '1 16 64 256').split(' ').map(Number);
say(L.hostFacts()); say(L.svc('status').replace(/\n/g, ' '));
L.seedWs('ws-a', 'a');
const rig = await L.startRig(`s14b-${ARM}`);
const term = (r) => r.terminal?.map((t) => t.type).join(',') || `<admit ${r.status}>`;
const rows = [];
for (const mib of SIZES) {
  const S = new L.HSession(rig.h, await L.createSession('ws-a'), 'ws-a');
  const cr = await S.create(L.SHELL, { captureBytes: CAP }); if (cr.status !== 200) { say(`create ${cr.status} ${JSON.stringify(cr.json)}`); continue; }
  const t1 = Date.now(); const r = await S.prompt(L.o2sh(`head -c ${mib * 1024 * 1024} /dev/zero | tr "\\0" x`), 600000); const turnMs = Date.now() - t1;
  const p = L.publications(S.sessionId)[0]; const segs = p ? L.pubObjects(p.id).filter((x) => x.slot.startsWith('segment')).length : 0;
  await S.detach();
  const samples = [];
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now(); const l = ARM === 'base' ? await S.load(L.SHELL, { timeoutMs: 600000 }, { captureBytes: CAP }) : await S.load(undefined, { timeoutMs: 600000 });
    const led = (await L.oss(`/ledger?since=${t0}`)).filter((e) => e.method === 'GET' && e.key);
    samples.push({ status: l.status, ms: l.ms, gets: led.length, bytes: led.reduce((a, e) => a + (e.bytes || 0), 0) });
    if (l.status === 200) await S.detach();
  }
  const row = { mib, turn: term(r), turnMs, segs, samples };
  rows.push(row);
  say(`${String(mib).padStart(4)} MiB stdout: Turn ${row.turn} in ${turnMs} ms, ${segs} segments | cold load ${samples.map((s) => `${s.status} in ${s.ms} ms (${s.gets} OSS GETs, ${(s.bytes / 1048576).toFixed(1)} MiB read)`).join(' ; ')}`);
}
fs.writeFileSync(`${L.OUT}/s14b-o2-loadcost-${ARM}.json`, JSON.stringify(rows, null, 1));
await rig.stop(); say('S14B-DONE');
