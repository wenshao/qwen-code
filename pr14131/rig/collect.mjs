// Builds results.json for gen.mjs from the rig logs copied to ./out (and the CI main log).
import fs from 'node:fs';

const DIR = '/Users/wenshao/pr14131-rig';
const read = (p) => fs.readFileSync(`${DIR}/${p}`, 'utf8').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, '');
const AFFECTED = ['HostedShellLifecycleRecoveryIT', 'HostedPublicWorkspaceIT', 'HostedWorkspaceToolTurnIT',
  'HostedTeamLeadMySqlIT', 'HostedProcessCrashIT'];

// Failsafe section only: between "failsafe:<v>:integration-test" and "failsafe:<v>:verify".
function failsafe(text) {
  const start = text.search(/failsafe:[\d.]+:integration-test/);
  if (start < 0) throw new Error('no failsafe section');
  const end = text.slice(start).search(/failsafe:[\d.]+:verify/);
  const sec = end < 0 ? text.slice(start) : text.slice(start, start + end);
  const classes = {};
  for (const m of sec.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+), Time elapsed: ([\d.]+) s.*?-- in com\.alibaba\.qwen\.code\.managedagent\.(?:[a-z]+\.)*(\w+)/g)) {
    classes[m[6]] = { run: +m[1], f: +m[2], e: +m[3], s: +m[4], t: +m[5] };
  }
  const tot = [...sec.matchAll(/^\[(?:INFO|ERROR|WARNING)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].at(-1);
  return { classes, total: tot ? { run: +tot[1], f: +tot[2], e: +tot[3], s: +tot[4] } : null };
}
const sum = (rs) => rs.reduce((a, r) => ({ run: a.run + r.run, f: a.f + r.f, e: a.e + r.e }), { run: 0, f: 0, e: 0 });
const others = (fs_) => sum(Object.entries(fs_.classes).filter(([k]) => !AFFECTED.includes(k)).map(([, v]) => v));

const ci = failsafe(read('main-hosted.log'));
const base = failsafe(read('out/it-base-full.log'));
const head = failsafe(read('out/it-head2-ci.log'));
const head2r = failsafe(read('out/it-head2r-r2.log'));
const nopin = failsafe(read('out/it-nopin-r1.log'));
const otherNames = Object.keys(head.classes).filter((k) => !AFFECTED.includes(k));

// Surefire / static-analysis lines of the exact CI command on head.
const headLog = read('out/it-head2-ci.log');
const surefireTot = [...headLog.slice(0, headLog.search(/failsafe:[\d.]+:integration-test/))
  .matchAll(/^\[(?:INFO|ERROR|WARNING)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].map((m) => m.slice(1).map(Number));
const line = (re) => headLog.match(re)?.[0];

const results = {
  head: process.env.HEAD_SHA,
  ciJob: '115658073737',
  env: process.env.ENV_LINE,
  classes: AFFECTED.map((name) => ({ name, ci: ci.classes[name], base: base.classes[name], head: head.classes[name], head2r: head2r.classes[name], nopin: nopin.classes[name] })),
  totals: {
    otherCount: otherNames.length,
    ciOther: others(ci), baseOther: others(base), headOther: others(head), head2rOther: others(head2r),
    ci: ci.total, base: base.total, head: head.total, head2r: head2r.total, nopin: nopin.total,
  },
  surefire: surefireTot,
  staticLines: { checkstyle: line(/You have \d+ Checkstyle violations?\./g), spotbugs: line(/BugInstance size is \d+/), build: line(/BUILD (SUCCESS|FAILURE)/), total: line(/Total time:\s+[\d:.]+ \w+/) },
};
fs.writeFileSync(`${DIR}/results.partial.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ...results, classes: results.classes.map((c) => [c.name, c.ci, c.base, c.head, c.head2r, c.nopin]) }, null, 1));
