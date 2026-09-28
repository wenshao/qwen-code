const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const f = (x) => (x == null ? '-' : String(Math.round(x)));
const rows = [];
for (const name of fs.readdirSync(dir).filter((n) => /^report-.*\.json$/.test(n)).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const n = r.samples.find((s) => s.scenario === 'no-tool'), t = r.samples.find((s) => s.scenario === 'tool');
  rows.push([name.replace(/^report-|\.json$/g, ''), r.environment.database.replace('MySQL 5.5.5-', '').replace(/-MariaDB.*/, ' MariaDB').replace(/ \(.*\)/, ''),
    f(n.modelRounds[0].firstTextMs), f(n.turnCompleteMs), f(n.runtimeReadyMs), n.storeRequests,
    f(t.modelRounds[0].firstTextMs), f(t.runtimeReadyMs), f(t.toolWaitMs), f(t.firstVisibleTextMs), f(t.turnCompleteMs), t.storeRequests]);
}
const head = ['run', 'db', 'nt.text', 'nt.done', 'nt.ready', 'nt.store', 't.text', 't.ready', 't.wait', 't.visible', 't.done', 't.store'];
const all = [head, ...rows]; const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
for (const r of all) console.log(r.map((c, i) => (i < 2 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join('  '));
