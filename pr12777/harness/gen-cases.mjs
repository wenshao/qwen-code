// Deterministic generator of schema cases (as JS source, so that exotic values survive).
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(Number(process.argv[2] ?? 12777));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const NP = (body) => `Object.assign(Object.create(null), ${body})`;
const NAMED = (items, key, val) => `Object.assign(${items}, { ${JSON.stringify(key)}: ${val} })`;
function constValue() {
  return pick([
    ['{ x: 1 }', ['({ x: 1 })', '({ x: 2 })']],
    [NP('{ x: 1 }'), ['({ x: 1 })', '({ x: 2 })']],
    ['[1, 2]', ['[1, 2]', '[2, 1]']],
    [NAMED('[1]', 'k', '2'), ['[1]', '[2]']],
    ['-0', ['0', '1']],
    ['"s"', ['"s"', '"t"']],
    [`{ inner: ${NP('{ y: [1] }')} }`, ['({ inner: { y: [1] } })', '({ inner: { y: [2] } })']],
  ]);
}
export function makeCase(i) {
  const U = `c${i}`;
  const props = [], defs = [], data = [[], []];
  let allOf = null, required = [];
  const nProps = 1 + Math.floor(rnd() * 3);
  for (let p = 0; p < nProps; p++) {
    const name = `p${p}`;
    const kind = pick(['int', 'int', 'const', 'enum', 'refNamed', 'refIndex', 'refMissing', 'refDefs', 'nestedId', 'meta', 'npSub', 'arrNamedEnum']);
    let s, good = '1', bad = '"x"';
    switch (kind) {
      case 'int': { const min = pick(['1', '-0', '0']); s = `{ type: 'integer', minimum: ${min} }`; good = '5'; bad = '-1'; break; }
      case 'const': { const [v, [g, b]] = constValue(); s = `{ const: ${v} }`; good = g; bad = b; break; }
      case 'enum': { const [v, [g, b]] = constValue(); s = `{ enum: [${v}, "other"] }`; good = g; bad = b; break; }
      case 'refNamed': case 'refIndex': {
        const key = pick(['constructor', 'named', 'length_', 'push']);
        allOf ??= { items: [`{}`], named: {} };
        allOf.named[key] = `{ required: ['q${p}'] }`;
        s = kind === 'refNamed' ? `{ $ref: '#/allOf/${key}' }` : `{ $ref: '#/allOf/0' }`;
        good = `({ q${p}: 1 })`; bad = '({})'; break;
      }
      case 'refMissing': s = `{ $ref: '#/definitions/missing' }`; break;
      case 'refDefs': {
        const d = `d${p}`; const body = `{ type: 'string', minLength: 2 }`;
        defs.push([d, chance(0.5) ? NP(body) : body]); s = `{ $ref: '#/$defs/${d}' }`; good = '"ab"'; bad = '"a"'; break;
      }
      case 'nestedId': { const dupe = chance(0.3); s = `{ $id: 'urn:${U}:n${dupe ? '' : p}', type: 'integer' }`; if (dupe) props.push([`${name}b`, `{ $id: 'urn:${U}:n', type: 'string' }`]); good = '3'; bad = '"x"'; break; }
      case 'meta': s = `{ type: 'integer', minimum: 'one' }`; good = '3'; bad = '"x"'; break;
      case 'npSub': s = NP(`{ type: 'string' }`); good = '"s"'; bad = '4'; break;
      case 'arrNamedEnum': s = `{ enum: ${NAMED('["a", "b"]', 'extra', '"c"')} }`; good = '"a"'; bad = '"c"'; break;
    }
    props.push([name, s]);
    if (chance(0.5)) required.push(name);
    data[0].push(`${JSON.stringify(name)}: ${good}`);
    data[1].push(`${JSON.stringify(name)}: ${bad}`);
  }
  const parts = [];
  const hasId = chance(0.45);
  if (hasId) parts.push(`$id: 'urn:${U}:root'`);
  const $schema = pick([null, null, null, null, 'http://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft-04/schema#', 'https://json-schema.org/draft/2020-12/schema']);
  if ($schema) parts.push(`$schema: '${$schema}'`);
  parts.push(`type: 'object'`);
  const propsSrc = `{ ${props.map(([n, s]) => `${JSON.stringify(n)}: ${s}`).join(', ')} }`;
  parts.push(`properties: ${chance(0.15) ? NP(propsSrc) : propsSrc}`);
  if (required.length) {
    const req = `[${required.map((r) => JSON.stringify(r)).join(', ')}]`;
    parts.push(`required: ${chance(0.15) ? NAMED(req, 'note', '"n"') : req}`);
  }
  if (allOf) {
    const named = Object.entries(allOf.named).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ');
    parts.push(`allOf: Object.assign([${allOf.items.join(', ')}], { ${named} })`);
  }
  if (defs.length) parts.push(`$defs: { ${defs.map(([d, b]) => `${d}: ${b}`).join(', ')} }`);
  const schema = `({ ${parts.join(', ')} })`;
  const datas = [`({ ${data[0].join(', ')} })`, `({ ${data[1].join(', ')} })`, `({})`];
  return { id: U, hasId, schema, datas, other: hasId ? `({ $id: 'urn:${U}:root', ${$schema ? `$schema: '${$schema}', ` : ''}type: 'object', properties: { zz: { type: 'string' } } })` : null };
}
// The three examples from the PR body, as fixed cases.
export const FIXED = [
  { id: 'fx1', hasId: true, schema: `({ $id: 'urn:fx1:d4', $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { count: { type: 'integer', minimum: 1 } }, required: ['count'] })`, datas: ['({ count: 0 })', '({ count: 2 })', '({})'], other: null },
  { id: 'fx2', hasId: false, schema: `({ type: 'object', allOf: Object.assign([{}], { constructor: { required: ['p6'] } }), properties: { wrapped: { $ref: '#/allOf/constructor' } } })`, datas: ['({ wrapped: {} })', '({ wrapped: { p6: 1 } })', '({})'], other: null },
  { id: 'fx3', hasId: false, schema: `({ type: 'object', properties: { v: { const: Object.assign(Object.create(null), { x: 1 }) } } })`, datas: ['({ v: { x: 1 } })', '({ v: { x: 2 } })', '({})'], other: null },
];
