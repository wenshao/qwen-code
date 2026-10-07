// VERIFICATION RIG ONLY: measure the cancel/takeover-load loop in a replacement Harness log dump.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const ts = (l) => { const m = l.match(/^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/); return m ? Date.parse(m[1]) : NaN; };
  const loads = lines.filter((l) => /route=POST \/session\/\S+\/load .*status=200/.test(l)).map(ts).filter(Number.isFinite);
  const cancels = lines.filter((l) => /route=POST \/session\/\S+\/cancel .*status=409/.test(l)).map(ts).filter(Number.isFinite);
  let s2 = 0, s4 = 0, sw = 0;
  for (const l of lines.filter((x) => /access logs suppressed/.test(x))) {
    s2 += Number(l.match(/status2xx=(\d+)/)?.[1] ?? 0); s4 += Number(l.match(/status4xx=(\d+)/)?.[1] ?? 0); sw++;
  }
  const all = lines.map(ts).filter(Number.isFinite);
  const first = cancels[0] ?? all[0];
  const span = (all[all.length - 1] - first) / 1000;
  const gaps = loads.slice(1).map((t, i) => ((t - loads[i]) / 1000).toFixed(1));
  const totalLoads = loads.length + s2, totalCancels = cancels.length + s4;
  console.log(`${file.split('/').pop().slice(0, 24)} span=${span.toFixed(0)}s logged loads200=${loads.length} cancel409=${cancels.length} suppressedWindows=${sw} (+2xx ${s2} +4xx ${s4}) => loads/s=${(totalLoads / span).toFixed(2)} cancels/s=${(totalCancels / span).toFixed(2)} | load gaps(s): ${gaps.slice(0, 14).join(',')}`);
}
