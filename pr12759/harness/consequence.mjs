// What each pinned rule protects, measured on the real built core module (packages/core/dist).
// Each mutant is an exact-string edit of a copy of dist/src/utils/schemaValidator.js placed next to
// it (so its imports resolve); every variant runs in its own process with --expose-gc.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const DIR = `${process.env.HOME}/git/qwen-code-pr12759/packages/core/dist/src/utils`;
const SRC = fs.readFileSync(path.join(DIR, 'schemaValidator.js'), 'utf8');
const BR = "    if (key === undefined || compiled.failedTexts.has(key)) {\n        compiled.direct.add(schema);\n        return validator.compile(schema);\n    }";
const M = {
  PR: [],
  C3: [['            compiled.failedTexts.add(key);\n', '']],
  B3c: [[BR, "    if (key !== undefined && compiled.failedTexts.has(key)) {\n        return () => true;\n    }\n" + BR]],
  M7: [[BR, BR.replace('        compiled.direct.add(schema);', '        if (key === undefined) compiled.direct.add(schema);')]],
  F1: [['            compiled.failedTexts.add(key);\n            compiled.direct.add(schema);\n', '            compiled.failedTexts.add(key);\n']],
  D1: [['    if (compiled.direct.has(schema)) {\n        return validator.compile(schema);\n    }\n', '']],
};
const child = String.raw`
const { SchemaValidator } = await import(process.argv[2]);
const N = 3000;
const mk = () => ({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] });
let parses = 0, objStringify = 0, tracked = new WeakSet();
const P = JSON.parse, St = JSON.stringify;
JSON.parse = function (...a) { parses++; return P.apply(this, a); };
JSON.stringify = function (v, ...a) { if (tracked.has(v)) objStringify++; return St.call(this, v, ...a); };
const gc = () => { for (let i = 0; i < 3; i++) globalThis.gc(); };
// Rebuilt: a new object per call (per-call tool build / rediscovery), each used twice.
for (let i = 0; i < 200; i++) { const o = mk(); SchemaValidator.validate(o, {}); SchemaValidator.validate(o, {}); }
gc(); const h0 = process.memoryUsage().heapUsed; parses = 0;
let secondUseValidated = 0;
for (let i = 0; i < N; i++) { const o = mk(); tracked.add(o); SchemaValidator.validate(o, {}); if (SchemaValidator.validate(o, {}) !== null) secondUseValidated++; }
gc(); const h1 = process.memoryUsage().heapUsed;
const rebuilt = { heapKiBPerObject: +((h1 - h0) / N / 1024).toFixed(2), parsesPerObject: +(parses / N).toFixed(2), serializationsPerObject: +(objStringify / N).toFixed(2), secondUseValidated: secondUseValidated + '/' + N };
// Reused: one failing object used five times.
objStringify = 0; tracked = new WeakSet();
const one = mk(); one.properties.m = { type: 'string' }; tracked.add(one);
const r = [0,1,2,3,4].map(() => SchemaValidator.validate(one, {}) === null ? 'skip' : 'err');
console.log(JSON.stringify({ rebuilt, reused: { results: r.join(','), serializationsOfObject: objStringify } }));`;
fs.writeFileSync(path.join(DIR, '.probe-child.mjs'), child);
const rows = [];
try {
  for (const [id, edits] of Object.entries(M)) {
    let t = SRC;
    for (const [from, to] of edits) { if (t.split(from).length !== 2) throw new Error(`${id}: anchor`); t = t.replace(from, to); }
    const f = path.join(DIR, `schemaValidator.probe-${id}.js`);
    fs.writeFileSync(f, t);
    const r = spawnSync(process.execPath, ['--expose-gc', path.join(DIR, '.probe-child.mjs'), f], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    fs.rmSync(f);
    if (r.status !== 0) { console.log(id, r.status, r.stderr.slice(0, 1500)); continue; }
    const j = JSON.parse(r.stdout.trim().split('\n').at(-1));
    rows.push(`${id.padEnd(4)} rebuilt x3000: +${String(j.rebuilt.heapKiBPerObject).padStart(5)} KiB/object, JSON.parse ${j.rebuilt.parsesPerObject}/object, object serialized ${j.rebuilt.serializationsPerObject}x/object, 2nd use validated ${j.rebuilt.secondUseValidated} | reused x5: ${j.reused.results}, serialized ${j.reused.serializationsOfObject}x`);
    console.log(rows.at(-1));
  }
} finally { fs.rmSync(path.join(DIR, '.probe-child.mjs'), { force: true }); }
fs.writeFileSync(new URL('./consequence.log', import.meta.url), rows.join('\n') + '\n');
