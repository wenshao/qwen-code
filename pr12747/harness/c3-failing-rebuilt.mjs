// A schema that fails its first compile (draft-04 $schema), rebuilt for every call, as a per-call
// tool build or a rediscovery produces it. heapUsed after gc per call, for the given core dist.
const [, , file, label] = process.argv;
const { SchemaValidator } = await import(file);
const schema = () => ({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] });
const gc = () => { for (let i = 0; i < 3; i++) globalThis.gc(); };
const results = { null: 0, error: 0 };
for (let i = 0; i < 200; i++) SchemaValidator.validate(schema(), {});
gc(); const h0 = process.memoryUsage().heapUsed; const t0 = performance.now();
const N = 4000;
for (let i = 0; i < N; i++) { const r = SchemaValidator.validate(schema(), {}); r === null ? results.null++ : results.error++; }
const ms = (performance.now() - t0) / N; gc(); const h1 = process.memoryUsage().heapUsed;
console.log(`${label.padEnd(40)} +${((h1 - h0) / N / 1024).toFixed(2)} KiB/call  ${ms.toFixed(3)} ms/call  results: ${results.null} skipped, ${results.error} validated`);
