import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const F = 'packages/core/src/services/shellExecutionService.ts';
const T = `cd ${W}/packages/core && npx vitest run src/services/shellExecutionService.test.ts 2>&1`;
const mutants = [
  ['Ma no UTF-8 realignment of the stderr window', `return decodeBufferedOutput(\n    start > 0 && isUtf8(aligned) && aligned.some((byte) => byte >= 0xc2)\n      ? aligned\n      : buffer,\n  );`, `return decodeBufferedOutput(buffer);`],
  ['Mb realign skips at most 1 continuation byte', `start < buffer.length && start < 3 &&`, `start < buffer.length && start < 1 &&`],
  ['Mc 8 KiB stderr reservation unconditional again', `maxBufferedOutputBytes - (stderrTail ? stderrTailBytes : 0);`, `maxBufferedOutputBytes - stderrTailBytes;`],
  ['Md [Recent stderr] block dropped', '${stderrText ? `\\n\\n[Recent stderr]', '${false ? `\\n\\n[Recent stderr]'],
  ['Me earlier tail discarded when stderr first arrives', `previewTail.add(previous);`, `void previous;`],
];
const run = () => { let out = '', ok = true; try { out = execSync(T, { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } return { ok, line: (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-300)]).at(-1) }; };
const b = run(); console.log(`baseline: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);
for (const [label, from, to] of mutants) {
  const p = `${W}/${F}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
