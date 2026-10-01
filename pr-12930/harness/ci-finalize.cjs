// CI history over every E2E job of every push run on main created 2026-09-15..2026-10-01T10:00Z.
const fs = require('fs');
const CI = '/root/verify/pr12930/ci', H = CI + '/hist';
const runs = fs.readFileSync(CI + '/runs-window.tsv', 'utf8').trim().split('\n').map((l) => l.split('\t'));
const jobs = [];
const unlisted = [];
for (const [rid] of runs) {
  const f = `${H}/jobs-${rid}.tsv`;
  if (!fs.existsSync(f)) { unlisted.push(rid); continue; }
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const a = l.split('\t');
    if (!/^\d+$/.test(a[0]) || /sandbox:docker/.test(a[1])) continue;
    jobs.push({ id: a[0], name: a[1], concl: a[2], started: a[3], rid });
  }
}
const leg = (j) => (j.name.startsWith('E2E Test - macOS') ? 'macOS' : 'Linux');
const S = { macOS: { ran: 0, clean: 0, retry1: 0, retry2: 0, fail: 0, cleanMs: [], retryMs: [] }, Linux: { ran: 0, clean: 0, retry1: 0, retry2: 0, fail: 0, cleanMs: [], retryMs: [] } };
let scanned = 0, notInShard = 0; const missing = [], rows = [];
for (const j of jobs) {
  const f = `${H}/res-${j.id}.txt`;
  if (!fs.existsSync(f) || !fs.statSync(f).size) { missing.push(j); rows.push([j.id, j.name, j.concl, j.started, '<log not downloaded>']); continue; }
  scanned++;
  const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => /child-crash recovery \(real SIGKILL\) > publishes session_died/.test(l) && /[✓×↓]/.test(l));
  rows.push([j.id, j.name, j.concl, j.started, line ? line.replace(/^\S+\s+/, '').trim() : '<file not in this shard>']);
  if (!line) { notInShard++; continue; }
  const s = S[leg(j)]; s.ran++;
  const retry = +((line.match(/\(retry x(\d)\)/) || [])[1] || 0);
  const ms = +((line.match(/(\d+)ms/) || [])[1] || 0);
  if (/×/.test(line)) s.fail++;
  else if (retry) { s[`retry${retry}`]++; s.retryMs.push(ms); }
  else { s.clean++; s.cleanMs.push(ms); }
}
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
for (const k of Object.keys(S)) { const s = S[k]; s.cleanP50 = q(s.cleanMs, 0.5); s.cleanP90 = q(s.cleanMs, 0.9); s.retryMin = Math.min(...s.retryMs); s.retryMax = Math.max(...s.retryMs); delete s.cleanMs; delete s.retryMs; }
const out = { runsInWindow: runs.length, runsWithoutJobListing: unlisted.length, jobs: jobs.length, scanned, notInShard, missing: missing.map((j) => `${j.id} ${j.name} ${j.concl}`), legs: S };
fs.writeFileSync(CI + '/history-final.json', JSON.stringify(out, null, 1));
fs.writeFileSync(CI + '/ci-e2e-jobs-window.tsv', ['job_id\tjob\tconclusion\tstarted_at\tsigkill_test_line', ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
console.log(JSON.stringify(out, null, 1));
