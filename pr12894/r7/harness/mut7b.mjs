// Round 7 mutants on the 033c74d3 merge-resolved fixes (R6-1 bound, R6-2 projection/ACK).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const F1 = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const F2 = 'packages/cli/src/serve/hosted-harness-session.ts';
const T = `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.test.ts 2>&1`;
const mutants = [
  ['N7 repaired record not appended to the projection (parent of a second repair)', F2, `      projected.push(result);\n`, ``],
  ['N8 N5+N7 together', F2, `      projected.push(result);\n      projectedIds.add(result.uuid);\n`, ``],
];
const run = () => { let out = '', ok = true; try { out = execSync(T, { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } const failed = [...out.matchAll(/ (?:FAIL|×) [^\n]*/g)].map((m) => m[0].trim()).slice(0, 3); return { ok, line: (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-300)]).at(-1), failed }; };
const b = run(); console.log(`baseline: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);
for (const [label, file, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})${r.ok ? '' : '\n    ' + r.failed.join('\n    ')}`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
