// Extract the first behavioural failure from an IT log: driver assertion or Java probe/IT assertion.
const fs = require('fs');
const t = fs.readFileSync(process.argv[2], 'utf8');
const lines = t.split('\n');
const d = lines.findIndex((l) => l.includes('AssertionError [ERR_ASSERTION]') || /^Error: /.test(l) || /^\s*Error: /.test(l) && !l.includes('ERROR]'));
if (d >= 0) {
  const msg = lines[d].replace(/.*AssertionError \[ERR_ASSERTION\]: /, '').replace(/qwen serve:.*/, '').slice(0, 120);
  const tail = lines.slice(d, d + 80);
  const actual = tail.find((l) => /^\s+actual:/.test(l))?.trim() ?? '';
  const expected = tail.find((l) => /^\s+expected:/.test(l))?.trim() ?? '';
  const at = tail.find((l) => /cancellation-driver\.ts:\d+/.test(l))?.match(/hosted-cancellation-driver\.ts:\d+/)?.[0] ?? '';
  const pre = lines.slice(Math.max(0, d - 3), d).find((l) => l.startsWith('FG6D ')) ?? '';
  console.log(`driver ${at}: ${msg} ${actual} ${expected} ${pre.slice(0, 60)}`.replace(/\s+/g, ' ').trim());
} else {
  const j = lines.findIndex((l) => l.includes('AssertionFailedError') || l.includes('AssertionError:') || l.includes('ConditionTimeout') || l.includes('independent cancellation probe'));
  if (j >= 0) {
    const body = lines.slice(j, j + 14);
    const at = body.find((l) => /(HostedCancellationProbe|HostedWorkspaceToolTurnIT)\.java:\d+/.test(l))?.match(/\w+\.java:\d+/)?.[0] ?? '';
    const msg = body.slice(0, 8).join(' ').replace(/\s+/g, ' ').replace(/at com\..*/, '').slice(0, 300);
    console.log(`java ${at}: ${msg}`);
  } else console.log(t.includes('BUILD SUCCESS') ? 'SURVIVED (build success)' : 'no assertion found');
}
