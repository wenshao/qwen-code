const fs = require('node:fs');
const [file, label] = process.argv.slice(2);
const txt = fs.readFileSync(file, 'utf8');
const rows = txt.split(/\r?\n/).filter((l) => l.includes('SAMEFILE_TRACE ')).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
const hard = rows.filter((r) => r.lBig === r.rBig && r.left !== r.right);
const out = {
  label, calls: rows.length,
  unsafeNumberCalls: rows.filter((r) => !r.lSafe || !r.rSafe).length,
  sameIdPairs: hard.length,
  sameIdPairsUnsafe: hard.filter((r) => !r.lSafe).map((r) => ({ pair: r.left.split(/[\\/]/).slice(-2).join('/') + ' ~ ' + r.right.split(/[\\/]/).pop(), big: r.lBig, seqHigh16: String(BigInt(r.lBig) >> 48n), number: r.lIno })),
  aliasCase: hard.filter((r) => /alias\.json$/.test(r.right)).map((r) => ({ big: r.lBig, seqHigh16: String(BigInt(r.lBig) >> 48n), safe: r.lSafe })),
  summaryLine: (txt.match(/Tests +[^\n]*/g) || []).pop(),
  failed: (txt.match(/× [^\n]*/g) || []).slice(0, 6),
};
console.log('TRACE_SUMMARY ' + JSON.stringify(out));
