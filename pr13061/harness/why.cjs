// usage: node why.cjs <log>...  -- one-line failure reason per IT log
const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  const label = file.replace(/.*it-/, '').replace(/\.log$/, '');
  if (/^HOSTED_PROVIDER_FAULTS_OK/m.test(text) && /BUILD SUCCESS/.test(text)) { console.log(`${label}: PASS`); continue; }
  let reason = '';
  const scenario = (text.match(/FG6F_PROVIDER (start-retry|raw-contract|release-reply) \{/) || [])[1];
  // Driver-side node:assert failure
  const node = text.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]*)[\s\S]*?actual: ([^\n]*)\n\s*expected: ([^\n]*)/);
  const rejects = text.match(/AssertionError \[ERR_ASSERTION\]: (Missing expected rejection[^\n]*)/);
  const javaAs = text.match(/\[([^\]\n]{3,80})\][ \t]*\n\s*expected: ([^\n]*)\n\s*but was: ([^\n]*)/);
  const javaPlain = text.match(/expected: ([^\n]*)\n\s*but was: ([^\n]*)/);
  const brokerErr = text.match(/BrokerResponseError: [^\n]*\n[\s\S]{0,1200}?status: (\d+),\s*\n\s*code: '([^']*)'/);
  const msgCode = node && (node[1].match(/"code":"([a-z_]+)"/) || [])[1];
  if (rejects) reason = rejects[1];
  else if (brokerErr && (!node || text.indexOf('BrokerResponseError: ') < text.indexOf('ERR_ASSERTION'))) reason = 'driver got Broker ' + brokerErr[1] + ' ' + brokerErr[2];
  else if (node) reason = `driver assert actual=${node[2].trim()} expected=${node[3].trim()}${msgCode ? ' code=' + msgCode : ''}`;
  else if (brokerErr) reason = `driver got Broker ${brokerErr[1]} ${brokerErr[2]}`;
  else if (javaAs) reason = `probe [${javaAs[1]}] expected ${javaAs[2].trim()} but was ${javaAs[3].trim()}`;
  else if (javaPlain) reason = `probe expected ${javaPlain[1].trim()} but was ${javaPlain[2].trim()}`;
  else reason = ((text.match(/(Error: [^\n]{0,200})/) || [])[1] || 'unknown').trim();
  console.log(`${label}: FAIL${scenario ? ' in ' + scenario : ''} | ${reason.slice(0, 220)}`);
}
