// results.partial.json (collect.mjs) + probe outputs + later-step logs -> results.json for gen.mjs.
import fs from 'node:fs';

const DIR = '/Users/wenshao/pr14131-rig';
const rd = (p) => fs.readFileSync(`${DIR}/${p}`, 'utf8');
const r = JSON.parse(rd('results.partial.json'));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ---- probes ----
const birthRows = [...rd('probe/birth-time-probe.txt').matchAll(/RESULT shape=(\w+)\s+pin=(\w+)\s+refused=(\d+)\/(\d+)\s+e\.g\. creationTime=(\S+) lastModifiedTime=(\S+) -> (.*)/g)]
  .map((m) => ({ shape: m[1] === 'flat' ? 'mkdir root; mkdir root/child' : 'mkdirs root/workspace/child', pin: m[2] === 'true', refused: +m[3], n: +m[4],
    sample: `btime ${m[5].slice(11)}  mtime ${m[6].slice(m[6].startsWith('1970') ? 0 : 11)}  → ${m[7].startsWith('REFUSED') ? 'refused' : 'accepted'}` }));
const aliasRows = rd('probe/alias-probe-it_base_full.txt').split('\n').filter((l) => /^hosted-tools-/.test(l)).map((l) => l.trim().split(/\s+/));
const alias = { n: aliasRows.length, oldHits: aliasRows.filter((c) => c[4] !== '0').length, joinOne: aliasRows.filter((c) => c[5] === '1').length };
const cli = rd('probe/cli-cause.txt').split('\n').filter((l) => l && !/commons-logging/.test(l))
  .map((l) => l.replace(/ \(attempt \d+\)/, '').replace(/(\d\d:\d\d:\d\d\.\d+) \+0000/g, '$1'));

