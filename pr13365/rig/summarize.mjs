// Aggregate rounds.jsonl of the given run directories by arm x scenario x n.
import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/82bd70be-da86-4042-ac1d-b63b9f729043/scratchpad';
const prefix = process.argv[2] ?? 'a-';
const runs = fs.readdirSync(`${S}/runs`).filter((d) => d.startsWith(prefix));
const agg = new Map();
for (const run of runs) {
  const file = `${S}/runs/${run}/rounds.jsonl`;
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    const key = `${r.arm}|${r.scenario}|${r.n}`;
    const a = agg.get(key) ?? { arm: r.arm, scenario: r.scenario, n: r.n, rounds: 0, requests: 0, ok: 0, e500: 0, other: {}, deadlocks: 0, stalled: 0, settleMs: [], dupSessions: 0, turnRowsBad: 0 };
    a.rounds++;
    const h = r.scenario.startsWith('samekey-submit') || r.scenario === 'diffkey' ? r.submit : r.create;
    for (const [k, v] of Object.entries(h ?? {})) {
      a.requests += v;
      if (k === '202') a.ok += v;
      else if (k.startsWith('500')) a.e500 += v;
      else a.other[k] = (a.other[k] ?? 0) + v;
    }
    if (r.scenario === 'diffkey') for (const [k, v] of Object.entries(r.create ?? {})) if (k !== '202') a.other[`create ${k}`] = (a.other[`create ${k}`] ?? 0) + v;
    a.deadlocks += r.deadlocks ?? 0;
    if (r.stalled) a.stalled++;
    if (r.settleMs != null) a.settleMs.push(r.settleMs);
    if (r.scenario.startsWith('samekey-create') && (r.distinctSessions !== 1 || r.sessionRows !== 1)) a.dupSessions++;
    if (r.scenario === 'samekey-submit' && r.turnRows !== 1) a.turnRowsBad++;
    agg.set(key, a);
  }
}
const order = ['diffkey', 'samekey-create', 'samekey-create-ws', 'diffkey-ws', 'samekey-submit'];
const arms = ['base', 'pr', 'mscope'];
const rows = [...agg.values()].sort((x, y) => order.indexOf(x.scenario) - order.indexOf(y.scenario) || x.n - y.n || arms.indexOf(x.arm) - arms.indexOf(y.arm));
console.log('arm\tscenario\tn\trounds\trequests\t202\t500\tdeadlocks\tstalled\tsettleMs(max)\tinvariants\tother');
for (const a of rows) {
  const inv = a.dupSessions || a.turnRowsBad ? `BROKEN(${a.dupSessions}/${a.turnRowsBad})` : 'ok';
  console.log([a.arm, a.scenario, a.n, a.rounds, a.requests, a.ok, a.e500, a.deadlocks, a.stalled, a.settleMs.length ? Math.max(...a.settleMs) : '-', inv, JSON.stringify(a.other)].join('\t'));
}
fs.writeFileSync(`${S}/rig/summary-${prefix.replace(/\W/g, '')}.json`, JSON.stringify(rows, null, 2));
