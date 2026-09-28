// Round 7 mutants on the 033c74d3 merge-resolved fixes (R6-1 bound, R6-2 projection/ACK).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const F1 = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const F2 = 'packages/cli/src/serve/hosted-harness-session.ts';
const T = `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts src/serve/hosted-harness-session.test.ts 2>&1`;
const mutants = [
  ['N1 O2 preview not bounded (R6-1 reverted)', F1, `const responseParts = boundedShellPreview(\n        envelope.responseParts,\n      ) as Part[];`, `const responseParts = envelope.responseParts as Part[];`],
  ['N2 projection per receipt again (R6-2 reverted)', F2, `if (!projectedIds.has(history['messageId'])) {`, `if (!(await session.managed.sink.project()).some((item) => item.uuid === history['messageId'])) {`],
  ['N3 recovery ACK for every receipt again', F2, `    if (receiptPromptId !== promptId) continue;\n`, ``],
  ['N4 no recovery ACK at all', F2, `    if (receiptPromptId !== promptId) continue;\n`, `    continue;\n`],
  ['N5 repaired history id not added to the set', F2, `      projectedIds.add(result.uuid);\n`, ``],
  ['N6 history never projected (every receipt looks missing)', F2, `const projected = receipts.length ? await session.managed.sink.project() : [];`, `const projected = [] as any[];`],
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