// ---- later CI steps on head ----
const after = strip(rd('out/after-head2-r1.log'));
const stepRc = (log, name) => { const m = log.match(new RegExp(`### STEP ${name.replace(/[:]/g, '\\:')} rc=(\\d+) wall=(\\d+)s`)); return m ? { rc: +m[1], wall: `${m[2]} s` } : null; };
const e2eFact = (name) => {
  const part = after.split(/^### STEP /m).find((p) => p.startsWith(`${name} start`)) ?? '';
  const j = JSON.parse(part.match(/\{\n[\s\S]*?\n\}/)?.[0] ?? '{}');
  const bits = [];
  if (j.writerGeneration) bits.push(`writer ${j.writerGeneration}`);
  if (j.firstHarnessBootId && j.replacementHarnessBootId && j.firstHarnessBootId !== j.replacementHarnessBootId) bits.push('new Harness boot');
  if (j.expectedUtf8Bytes) bits.push(`${j.expectedUtf8Bytes} B answer`);
  if (j.restoredFirstTurnContext) bits.push('context restored');
  if (j.terminalTurns != null) bits.push(`${j.terminalTurns} terminal turn${j.terminalTurns === 1 ? '' : 's'}`);
  return bits.join(' · ');
};
const vitestCount = (file) => after.match(new RegExp(`${file.replace(/[./]/g, '\\$&')} \\((\\d+) tests\\)`))?.[1];
const step = (name, cmd, s, okText) => ({ name, cmd, ok: s?.rc === 0, result: s?.rc === 0 ? okText : `rc=${s?.rc}`, wall: s?.wall ?? '' });
const gatesHead = strip(rd('out/gates-head2g-r1.log'));
const gatesBase = strip(rd('out/gates-base-adm.log'));
const gatesFix = strip(rd('out/gates-gatefix-adm.log'));
const o4 = strip(rd('out/gates-head2g-o4r3.log'));
const fsTot = (log) => [...log.matchAll(/^\[(?:INFO|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+\s*$/gm)].at(-1)?.slice(1).map(Number);
const section = (log, name) => log.slice(log.indexOf(`### STEP ${name} start`), log.indexOf(`### STEP ${name} rc=`));
const gate = (log, name = 'admission-gates') => { const t = fsTot(section(log, name)); return t ? `${t[0]} run · ${t[1]}F/${t[2]}E` : '?'; };
const brokerTot = after.match(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+\s*\n[\s\S]*?### STEP broker-fault-gates rc/)?.slice(1).map(Number);

const e2es = ['managed-session-failover', 'managed-inflight-failover', 'managed-continuation-failover', 'managed-big-output',
  'managed-harness-restart-failover', 'managed-harness-restart-inflight-failover', 'managed-harness-restart-continuation-failover',
  'managed-continuation-frozen-owner-failover'];
r.steps = [
  step('Check Hosted proxy header relay', 'vitest helpers/hosted-relay-headers.test.ts', stepRc(after, 'relay-headers'), `${vitestCount('helpers/hosted-relay-headers.test.ts')}/${vitestCount('helpers/hosted-relay-headers.test.ts')} passed`),
  { name: 'Verify Hosted Java, Spring and MySQL processes', cmd: '-Phosted-harness-mysql clean verify checkstyle:check', ok: true, result: 'BUILD SUCCESS (card 1)', wall: r.staticLines.total.replace('Total time:', '').trim() },
  step('Check that every Hosted integration test class ran', 'check-failsafe-reports.js hosted', stepRc(after, 'check-failsafe-hosted'), 'all classes reported'),
  step('Check Hosted latency measurements', 'vitest cli/hosted-latency-baseline.test.ts', stepRc(after, 'latency'), `${vitestCount('cli/hosted-latency-baseline.test.ts')}/${vitestCount('cli/hosted-latency-baseline.test.ts')} passed`),
  step('Run Runtime Broker fault gates', 'runtime-broker -Pfault-gates test', stepRc(after, 'broker-fault-gates'), brokerTot ? `${brokerTot[0]} run · ${brokerTot[1]}F/${brokerTot[2]}E` : 'ok'),
  ...e2es.map((e) => step(`E2E ${e.replace('managed-', '')}`, `npm run test:e2e:${e}`, stepRc(after, `e2e:${e}`), e2eFact(`e2e:${e}`))),
  { name: 'Verify Hosted admission gates', cmd: '-Phosted-harness-gates clean verify', ok: false, result: `${gate(gatesHead)} — same on base 91385884 (${gate(gatesBase)}) and in CI`, wall: stepRc(gatesHead, 'admission-gates')?.wall },
  { name: '  …with the candidate gate-registration patch', cmd: 'PR head + 36 test lines (see report)', ok: stepRc(gatesFix, 'admission-gates')?.rc === 0, result: gate(gatesFix), wall: stepRc(gatesFix, 'admission-gates')?.wall },
  { name: 'Verify O4 filesystem process and capacity gates', cmd: '-Po4-mysql-gates clean verify + report check', ok: stepRc(o4, 'o4-gates')?.rc === 0, result: `${gate(o4, 'o4-gates')} (2nd try; 1st hit #14126 in its unit phase, as CI did)`, wall: stepRc(o4, 'o4-gates')?.wall },
];

// ---- commit-2 unit controls ----
const unit = (f) => strip(rd(f));
const ub = unit('out/unit-basetest-mig.log'), uv = unit('out/unit-v1test-mig.log');
r.unitControls = [
  { arm: 'base 91385884 + new test', what: 'no cause attached, deepest-cause scan', failed: !/Tests run: 25, Failures: 0, Errors: 0/.test(ub), expectFail: false, result: /Tests run: 25, Failures: 0, Errors: 0/.test(ub) ? '25/25 pass' : 'FAIL', detail: 'causeless refusal → workspace_unavailable' },
  { arm: 'commit 1 (45cf7b86) + new test', what: 'cause attached, deepest-cause scan', failed: /Failures: 1/.test(uv), expectFail: true, result: /Failures: 1/.test(uv) ? '1 failure (expected)' : 'pass?', detail: (uv.match(/expected: "[^"]+"\s*\n\s*but was: "[^"]+"/)?.[0] ?? '').replace(/\s*\n\s*/, ' ') },
  { arm: `PR head (${r.head.slice(0, 8)})`, what: 'cause attached, shallowest-first scan', failed: false, expectFail: false, result: '25/25 pass', detail: 'inside the 2570-test surefire run above' },
];

r.birth = { rows: birthRows };
r.alias = alias;
r.cli = cli;
r.env = process.env.ENV_LINE;
fs.writeFileSync(`${DIR}/results.json`, JSON.stringify(r, null, 2));
console.log(JSON.stringify({ birthRows, alias, cli, steps: r.steps, unitControls: r.unitControls }, null, 1));
