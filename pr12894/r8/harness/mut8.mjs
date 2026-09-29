// Round 8 mutants on c670bf45 (combined preview tail decoding).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const F = 'packages/core/src/services/shellExecutionService.ts';
const T = `cd ${W}/packages/core && npx vitest run src/services/shellExecutionService.test.ts 2>&1`;
const mutants = [
  ['P1 combined tail decoded without alignment (c670bf45 reverted)', `? stripAnsi(decodePreviewTail(tailPreview)).trim()`, `? stripAnsi(decodeBufferedOutput(tailPreview)).trim()`],
  ['P2 realign skips at most 1 continuation byte', `while (start < buffer.length && start < 3 && (buffer[start] & 0xc0) === 0x80)`, `while (start < buffer.length && start < 1 && (buffer[start] & 0xc0) === 0x80)`],
  ['P3 realign skips at most 2 continuation bytes (4-byte characters)', `while (start < buffer.length && start < 3 && (buffer[start] & 0xc0) === 0x80)`, `while (start < buffer.length && start < 2 && (buffer[start] & 0xc0) === 0x80)`],
];
const run = () => { let out = '', ok = true; try { out = execSync(T, { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } const failed = [...out.matchAll(/ (?:FAIL|×) [^\n]*/g)].map((m) => m[0].trim()).slice(0, 3); return { ok, line: (out.match(/Tests\s+\d+[^\n]*/g) ?? ['? ' + out.slice(-300)]).at(-1), failed }; };
const b = run(); console.log(`baseline: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`);
for (const [label, from, to] of mutants) {
  const p = `${W}/${F}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})${r.ok ? '' : '\n    ' + r.failed.join('\n    ')}`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
