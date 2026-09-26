// Makes every test of the compile-cache block fail once, after its body ran, then runs vitest at
// --retry=2 (CI's default). Writes injected copies next to the originals and removes them after.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const CORE = `${process.env.HOME}/git/qwen-code-pr12777/packages/core`;
const files = { pr: 'src/utils/schemaValidator.test.ts', before: 'src/utils/schemaValidator.pre12777.test.ts' };
const made = [];
try {
  for (const [label, f] of Object.entries(files)) {
    let s = fs.readFileSync(`${CORE}/${f}`, 'utf8');
    s = s.replace("import { describe, expect, it, vi } from 'vitest';", "import { afterEach, describe, expect, it, vi } from 'vitest';\nconst oneOff = new Set<string>();");
    const a = "describe('SchemaValidator compile cache', () => {\n";
    if (s.split(a).length !== 2) throw new Error('anchor ' + label);
    s = s.replace(a, a + "  afterEach(({ task }) => {\n    if (!oneOff.has(task.name)) {\n      oneOff.add(task.name);\n      throw new Error('injected one-off failure');\n    }\n  });\n");
    const out = f.replace('.test.ts', `.oneoff-${label}.test.ts`);
    fs.writeFileSync(`${CORE}/${out}`, s); made.push(`${CORE}/${out}`);
  }
  const json = `${process.env.TMPDIR ?? '/tmp'}/oneoff-${process.pid}.json`;
  spawnSync('npx', ['vitest', 'run', ...made.map((m) => m.slice(CORE.length + 1)), '--retry=2', '--reporter=json', `--outputFile=${json}`, '--coverage.enabled=false'], { cwd: CORE, encoding: 'utf8' });
  const j = JSON.parse(fs.readFileSync(json, 'utf8'));
  const lines = [];
  for (const f of j.testResults) {
    const label = f.name.includes('oneoff-pr') ? 'this PR' : 'before this PR';
    const block = f.assertionResults.filter((a) => a.ancestorTitles[0] === 'SchemaValidator compile cache');
    const failed = block.filter((a) => a.status === 'failed');
    const retried = block.filter((a) => (a.retryCount ?? 0) > 0);
    lines.push(`${label}: compile-cache tests ${block.length}, retried ${retried.length}, still failing after --retry=2: ${failed.length}`);
    for (const t of failed) { lines.push(`   FAIL ${t.title}`); (t.failureMessages ?? []).forEach((m, k) => lines.push(`      attempt ${k + 1}: ${m.split('\n').find((l) => /expected|Error/.test(l))?.trim().slice(0, 140)}`)); }
  }
  console.log(lines.join('\n'));
  fs.writeFileSync('logs-retry.txt', lines.join('\n') + '\n');
} finally {
  for (const m of made) fs.rmSync(m, { force: true });
}
