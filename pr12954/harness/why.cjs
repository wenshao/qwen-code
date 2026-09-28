// usage: node why.cjs <it log> [driver source]  -> one-line kill reason
const fs = require('fs');
const log = fs.readFileSync(process.argv[2], 'utf8');
const src = fs.readFileSync(process.argv[3] ||
  '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5f811a9d-a146-46e4-8a2e-161614683807/scratchpad/wt-pr/integration-tests/helpers/hosted-shell-output-driver.ts', 'utf8').split('\n');
if (/^HOSTED_SHELL_OUTPUT_FAULTS_OK/m.test(log) && /BUILD SUCCESS/.test(log)) { console.log('survived'); process.exit(0); }
const out = [];
// Node driver assertion: first ERR_ASSERTION block
const m = log.match(/AssertionError \[ERR_ASSERTION\]: ([^\n]{0,160})[\s\S]*?hosted-shell-output-driver\.ts:(\d+):\d+\)?[\s\S]*?(?:actual: ([^\n]+)\n\s+expected: ([^\n]+))?/);
if (m) {
  const frames = [...log.slice(log.indexOf(m[0])).split('\n').slice(0, 40).join('\n').matchAll(/hosted-shell-output-driver\.ts:(\d+):\d+/g)].map((x) => +x[1]);
  const line = frames.find((n) => !/^\s*(async function|function|return|const response|assert\.equal\(response)/.test(src[n - 1] || '')) || frames[0];
  const tail = log.slice(log.indexOf(m[0])).split('\n').slice(0, 60).join('\n');
  const act = tail.match(/\n\s+actual: ([^\n]+)/); const exp = tail.match(/\n\s+expected: ([^\n]+)/);
  out.push(`driver:${line} \`${(src[line - 1] || '').trim().slice(0, 90)}\`` + (act ? ` actual=${act[1].slice(0, 60)} expected=${exp ? exp[1].slice(0, 60) : '?'}` : ` msg=${m[1].slice(0, 90)}`));
}
// Java/AssertJ assertion
if (!out.length) {
  const j = log.match(/(?:AssertionError|AssertionFailedError):\s*\n?\s*(\[[^\]]*\])?\s*\n?([\s\S]{0,600}?)\n\s+at /);
  if (j) out.push('java ' + ((j[1] || '') + ' ' + j[2]).replace(/\s+/g, ' ').slice(0, 220));
}
if (!out.length) { const t = log.match(/Timed out after \d+ms|Driver timeout|ERROR\][^\n]{0,160}/); out.push(t ? t[0] : 'unknown'); }
console.log(out.join(' | '));
