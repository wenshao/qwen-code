// Print the first behavioural failure reason from a Maven IT log.
const text = require('fs').readFileSync(process.argv[2], 'utf8');
const lines = text.split('\n');
const pick = [];
for (const re of [/AssertionError \[ERR_ASSERTION\]: (.*)/, /^\s*(Error: Timed out after \d+ms)/, /message: '([^']*)'/, /(\+ actual - expected.*)/,
  /\[ERROR\].*HostedWorkspaceToolTurnIT.*?(\w+Error[^\n]{0,160})/, /^(Expected|expected|Expecting)[^\n]{0,160}/, /^\s*([+-] \s*\d+,?)$/]) {
  for (const l of lines) { const m = l.match(re); if (m) { pick.push(m[1].trim().slice(0, 200)); break; } }
}
const ok = /Tests run: 1, Failures: 0, Errors: 0/.test(text);
console.log(ok ? 'PASS (mutant survived)' : [...new Set(pick)].join(' || ') || 'no reason found');
