// Independent corroboration from CI's own test-results artifact, so the report
// does not rest on my local runs alone.
//
// Source: artifact 11235865872 of run 36961242579 (job 110878145206,
// `Test (ubuntu-latest, Node 22.x)`, head 2a702c316d, completed success at
// 2026-10-02T15:27:10Z). The raw junit XMLs (24 MB) live in <art>/ci-junit/;
// the distilled extract is logs/ci-junit-summary.txt.
//
// Usage: node ci-junit.mjs <artifactDir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [art, outFile] = process.argv.slice(2);
if (!art || !outFile) throw new Error('usage: ci-junit.mjs <artifactDir> <out.json>');

const cli = readFileSync(path.join(art, 'ci-junit', 'cli-junit.xml'), 'utf8');
const core = readFileSync(path.join(art, 'ci-junit', 'core-junit.xml'), 'utf8');
const web = readFileSync(path.join(art, 'ci-junit', 'web-shell-junit.xml'), 'utf8');

const SUITE = /<testsuite name="([^"]+)"[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*skipped="(\d+)"/g;
const parse = (xml) => {
  const m = new Map();
  for (const g of xml.matchAll(SUITE))
    m.set(g[1], { tests: +g[2], failures: +g[3], errors: +g[4], skipped: +g[5] });
  return m;
};
const C = parse(cli);
const K = parse(core);

const results = [];
let pass = 0;
let fail = 0;
function check(id, what, ok, detail) {
  if (ok) pass++;
  else fail++;
  results.push({ id, what, ok: !!ok, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${what}${ok || !detail ? '' : `\n        ${detail}`}`);
}

const RELATED = [
  'src/commands/serve.test.ts',
  'src/serve/fast-path.test.ts',
  'src/serve/hosted-harness-profile.test.ts',
  'src/serve/run-qwen-serve.test.ts',
];

console.log('=== CI ran the PR\'s new test, on the runner, green ===');
const serve = C.get('src/commands/serve.test.ts');
check('CI/1', 'CI: src/commands/serve.test.ts = 78 tests, 0 failures, 0 errors, 0 skipped',
  serve && serve.tests === 78 && serve.failures === 0 && serve.errors === 0 && serve.skipped === 0,
  JSON.stringify(serve));
const i = cli.indexOf('documents Hosted Runtime Broker options and does not declare them unimplemented');
check('CI/2', 'the new testcase itself appears in CI\'s junit report', i > 0, `offset ${i}`);
const seg = i > 0 ? cli.slice(cli.lastIndexOf('<testcase', i), cli.indexOf('</testcase>', i) + 11) : '';
check('CI/3', 'that testcase carries no <failure> or <error> element',
  seg.length > 0 && !/<(failure|error)/.test(seg), seg.slice(0, 200));
check('CI/4', 'CI\'s 78 matches my local 78/78 at both pty widths', serve?.tests === 78, '');

console.log('\n=== CI\'s per-file counts reproduce my local 709/709 exactly ===');
let sum = 0;
for (const n of RELATED) {
  const s = C.get(n);
  sum += s?.tests ?? 0;
  check(`CI/5/${n.split('/').pop()}`, `CI: ${n} = ${s?.tests} tests, 0 failures`,
    s && s.failures === 0 && s.errors === 0, JSON.stringify(s));
}
check('CI/6', `the four related suites sum to 709 on CI, identical to the local run (78+114+19+498)`,
  sum === 709, `CI sum = ${sum}`);

console.log('\n=== both round-2 CI flakes are green ON CI at this head ===');
const wsa = C.get('src/serve/routes/workspace-agents.test.ts');
check('CI/7', 'R2-1 resolved on CI: routes/workspace-agents.test.ts = 6 tests, 0 failures',
  wsa && wsa.tests === 6 && wsa.failures === 0 && wsa.errors === 0, JSON.stringify(wsa));
const lat = K.get('src/memory/recall-scan-latency.test.ts');
check('CI/8', 'R2-2 resolved on CI: recall-scan-latency.test.ts = 7 tests, 0 failures (the merge brought #13094)',
  lat && lat.tests === 7 && lat.failures === 0 && lat.errors === 0, JSON.stringify(lat));

console.log('\n=== the whole CI test run is clean ===');
const totals = (xml) => {
  let t = 0, f = 0, e = 0;
  for (const g of xml.matchAll(SUITE)) { t += +g[2]; f += +g[3]; e += +g[4]; }
  return { t, f, e };
};
// Cross-check the summed per-file counts against the reporter's own root
// element, so a regex that silently under- or over-counts cannot pass. (An
// earlier loose `tests="(\d+)"` sweep double-counted by including this root.)
const root = (xml) => {
  const m = xml.match(/<testsuites[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"/);
  return m ? { t: +m[1], f: +m[2], e: +m[3] } : null;
};
for (const [name, xml] of [['cli', cli], ['core', core], ['web-shell', web]]) {
  const { t, f, e } = totals(xml);
  check(`CI/9/${name}`, `CI ${name} suite: ${t} tests, 0 failures, 0 errors`, f === 0 && e === 0 && t > 0,
    `tests=${t} failures=${f} errors=${e}`);
  const r = root(xml);
  check(`CI/10/${name}`, `the summed per-file total equals the reporter's own root element for ${name}`,
    r && r.t === t && r.f === f && r.e === e,
    `summed ${t}/${f}/${e} vs root ${JSON.stringify(r)}`);
}

writeFileSync(outFile, JSON.stringify({ pass, fail, results }, null, 2));
console.log(`\nCI corroboration: ${pass} passed, ${fail} failed, ${results.length} assertions`);
process.exit(fail === 0 ? 0 : 1);
