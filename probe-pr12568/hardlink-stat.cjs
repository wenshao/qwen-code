const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const [label] = process.argv.slice(2);
const rows = [];
for (let i = 0; i < 40; i++) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repo-context-')));
  const plan = path.join(root, 'plan.json'); fs.writeFileSync(plan, '{}');
  const alias = path.join(root, 'alias.json'); fs.linkSync(plan, alias);
  const n1 = fs.statSync(plan), n2 = fs.statSync(alias), b1 = fs.statSync(plan, { bigint: true }), b2 = fs.statSync(alias, { bigint: true });
  const safe = Number.isSafeInteger(n1.ino) && n1.ino > 0 && Number.isSafeInteger(n2.ino) && n2.ino > 0;
  const mainSays = safe ? (n1.dev === n2.dev && n1.ino === n2.ino) : (fs.realpathSync.native(plan) === fs.realpathSync.native(alias));
  const prSays = b1.ino !== 0n && b2.ino !== 0n ? (b1.dev === b2.dev && b1.ino === b2.ino) : null;
  rows.push({ i, nIno: n1.ino, nInoAlias: n2.ino, bIno: String(b1.ino), bInoAlias: String(b2.ino), hex: '0x' + b1.ino.toString(16), over53: b1.ino > 2n ** 53n, safe, nDev: n1.dev, nDevAlias: n2.dev, bDev: String(b1.dev), mainSays, prSays });
}
const summary = { label, tmpdir: os.tmpdir(), n: rows.length, over53: rows.filter(r => r.over53).length, unsafeNumber: rows.filter(r => !r.safe).length, mainRecognised: rows.filter(r => r.mainSays).length, prRecognised: rows.filter(r => r.prSays).length, first3: rows.slice(0, 3), firstMainMiss: rows.find(r => !r.mainSays) ?? null };
console.log('PROBE_JSON ' + JSON.stringify(summary));
