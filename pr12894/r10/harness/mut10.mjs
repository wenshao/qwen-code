// Round 10 mutants on bf8a99b4 (R9-1: O2 Shell validation errors returned, not thrown).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const TT = 'packages/cli/src/serve/hosted-workspace-tool-turn.ts';
const T = `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts 2>&1`;
const anchor = `          validationError = 'Hosted Shell requires one foreground command.';\n        }\n`;
const mutants = [
  ['V1 R9-1 reverted: O2 throws the validation error again', TT, anchor, anchor + `        if (this.publication && validationError) {\n          throw new Error(validationError);\n        }\n`],
  ['V2 O2 no longer refuses is_background', TT, `        if (this.publication && args['is_background'] !== undefined) {\n          validationError = 'Hosted Shell requires one foreground command.';\n        }\n`, ``],
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
