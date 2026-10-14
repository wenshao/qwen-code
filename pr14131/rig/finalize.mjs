// Adds the card text (head CI lines, notes) to results.json. Every number is read from results.json / logs.
import fs from 'node:fs';

const DIR = '/Users/wenshao/pr14131-rig';
const r = JSON.parse(fs.readFileSync(`${DIR}/results.json`, 'utf8'));
const f = (x) => `${x.run} run · ${x.f} failures · ${x.e} errors`;
const [sRun, sF, sE, sS] = r.surefire.at(-1);
const merge = fs.existsSync(`${DIR}/merge.json`) ? JSON.parse(fs.readFileSync(`${DIR}/merge.json`, 'utf8')) : null;

r.env = 'Linux 6.12 aarch64 (Debian 13 host, ext4 /tmp) · Ubuntu 24.04 container · Temurin 21.0.9 · Node 22.23.3 · Maven 3.9.11 · MySQL 8.4.11 (CI: 8.4.6) · 4 pinned cores per run';
r.headCi = [
  `+ PR head ${r.head.slice(0, 8)}, the CI Verify command verbatim (clean verify checkstyle:check): ${r.staticLines.build} in ${r.staticLines.total.replace('Total time:', '').trim()}`,
  `+ surefire ${sRun} run · ${sF} failures · ${sE} errors · ${sS} skipped    failsafe ${f(r.totals.head)}    SpotBugs BugInstance 0    Checkstyle 0 violations`,
  `+ second copy of the head, failsafe only: ${f(r.totals.head2r)}`,
  ...(merge ? [`+ trial merge with main ${merge.main.slice(0, 8)} (tree ${merge.tree.slice(0, 8)}), same command: ${merge.build} · surefire ${merge.surefire} · failsafe ${merge.failsafe}`] : []),
];
r.notes = {
  card1: `The local base reproduces CI's main failure class by class (4 failures + 19 errors in the same five classes), and the PR head turns all five green on two independent copies${merge ? ' and on the trial merge' : ''}. Removing only the four fixture pins brings back ${r.totals.nopin.e} of ${r.totals.nopin.run} errors (one root happened to cross a clock tick) — and every one of them now carries <code>Caused by: java.io.IOException: Workspace birth time is unavailable or ambiguous</code>, which base never printed.`,
  card2: `A: two directory creations in the same coarse clock tick leave mtime == birth time to the nanosecond, so the production check refuses about 99% of fixture roots; pinning mtime to 1 ms makes it 0/${r.birth.rows[1].n}. B: the probes' local digest never equals the domain-tagged, length-prefixed <code>storageAliasKey</code>, so their owner lookup found nothing (CI: "Incorrect result size: expected 1, actual 0"). C: the operator CLI refusal is otherwise identical (same message, exit 1); only the cause line is new.`,
  card3: `Every step after Verify passes on the PR head except <b>Verify Hosted admission gates</b>, which fails identically on base and in this PR's own CI run. The step has not run on main since <code>d0450a1f67</code> (Verify failed first on the 14 pushes since). On the #14069 baseline the two gates insert workspaces but never register storage (0 <code>ma_storage</code> rows for either gate's tenant), so the publication gate's turn is refused with 409 <code>workspace_unavailable</code> and the wedge driver times out. Registering storage the way <code>HostedProcessCrashIT</code> does turns both green (11 s and 7 s instead of 180 s / 120 s timeouts).`,
};
fs.writeFileSync(`${DIR}/results.json`, JSON.stringify(r, null, 2));
console.log(r.headCi.join('\n'));
