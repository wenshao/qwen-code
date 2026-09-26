// A schema revived by JSON.parse inside a vm context (as workflow-sandbox.ts does for agent({schema}))
// has that context's Object.prototype. Validate 3 rebuilt copies per build: with and without $id.
import vm from 'node:vm';
import { createRequire } from 'node:module';
const file = process.argv[2];
const { SchemaValidator } = await import(file);
const req = createRequire(file);
const AjvPkg = req('ajv'); const AjvClass = AjvPkg.default || AjvPkg;
let compiles = 0; const orig = AjvClass.prototype.compile;
AjvClass.prototype.compile = function (...a) { compiles++; return orig.apply(this, a); };
const ctx = vm.createContext({});
const text = (id) => JSON.stringify({ ...(id ? { $id: 'urn:wf:answer' } : {}), type: 'object', properties: { answer: { type: 'integer', minimum: 1 } }, required: ['answer'] });
const out = {};
for (const id of [false, true]) {
  const rows = [];
  compiles = 0;
  for (let i = 0; i < 3; i++) {
    const schema = vm.runInContext(`JSON.parse(${JSON.stringify(text(id))})`, ctx);
    if (i === 0) rows.push(`hostProto=${Object.getPrototypeOf(schema) === Object.prototype}`);
    rows.push(JSON.stringify(SchemaValidator.validate(schema, { answer: 0 })));
  }
  out[id ? 'with $id' : 'no $id'] = rows.join(' | ') + ` | Ajv compiles: ${compiles}`;
}
console.log(JSON.stringify(out));
