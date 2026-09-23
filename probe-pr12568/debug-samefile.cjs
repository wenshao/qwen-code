// Inject a stderr trace into main's isSameFile (the checked-out base copy).
const fs = require('node:fs');
const p = 'packages/cli/src/commands/review/lib/same-file.ts';
let s = fs.readFileSync(p, 'utf8');
const a = '  if (leftStat !== undefined && rightStat !== undefined) {\n';
if (s.split(a).length !== 2) { console.error('anchor miss'); process.exit(1); }
s = s.replace(a, a + "    process.stderr.write('SAMEFILE_TRACE ' + JSON.stringify({ left, right, lIno: leftStat.ino, rIno: rightStat.ino, lDev: leftStat.dev, rDev: rightStat.dev, lSafe: Number.isSafeInteger(leftStat.ino), rSafe: Number.isSafeInteger(rightStat.ino), lNlink: leftStat.nlink, rNlink: rightStat.nlink, lBig: String(statSync(left, { bigint: true }).ino), rBig: String(statSync(right, { bigint: true }).ino) }) + '\\n');\n");
fs.writeFileSync(p, s); console.log('trace injected');
