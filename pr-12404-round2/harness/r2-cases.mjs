// Round-2 raw-HTTP cases: each is { text, anns } posted as _meta.inputAnnotations.
const ref = (start, extra = {}) => ({ type: 'reference', start, end: start + 10, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md', serialized: '@README.md', ...extra } });
const junk = (n, pad = '') => Array.from({ length: n }, (_, i) => ({ type: 'reference', start: 0, end: 1, text: 'B', reference: { id: 'junk' + i, kind: 'file', value: 'v' + i + pad } }));
const mk = (tag, build) => { const text = `${tag} check @README.md`; const at = tag.length + 7; return { text, anns: build(at) }; };
export const CASES = {
  // non-object elements mixed with one valid tag (the R1 §6a class, widened)
  NULLMIX: mk('NULLMIX', (at) => [null, 'x', 5, true, [null], ref(at)]),
  // control: one valid tag only
  VALIDONE: mk('VALIDONE', (at) => [ref(at)]),
  // count cap boundary
  CAP256: mk('CAP256', (at) => [ref(at), ...junk(255)]),
  CAP257: mk('CAP257', (at) => [ref(at), ...junk(256)]),
  // R1 §6b: ~10 MB array right at the request-body limit
  HUGE: mk('HUGE', (at) => [ref(at), ...junk(9300, 'x'.repeat(1000))]),
  // object-shaped elements whose fields have the wrong type: pass every new element filter
  FIELDVALUE: mk('FIELDVALUE', (at) => [ref(at, { value: 7 })]),
  FIELDLABEL: mk('FIELDLABEL', (at) => [{ ...ref(at), reference: { id: 'mcp:@mcp:o2-docs', kind: 'mcp', label: 5, value: 'o2-docs' }, text: '@README.md' }]),
  FIELDSERIAL: mk('FIELDSERIAL', (at) => [ref(at, { serialized: 5 })]),
};
