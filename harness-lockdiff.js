// Enumerate every resolved (path -> name@version) in an npm lockfile.
const fs = require('fs');
function load(p) {
  const l = JSON.parse(fs.readFileSync(p, 'utf8'));
  const m = new Map();
  for (const [k, v] of Object.entries(l.packages)) {
    if (!v.version) continue;
    m.set(k, v.version);
  }
  return m;
}
const a = load(process.argv[2]);
const b = load(process.argv[3]);
const keys = new Set([...a.keys(), ...b.keys()]);
const changed = [], added = [], removed = [];
for (const k of [...keys].sort()) {
  const x = a.get(k), y = b.get(k);
  if (x === y) continue;
  if (x === undefined) added.push(`${k} => ${y}`);
  else if (y === undefined) removed.push(`${k} => ${x}`);
  else changed.push(`${k}: ${x} -> ${y}`);
}
console.log(`entries base=${a.size} head=${b.size}`);
console.log(`\n--- CHANGED (${changed.length}) ---`); changed.forEach(s=>console.log(s));
console.log(`\n--- ADDED (${added.length}) ---`); added.forEach(s=>console.log(s));
console.log(`\n--- REMOVED (${removed.length}) ---`); removed.forEach(s=>console.log(s));
const nonSharp = [...changed, ...added, ...removed].filter(s => !/sharp|@img/.test(s));
console.log(`\n--- NON-SHARP DRIFT (${nonSharp.length}) ---`); nonSharp.forEach(s=>console.log(s));
