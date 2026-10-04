// Derives results/surface.json from the rig's raw outputs.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const R = '/Users/wenshao/git/pr13347-rig';
const read = (p) => readFileSync(`${R}/${p}`, 'utf8');
const lines = (p) => read(p).split('\n').filter((l) => /error TS/.test(l));
const out = [];
const add = (check, ok, result) => out.push({ check, ok, result });
const javap = execFileSync('bash', ['-c', `diff ${R}/stage/base-2c591ecc08.javap.txt ${R}/stage/head-c5de7a90ca.javap.txt | grep '^[<>] *[^ <>]' || true`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
add('Server bytecode, base → head (javap -c -p of the 4 class files that differ)', javap.length === 1 && /OPENING_COMMAND_QUERY/.test(javap[0]),
  `only change: ${javap.map((l) => l.replace(/^> +/, '').replace(/ = ".*"/, '')).join('; ')} — every method body identical`);
const sums = execFileSync('bash', ['-c', `diff ${R}/stage/head-c5de7a90ca.sums ${R}/stage/head2-3acf924898.sums | grep -c '^[<>]' || true`], { encoding: 'utf8' }).trim();
add('Server jar classes, round-1 head c5de7a90ca → head 3acf924898', sums === '0', `BOOT-INF/classes byte-identical (${read('stage/head2-3acf924898.sums').trim().split('\n').length} files)`);
const a = JSON.parse(readFileSync(`${R}/stage/base-2c591ecc08/BOOT-INF/classes/openapi/managed-agent-public-api.openapi.json`, 'utf8'));
const b = JSON.parse(readFileSync(`${R}/stage/head-c5de7a90ca/BOOT-INF/classes/openapi/managed-agent-public-api.openapi.json`, 'utf8'));
const d = [];
(function w(x, y, p) { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) w(x[k], y[k], `${p}/${k}`); return; } d.push(p); })(a, b, '');
add('Served OpenAPI JSON, base → head (semantic diff)', d.length === 3, `${d.length} paths: ${d.map((p) => p.replace('/paths/', '').replace('/responses/200', '')).join(' · ')}`);
add('Generated WebShell types regenerated from the head spec', /byte-identical/.test(read('results/ws-regen-head.txt')), 'npm run generate:managed-agent-api → git diff empty');
const vt = read('results/ws-vitest-managed-head.txt').match(/Tests\s+(\d+) passed \((\d+)\)/);
add('web-shell client/components/managed vitest (incl. byte-compare test)', !!vt, vt ? `${vt[1]}/${vt[2]} passed` : 'n/a');
add('Mutant: generated type left at capabilities?: (stale)', /1 failed/.test(read('results/ws-vitest-stale-generated.txt')), "managed-agent-api.test.ts › 'match the OpenAPI contract' fails");
const hn = lines('results/ws-typecheck-head-nocaps.txt').length - lines('results/ws-typecheck-head.txt').length;
const extra = lines('results/ws-typecheck-head-nocaps.txt').filter((l) => !read('results/ws-typecheck-head.txt').includes(l));
add('Mutant: a JavaAgentSession literal without capabilities (tsc)', hn === 1 && /TS2322/.test(extra[0] ?? ''), `head: +${hn} error (${(extra[0] ?? '').match(/error TS\d+/)?.[0]} at ${(extra[0] ?? '').split('(')[0].split('/').pop()}); base accepts the same literal`);
const same = lines('results/ws-typecheck-base.txt').sort().join('\n') === lines('results/ws-typecheck-head.txt').sort().join('\n');
add('tsc error set, base vs head (workspace deps unbuilt locally)', same, `identical ${lines('results/ws-typecheck-head.txt').length} = ${lines('results/ws-typecheck-base.txt').length} lines, all from unbuilt @qwen-code/sdk; no new error at head (CI Lint & Static is the clean run)`);
writeFileSync(`${R}/results/surface.json`, JSON.stringify(out, null, 2));
for (const o of out) console.log(o.ok ? 'OK ' : 'BAD', o.check, '—', o.result);
