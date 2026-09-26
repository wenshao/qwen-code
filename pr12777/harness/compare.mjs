// Per-call comparison of the three arms: result, debug-log lines, console output.
import fs from 'node:fs';
const load = (n) => fs.readFileSync(`out-${n}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const [pre, main, pr] = ['precache', 'main', 'pr'].map(load);
const cases = Object.fromEntries(JSON.parse(fs.readFileSync(process.argv[2] ?? 'cases.json', 'utf8')).map((c) => [c.id, c]));
const views = { result: (c) => JSON.stringify(c.r), 'result+log': (c) => JSON.stringify([c.r, c.logs]), console: (c) => JSON.stringify(c.cons) };
const report = {}; const examples = {};
for (const [view, f] of Object.entries(views)) {
  const k = { calls: 0, allSame: 0, prEqMainNePre: 0, prEqPreNeMain: 0, violation: 0 };
  for (let i = 0; i < pr.length; i++) {
    for (let j = 0; j < pr[i].calls.length; j++) {
      const [a, b, c] = [pre[i].calls[j], main[i].calls[j], pr[i].calls[j]].map(f);
      k.calls++;
      let cat;
      if (a === b && b === c) cat = 'allSame';
      else if (c === b) cat = 'prEqMainNePre';
      else if (c === a) cat = 'prEqPreNeMain';
      else cat = 'violation';
      k[cat]++;
      if (cat !== 'allSame') (examples[`${view}/${cat}`] ??= []).push({ id: pr[i].id, pattern: pr[i].pattern, call: j, pre: pre[i].calls[j], main: main[i].calls[j], pr: pr[i].calls[j], schema: cases[pr[i].id].schema });
    }
  }
  report[view] = k;
}
console.log(JSON.stringify(report, null, 1));
fs.writeFileSync(process.argv[3] ?? 'examples.json', JSON.stringify(examples, null, 1));
for (const [k, v] of Object.entries(examples)) console.log(k, v.length);
