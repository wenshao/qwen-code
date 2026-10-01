const fs = require('fs'), path = require('path');
const H = '/root/verify/pr12930/ci/hist';
const jobs = new Map(fs.readFileSync(H + '/alljobs.tsv', 'utf8').trim().split('\n').map((l) => { const [id, name, concl, started] = l.split('\t'); return [id, { id, name, concl, started }]; }));
const scanned = fs.readFileSync(H + '/scanjobs.tsv', 'utf8').trim().split('\n').map((l) => l.split('\t')[0]);
const out = { scanned: 0, notInShard: 0, pass: 0, flakyPass: [], fail: [], skip: 0, byLeg: {} };
const SINCE = process.env.SINCE || '2026-09-01';
for (const id of scanned) {
  if ((jobs.get(id)?.started || '') < SINCE) continue;
  const f = `${H}/res-${id}.txt`;
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, 'utf8');
  if (!txt.trim()) continue;
  out.scanned++;
  const j = jobs.get(id); const leg = j.name.startsWith('E2E Test - macOS') ? 'macOS' : 'Linux none';
  const L = (out.byLeg[leg] ??= { scanned: 0, ran: 0, pass: 0, flaky: 0, fail: 0 }); L.scanned++;
  const line = txt.split('\n').find((l) => /child-crash recovery \(real SIGKILL\) > publishes session_died/.test(l) && /[✓×↓]/.test(l));
  if (!line) { out.notInShard++; continue; }
  if (/↓/.test(line)) { out.skip++; continue; }
  L.ran++;
  const retry = (line.match(/\(retry x(\d)\)/) || [])[1];
  const rec = { id, leg, started: j.started, concl: j.concl, retry: retry ? +retry : 0, line: line.replace(/^.*?Z\s+/, '').trim().slice(0, 200) };
  if (/×/.test(line)) { out.fail.push(rec); L.fail++; }
  else if (retry) { out.flakyPass.push(rec); L.flaky++; }
  else { out.pass++; L.pass++; }
}
const dates = scanned.filter((id) => (jobs.get(id)?.started || '') >= SINCE && fs.existsSync(`${H}/res-${id}.txt`)).map((id) => jobs.get(id).started).sort();
out.window = [dates[0], dates[dates.length - 1]];
out.totalJobs = scanned.filter((id) => (jobs.get(id)?.started || '') >= SINCE).length;
console.log(JSON.stringify(out, null, 1));
