import { readFileSync } from 'node:fs';
const root = process.argv[2];
const fx = JSON.parse(readFileSync(`${root}/packages/core/src/managed-runtime/contracts/managed-channel-record-v1.fixtures.json`, 'utf8'));
const { MANAGED_EXTENSION_RECORD_BODIES: B } = await import(`${root}/packages/core/dist/src/managed-runtime/managed-extension-projection.js`);
function merge(base, patch) { const v = structuredClone(base ?? {}); for (const [k, r] of Object.entries(patch)) v[k] = r !== null && typeof r === 'object' && !Array.isArray(r) ? merge(v[k], r) : r; return v; }
const T = fx.templates.channel_delivery;
const get = (id) => { const c = fx.successors.find((s) => s.id === id); return { ...c, b: merge(T, c.before), a: merge(T, c.after) }; };
const p = get('delivery-unknown-proves-partial'), r = get('delivery-partial-resumes'), n = get('delivery-unknown-never-resends');
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const settled = (d) => d.segments.filter((s) => s.receipt !== null).length;
console.log(`delivery-unknown-proves-partial  (fixture valid=${p.valid})  ${p.b.run.delivery.state}/${p.b.run.state} receipts=${settled(p.b)} -> ${p.a.run.delivery.state}/${p.a.run.state} receipts=${settled(p.a)}   isSuccessor=${B.channel_delivery.isSuccessor(p.b, p.a)}`);
console.log(`delivery-partial-resumes         (fixture valid=${r.valid})  ${r.b.run.delivery.state}/${r.b.run.state} receipts=${settled(r.b)} -> ${r.a.run.delivery.state}/${r.a.run.state} receipts=${settled(r.a)}   isSuccessor=${B.channel_delivery.isSuccessor(r.b, r.a)}`);
console.log(`delivery-unknown-never-resends   (fixture valid=${n.valid}) ${n.b.run.delivery.state}/${n.b.run.state} receipts=${settled(n.b)} -> ${n.a.run.delivery.state}/${n.a.run.state} receipts=${settled(n.a)}   isSuccessor=${B.channel_delivery.isSuccessor(n.b, n.a)}`);
console.log(`proves-partial.before == never-resends.before : ${same(p.b, n.b)}`);
console.log(`proves-partial.after  == partial-resumes.before: ${same(p.a, r.b)}`);
console.log(`partial-resumes.after == never-resends.after  : ${same(r.a, n.a)}`);
console.log(`receipts proves-partial.before vs .after identical: ${same(p.b.segments, p.a.segments)}`);
