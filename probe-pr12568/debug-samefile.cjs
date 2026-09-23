// Inject a stderr trace into main's isSameFile (the checked-out base copy).
const fs = require('node:fs');
const p = 'packages/cli/src/commands/review/lib/same-file.ts';
let s = fs.readFileSync(p, 'utf8');
const a = '  if (leftStat !== undefined && rightStat !== undefined) {\n';
if (s.split(a).length !== 2) { console.error('anchor miss'); process.exit(1); }
s = s.replace(a, a + "    process.stderr.write('SAMEFILE_TRACE ' + JSON.stringify({ left, right, lIno: String(leftStat.ino), rIno: String(rightStat.ino), lDev: String(leftStat.dev), rDev: String(rightStat.dev), lSafe: Number.isSafeInteger(Number(leftStat.ino)) && BigInt(Number(statSync(left, { bigint: true }).ino)) === statSync(left, { bigint: true }).ino, rSafe: BigInt(Number(statSync(right, { bigint: true }).ino)) === statSync(right, { bigint: true }).ino, lNlink: String(leftStat.nlink), rNlink: String(rightStat.nlink), lBig: String(statSync(left, { bigint: true }).ino), rBig: String(statSync(right, { bigint: true }).ino) }) + '\\n');\n");
fs.writeFileSync(p, s); console.log('trace injected');
