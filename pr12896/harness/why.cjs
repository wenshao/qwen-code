// Extract the first behavioural failure from an IT log: driver assertion or Java ledger assertion.
const fs = require('fs');
const t = fs.readFileSync(process.argv[2], 'utf8');
const lines = t.split('\n');
const d = lines.findIndex((l) => l.includes('AssertionError [ERR_ASSERTION]') || /^Error: /.test(l));
if (d >= 0) {
  const msg = lines[d].replace(/.*AssertionError \[ERR_ASSERTION\]: /, '').replace(/qwen serve:.*/, '').slice(0, 110);
  const tail = lines.slice(d, d + 80);
  const actual = tail.find((l) => /^\s+actual:/.test(l))?.trim() ?? '';
  const expected = tail.find((l) => /^\s+expected:/.test(l))?.trim() ?? '';
  const at = tail.find((l) => /crash-driver(\.fix)?\.ts:\d+/.test(l))?.match(/[\w.-]+-driver(\.fix)?\.ts:\d+/)?.[0] ?? '';
  console.log(`driver ${at}: ${msg} ${actual} ${expected}`.replace(/\s+/g, ' ').trim());
} else {
  const j = lines.findIndex((l) => l.includes('AssertionFailedError') || l.includes('AssertionError:') || l.includes('ConditionTimeout'));
  if (j >= 0) {
    const body = lines.slice(j, j + 12);
    const at = body.find((l) => /HostedProcessCrashIT\.java:\d+/.test(l))?.match(/HostedProcessCrashIT\.java:\d+/)?.[0] ?? '';
    const msg = body.slice(0, 8).join(' ').replace(/\s+/g, ' ').replace(/at com\..*/, '').slice(0, 260);
    console.log(`java ${at}: ${msg}`);
  } else console.log(t.includes('BUILD SUCCESS') ? 'SURVIVED (build success)' : 'no assertion found');
}
