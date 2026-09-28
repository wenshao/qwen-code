// Source-level versions of the bundle mutants, run against the existing Hosted unit tests
// (packages/cli/src/serve/hosted-*.test.ts). usage: node unit-mutants.cjs <tree> [IDs]
const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');
const tree = process.argv[2]; const ids = process.argv.slice(3);
const S = 'packages/cli/src/serve/';
const M = {
  P1: [[S + 'hosted-harness-session.ts', '              : undefined;\n', '              : undefined;\n          await (toolTurn as unknown as { warmed?: Promise<void> } | undefined)?.warmed;\n']],
  P2: [[S + 'hosted-workspace-tool-turn.ts', '    this.warmed = this.broker.warm();\n', ''],
       [S + 'hosted-workspace-tool-turn.ts', '    void this.warmed.catch(() => undefined);\n', ''],
       [S + 'hosted-workspace-tool-turn.ts', '        this.warmed,\n', '        ((this as unknown as { warmed?: Promise<void> }).warmed ??= this.broker.warm()),\n']],
  P3: [[S + 'hosted-workspace-tool-turn.ts', '        this.warmed,\n', '        Promise.resolve(),\n']],
  P4: [[S + 'hosted-harness-model.ts', '        input.signal,\n      );\n    }\n', '        input.signal,\n      );\n      client.getChat().setHistory([]);\n    }\n']],
  P5: [[S + 'hosted-workspace-tool-turn.ts', '        const result = await this.broker.execute(\n', '        await this.broker.execute(executionCallId, request.payloadJson, signal);\n        const result = await this.broker.execute(\n']],
  I1: [[S + 'hosted-harness-session.ts', '        message.message?.parts?.some((part) => part.functionCall)\n      ) {', '        (message.message?.parts?.some((part) => part.functionCall) && !text)\n      ) {']],
};
const OUT = path.join(__dirname, 'unit-out.json');
function run() {
  fs.rmSync(OUT, { force: true });
  const files = fs.readdirSync(path.join(tree, S)).filter((f) => new RegExp(process.env.FILES || '^hosted-.*\.test\.ts$').test(f)).map((f) => 'src/serve/' + f);
  spawnSync('npx', ['vitest', 'run', ...files, '--no-file-parallelism', '--reporter=json', '--outputFile=' + OUT], { cwd: path.join(tree, 'packages/cli'), encoding: 'utf8', maxBuffer: 256e6 });
  const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const failed = j.testResults.flatMap((f) => f.assertionResults.map((t) => ({ ...t, file: path.basename(f.name) }))).filter((t) => t.status === 'failed');
  return { total: j.numTotalTests, passed: j.numPassedTests, failed, suitesFailed: j.numFailedTestSuites };
}
const originals = new Map();
try {
  const base = run();
  console.log(`BASELINE passed ${base.passed}/${base.total} failedSuites=${base.suitesFailed}`);
  for (const id of ids.length ? ids : Object.keys(M)) {
    for (const [f] of M[id]) if (!originals.has(f)) originals.set(f, fs.readFileSync(path.join(tree, f), 'utf8'));
    let ok = true; const cur = new Map();
    for (const [f, from, to] of M[id]) {
      const s = cur.get(f) ?? originals.get(f); const i = s.indexOf(from);
      if (i < 0 || s.indexOf(from, i + 1) >= 0) { console.log(`${id}: anchor ${i < 0 ? 'missing' : 'ambiguous'} in ${f}`); ok = false; break; }
      cur.set(f, s.slice(0, i) + to + s.slice(i + from.length));
    }
    if (ok) {
      for (const [f, s] of cur) fs.writeFileSync(path.join(tree, f), s);
      const r = run();
      console.log(`${id}: ${r.failed.length || r.suitesFailed ? 'KILLED' : 'SURVIVED'} (${r.passed}/${r.total}, failedSuites=${r.suitesFailed})${r.failed.length ? ' by ' + r.failed.slice(0, 4).map((t) => `${t.file} › ${t.title}`).join(' | ') : ''}`);
    }
    for (const [f, s] of originals) fs.writeFileSync(path.join(tree, f), s);
  }
} finally {
  for (const [f, s] of originals) fs.writeFileSync(path.join(tree, f), s);
}
