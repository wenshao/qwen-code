const fs = require('node:fs');
const url = process.env.ACTIONS_RESULTS_URL || '';
console.log('ACTIONS_RESULTS_URL=' + url);
const host = url ? new URL(url).hostname : '';
console.log('resolved results host=' + host);
fs.appendFileSync(process.env.GITHUB_ENV, `PROBE_RESULTS_HOST=${host}\n`);
