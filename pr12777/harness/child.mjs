// Runs every case instance against one arm's built schemaValidator.js, in one process.
// argv: <schemaValidator.js> <cases.json>. Prints one JSON line per call.
import fs from 'node:fs';
globalThis.__logs = [];
const cons = [];
for (const k of ['log', 'warn', 'error']) console[k] = (...a) => cons.push(`console.${k}: ${a.map(String).join(' ').slice(0, 200)}`);
const { SchemaValidator } = await import(process.argv[2]);
const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const ev = (src) => new Function(`return ${src}`)();
const out = [];
const call = (schema, dataSrc) => {
  globalThis.__logs.length = 0; cons.length = 0;
  let r;
  try { r = SchemaValidator.validate(schema, ev(dataSrc)); } catch (e) { r = `THROW ${e?.message}`; }
  return { r, logs: [...globalThis.__logs], cons: [...cons] };
};
for (const c of cases) {
  // Each pattern gets its own $ids and its own text, so patterns do not meet each other in the caches.
  const own = (src, pattern) => src.replace(/urn:(c\d+|fx\d)/g, (m) => `${m}-${pattern}`).replace(/^\(\{ /, `({ description: '${c.id}-${pattern}', `);
  let mk, other;
  const inst = (pattern, fn) => { mk = () => ev(own(c.schema, pattern)); other = c.other && (() => ev(own(c.other, pattern))); const calls = []; fn((s, d) => calls.push(call(s, d))); out.push({ id: c.id, pattern, calls }); };
  inst('same', (go) => { const o = mk(); for (const d of c.datas) go(o, d); });
  inst('rebuilt', (go) => { for (const d of c.datas) go(mk(), d); });
  inst('mixed', (go) => { const a = mk(); go(a, c.datas[0]); go(mk(), c.datas[1]); go(a, c.datas[1]); go(mk(), c.datas[0]); });
  if (c.other) inst('idHeld', (go) => { go(other(), '({ zz: 1 })'); const o = mk(); go(o, c.datas[1]); go(o, c.datas[1]); go(mk(), c.datas[0]); });
}
process.stdout.write(out.map((x) => JSON.stringify(x)).join('\n') + '\n');
