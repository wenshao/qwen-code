// Lists, per TypeScript mutant, which test files the failures came from.
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', 'mutation');
for (const f of fs.readdirSync(OUT).filter((n) => /^[TNG]\d+-(cli|core)\.log\.json$/.test(n)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))) {
  const json = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const byFile = {};
  for (const file of json.testResults)
    for (const t of file.assertionResults)
      if (t.status === 'failed') (byFile[path.basename(file.name)] ??= []).push(t.title.slice(0, 70));
  console.log(f.replace('.log.json', '').padEnd(10), json.numFailedTests, 'failed', JSON.stringify(Object.fromEntries(Object.entries(byFile).map(([k, v]) => [k, v.length]))));
}
