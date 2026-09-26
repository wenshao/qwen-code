// Result differential: the validator before the compile cache (89b057befd) vs this PR's head, both
// as built core modules. Each case runs in a fresh process per arm, so module state starts empty.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ARMS = {
  'pre-cache 89b057befd': `${process.env.HOME}/git/qwen-code-pr12747-base/packages/core/dist/src/utils/schemaValidator.js`,
  'PR 8cc4ad55d0': `${process.env.HOME}/git/qwen-code-pr12759/packages/core/dist/src/utils/schemaValidator.js`,
};
const CASES = {
  'compiles, $id': `({ $id: 'urn:t:a', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })`,
  'draft-04, $id': `({ $id: 'urn:t:b', $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })`,
  'draft-04, no $id': `({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] })`,
  'unresolvable $ref, $id': `({ $id: 'urn:t:c', type: 'object', properties: { n: { $ref: '#/definitions/missing' } }, required: ['n'] })`,
  'meta-schema violation, $id': `({ $id: 'urn:t:d', type: 'object', properties: { n: { type: 'integer' } }, required: 'n' })`,
  'nested $id': `({ $id: 'urn:t:e', type: 'object', properties: { n: { $id: 'urn:t:e-n', type: 'integer' } }, required: ['n'] })`,
  'inexact (NaN), $id': `({ $id: 'urn:t:f', type: 'object', properties: { n: { type: 'integer' }, x: { const: NaN } }, required: ['n'] })`,
};
const child = (file, expr, mode) => `
const { SchemaValidator } = await import(${JSON.stringify(file)});
const mk = () => ${expr};
const one = mk();
const out = [];
for (let i = 0; i < 4; i++) {
  const r = SchemaValidator.validate(${mode === 'same' ? 'one' : 'mk()'}, { n: 'x' });
  out.push(r === null ? 'skip' : 'err');
}
console.log(out.join(','));`;
const lines = ['case                         call pattern        ' + Object.keys(ARMS).map((a) => a.padEnd(22)).join('') + 'same?'];
let diffs = 0;
for (const [name, expr] of Object.entries(CASES)) {
  for (const mode of ['same', 'rebuilt']) {
    const res = Object.values(ARMS).map((file) => spawnSync(process.execPath, ['--input-type=module', '-e', child(file, expr, mode)], { encoding: 'utf8' }).stdout.trim() || 'ERROR');
    const same = res.every((r) => r === res[0]);
    if (!same) diffs++;
    lines.push(`${name.padEnd(29)}${(mode === 'same' ? 'same object x4' : 'new object x4').padEnd(20)}${res.map((r) => r.padEnd(22)).join('')}${same ? 'yes' : 'DIFFERS'}`);
  }
}
lines.push(`rows that differ: ${diffs}`);
console.log(lines.join('\n'));
fs.writeFileSync(new URL('./diff-results.log', import.meta.url), lines.join('\n') + '\n');
