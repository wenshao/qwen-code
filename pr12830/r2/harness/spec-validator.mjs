// Independent validator: Ajv 2020-12 over the OpenAPI components, $refs resolved inside the document.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('$HEAD_WORKTREE/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
export function loadSpec(path) {
  const spec = JSON.parse(readFileSync(path, 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  addFormats(ajv);
  for (const f of ['int64', 'int32']) ajv.addFormat(f, { type: 'number', validate: Number.isInteger });
  ajv.addSchema(spec, 'spec');
  const cache = new Map();
  const at = (pointer) => {
    if (!cache.has(pointer)) cache.set(pointer, ajv.getSchema('spec#' + pointer));
    return cache.get(pointer);
  };
  const ops = new Map();
  for (const [p, item] of Object.entries(spec.paths))
    for (const [m, op] of Object.entries(item))
      if (m !== 'parameters') ops.set(op.operationId, { path: p, method: m, op });
  const esc = (s) => s.replaceAll('~', '~0').replaceAll('/', '~1');
  return {
    spec, ops,
    schema(name, value) {
      const v = at('/components/schemas/' + name);
      const ok = v(value);
      return { ok, errors: ok ? [] : v.errors.map((e) => `${e.instancePath || '/'} ${e.keyword} ${e.message}`) };
    },
    response(operationId, status, value) {
      const o = ops.get(operationId);
      if (!o) return { declared: false, note: 'no such operation' };
      let r = o.op.responses?.[String(status)];
      if (!r) return { declared: false };
      let ptr = `/paths/${esc(o.path)}/${o.method}/responses/${status}`;
      if (r.$ref) ptr = r.$ref.slice(1), r = spec.components.responses[r.$ref.split('/').pop()];
      if (!r.content?.['application/json']?.schema) return { declared: true, schema: false };
      const v = at(ptr + '/content/application~1json/schema');
      const ok = v(value);
      return { declared: true, ok, errors: ok ? [] : v.errors.map((e) => `${e.instancePath || '/'} ${e.keyword} ${e.message}`) };
    },
  };
}
