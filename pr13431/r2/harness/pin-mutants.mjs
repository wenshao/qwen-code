// Mutation matrix for the R2 workflow-step pin (scripts/tests/hosted-process-ci.test.js).
// Run from a tree root inside the rig container: node pin-mutants.mjs <out dir>
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
const wf = '.github/workflows/sdk-java.yml';
const step =
  "      - name: 'Check Hosted proxy header relay'\n" +
  '        run: |-\n' +
  '          cd integration-tests\n' +
  '          npx vitest run helpers/hosted-relay-headers.test.ts\n';
const verify = "      - name: 'Verify Hosted Java, Spring and MySQL processes'\n";
const withField = (field) =>
  step.replace("relay'\n", `relay'\n        ${field}\n`);
const mutants = [
  ['delete the step', step, ''],
  ['rename the step', step, step.replace('header relay', 'header relays')],
  ['append || true to the command', step, step.replace('headers.test.ts\n', 'headers.test.ts || true\n')],
  ['continue-on-error: true', step, withField('continue-on-error: true')],
  ['if: ${{ false }}', step, withField("if: '${{ false }}'")],
  ["if: github.event_name == 'push'", step, withField("if: \"github.event_name == 'push'\"")],
  ['shell that ignores the script', step, withField("shell: 'true {0}'")],
  ['working-directory: packages (loud: cd fails at run time)', step, withField("working-directory: 'packages'")],
];

function clean() {
  execFileSync('git', ['checkout', '--', wf]);
  const status = execFileSync('git', ['status', '--porcelain', wf], { encoding: 'utf8' });
  if (status.trim()) throw new Error(`not clean: ${status}`);
}
function run(tag) {
  const json = path.join(outDir, `${tag.replace(/[^a-z0-9]+/gi, '_')}.json`);
  spawnSync('npx', ['vitest', 'run', '--config', './scripts/tests/vitest.config.ts', 'scripts/tests/hosted-process-ci.test.js', '--reporter=json', `--outputFile=${json}`], { encoding: 'utf8', timeout: 300_000 });
  const report = JSON.parse(fs.readFileSync(json, 'utf8'));
  const failed = [];
  let total = 0;
  for (const file of report.testResults)
    for (const t of file.assertionResults) {
      total++;
      if (t.status !== 'passed') failed.push(t.title);
    }
  return { total, failed };
}

clean();
const rows = [{ id: 'baseline', ...run('baseline') }];
console.log(JSON.stringify(rows.at(-1)));
const source = fs.readFileSync(wf, 'utf8');
if (source.split(step).length !== 2) throw new Error('step anchor not unique');
if (source.split(verify).length !== 2) throw new Error('verify anchor not unique');
for (const [id, from, to] of mutants) {
  clean();
  fs.writeFileSync(wf, source.replace(from, () => to));
  const r = run(id);
  rows.push({ id, ...r, killed: r.failed.length > 0 });
  console.log(JSON.stringify(rows.at(-1)));
}
// Move the step after the Maven gate.
clean();
{
  const moved = source.replace(step, '');
  const at = moved.indexOf(verify);
  const next = moved.indexOf("      - name: 'Check that every Hosted integration test class ran'", at);
  fs.writeFileSync(wf, moved.slice(0, next) + step + moved.slice(next));
  const r = run('move after verify');
  rows.push({ id: 'move the step after the Maven gate', ...r, killed: r.failed.length > 0 });
  console.log(JSON.stringify(rows.at(-1)));
}
clean();
rows.push({ id: 'baseline-after', ...run('baseline-after') });
console.log(JSON.stringify(rows.at(-1)));
fs.writeFileSync(path.join(outDir, 'pin-matrix.json'), JSON.stringify(rows, null, 2));
