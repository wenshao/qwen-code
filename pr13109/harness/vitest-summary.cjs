// vitest-summary.cjs <json> -> "pass=N fail=M | failing test names"
const fs = require('fs');
let j;
try { j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { console.log('NO_JSON ' + e.message); process.exit(0); }
const failed = [];
for (const f of j.testResults ?? []) {
  for (const a of f.assertionResults ?? []) if (a.status === 'failed') failed.push(a.fullName.trim());
  if (!(f.assertionResults ?? []).length && f.status === 'failed') failed.push('SUITE_ERROR ' + require('path').basename(f.name) + ' ' + String(f.message).slice(0, 200));
}
console.log(`pass=${j.numPassedTests} fail=${j.numFailedTests} total=${j.numTotalTests}` + (failed.length ? ' | ' + failed.join(' ;; ') : ''));
