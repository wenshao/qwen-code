import * as L from './lib.mjs';
const sc = L.scenario('head', 's13');
for (let i = 0; i < 2; i++) L.qwen(sc, ['--bg', `BGWRITE:${L.path.join(sc.cwd, `r${i}.txt`)}`]);
await L.sleep(15000);
const rows = L.scenarioPids(sc).map((p) => {
  const st = L.readFileSync(`/proc/${p.pid}/status`, 'utf8');
  return { role: L.role(p), pid: p.pid, rssMB: Math.round(Number(/VmRSS:\s+(\d+)/.exec(st)[1]) / 1024) };
});
console.log(JSON.stringify(rows));
L.writeFileSync('/root/verify/pr10943/results/s13-rss.json', JSON.stringify(rows, null, 1));
L.killScenario(sc);
process.exit(0);
