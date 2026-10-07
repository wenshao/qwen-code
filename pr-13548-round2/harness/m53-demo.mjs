import { readFileSync } from 'node:fs';
const [dist, fxPath] = process.argv.slice(2);
const pristine = await import(`${dist}/managed-channel-record.js`);
const mutant = await import(`${dist}/zz-m53-channel-record.js`);
const fx = JSON.parse(readFileSync(fxPath, 'utf8'));
function merge(b, p) { const v = structuredClone(b ?? {}); for (const [k, r] of Object.entries(p)) v[k] = r !== null && typeof r === 'object' && !Array.isArray(r) ? merge(v[k], r) : r; return v; }
const T = fx.templates.channel_delivery;
const c = fx.cases.find((x) => x.id === 'delivery-receipt-bad-time');
const rec = merge(T, c.patch);
const why = (m, r) => { try { m.parseChannelDelivery(r); return 'ACCEPTED'; } catch (e) { return 'refused: ' + e.message; } };
console.log(`fixture delivery-receipt-bad-time (valid=${c.valid}): run=${rec.run.state}/${rec.run.delivery.state}, receipts=${rec.segments.map((s) => s.receipt ? 'acceptedAt ' + s.receipt.acceptedAt : 'null').join(', ')}`);
console.log(`  pristine parser             -> ${why(pristine, rec)}`);
console.log(`  acceptedAt check deleted    -> ${why(mutant, rec)}`);
console.log(`  the suite asserts only "throws", so both satisfy it: mutant 53 survives the corpus`);
const iso = structuredClone(rec); iso.run.state = 'running'; iso.run.delivery.state = 'sending';
console.log(`same receipt on a sending run (isolates the rule):`);
console.log(`  pristine parser             -> ${why(pristine, iso)}`);
console.log(`  acceptedAt check deleted    -> ${why(mutant, iso)}`);
