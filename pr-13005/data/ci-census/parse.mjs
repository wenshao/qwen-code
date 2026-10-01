// Parse downloaded main E2E job logs for the two monitor.test.ts cases.
import fs from 'node:fs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const jobs = fs.readFileSync('/root/verify/pr13005/ci-census/jobs-post13002.txt', 'utf8').trim().split('\n').map((l) => {
  const [run, created, sha, event, job, concl, ...name] = l.split(' ');
  return { run, created, sha, event, job, concl, name: name.join(' ') };
});
const rows = [];
for (const j of jobs) {
  const f = `/root/verify/pr13005/ci-census/logs/${j.job}.log`;
  if (!fs.existsSync(f)) continue;
  const text = strip(fs.readFileSync(f, 'utf8'));
  const grab = (title) => {
    const re = new RegExp(`([✓×↓]) monitor-tool > ${title}\\s+(\\d+)ms(?:\\s+\\(retry x(\\d)\\))?`, 'g');
    const all = [...text.matchAll(re)];
    if (!all.length) return null;
    const m = all[all.length - 1];
    return { ok: m[1] === '✓', ms: Number(m[2]), retries: m[3] ? Number(m[3]) : 0 };
  };
  const call = grab('should call monitor tool when asked to watch a command');
  const reg = grab('should have monitor tool registered');
  const failLines = [...text.matchAll(/FAIL\s+cli\/monitor\.test\.ts[^\n]*/g)].map((m) => m[0].slice(0, 200));
  if (!call && !reg) continue;
  rows.push({ ...j, call, reg, failLines: [...new Set(failLines)] });
}
fs.writeFileSync('/root/verify/pr13005/ci-census/monitor-census.json', JSON.stringify(rows, null, 2));
const leg = (n) => (n.includes('macOS') ? 'macOS' : n.includes('docker') ? 'docker' : 'none');
const stats = {};
for (const r of rows) {
  for (const [k, v] of [['call', r.call], ['registered', r.reg]]) {
    if (!v) continue;
    const key = `${leg(r.name)}:${k}`;
    (stats[key] ??= []).push(v);
  }
}
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
for (const [k, list] of Object.entries(stats).sort()) {
  const ms = list.map((v) => v.ms).sort((a, b) => a - b);
  const retried = list.filter((v) => v.retries > 0).length;
  const failed = list.filter((v) => !v.ok).length;
  console.log(
    `${k.padEnd(18)} n=${String(list.length).padStart(3)} p50=${(pct(ms, 50) / 1000).toFixed(1)}s p90=${(pct(ms, 90) / 1000).toFixed(1)}s max=${(ms[ms.length - 1] / 1000).toFixed(1)}s retried=${retried} failed=${failed}`,
  );
}
for (const r of rows) if ((r.call && (r.call.retries || !r.call.ok)) || (r.reg && (r.reg.retries || !r.reg.ok)) || r.failLines.length)
  console.log('  !', r.run, r.created, leg(r.name), JSON.stringify({ call: r.call, reg: r.reg }), r.failLines.join(' | '));
