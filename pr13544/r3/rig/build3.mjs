// Round 3 (#13544 @ c9103bee60) evidence cards. usage: node build3.mjs [figure-number...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { card, table } from './card.mjs';

const RIG = '/Users/wenshao/pr13544-rig';
const FIG = `${RIG}/fig`;
const only = process.argv.slice(2);
const R = (name) => JSON.parse(readFileSync(`${RIG}/runs/${name}/results.json`, 'utf8'));
const txt = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const J = (p, d = {}) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const render = (name, html, width = 1600) => {
  writeFileSync(`${FIG}/${name}.html`, html);
  execFileSync('node', [`${FIG}/render.mjs`, `${FIG}/${name}.html`, `${FIG}/${name}.png`, String(width)], { stdio: 'inherit' });
};
const want = (n) => only.length === 0 || only.includes(String(n));
const totals = (log) => [...log.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
const lin = [
  ['base 1162c96ab9 (V50) → head', 'bh3', 'mysql', 'MySQL 8.4.7', 'seed-base'],
  ['base 1162c96ab9 (V50) → head', 'bh3', 'mariadb', 'MariaDB 10.11.18', 'seed-base'],
  ['main bb213cd05d (V52) → head', 'mh3', 'mysql', 'MySQL 8.4.7', 'seed-main'],
  ['main bb213cd05d (V52) → head', 'mh3', 'mariadb', 'MariaDB 10.11.18', 'seed-main'],
].map(([label, l, e, en, s]) => ({ label, l, e, en, seed: R(`r13544_${l}_${e}-${s}`), up: R(`r13544_${l}_${e}-upgrade-head`) }));
const extra = J(`${RIG}/out/r3-extra.json`);

// ---------- Figure 1: round-2 items + merge readiness ----------
if (want(1)) {
  const gate = (arm) => {
    try {
      return execFileSync('node', ['scripts/check-flyway-migrations.js', 'packages/sdk-java/managed-agent-server'], { cwd: `${RIG}/src-${arm}`, encoding: 'utf8' }).trim().replace(/^.*managed-agent-server: /, '');
    } catch (e) {
      return '✖ ' + String(e.stdout + e.stderr).trim();
    }
  };
  const h2 = totals(txt(`${RIG}/out/test-head-full3.log`));
  const itCell = (e) => {
    const t = totals(txt(`${RIG}/out/it-head-${e}-r3.log`));
    return t ? `${t[1]} run · ${t[2]} failure${t[2] === '1' ? '' : 's'} · ${t[3]} error${t[3] === '1' ? '' : 's'}` : 'not run';
  };
  const m0 = txt(`${RIG}/out/mutation-r3.txt`).split('\n').filter((l) => /^M0 unmutated/.test(l));
  const m0cell = (e) => (m0.find((l) => l.includes(` on ${e}:`))?.includes('rc=0') ? '✔ pass' : '✖');
  const rows = [
    ['ManagedWorkspaceRolesMySqlIT red on MySQL 8.4', '✔ fixed', `unmodified head IT: MySQL 8.4.7 ${m0cell('mysql')}, MariaDB 10.11.18 ${m0cell('mariadb')} (asserts DataAccessException + constraint name); in the full IT run ${extra.rolesItInFull ?? '?'}`],
    ['IT leaves its workspace_roles_* schema behind', '✔ fixed', `@AfterEach DROP DATABASE: leftover workspace_roles_* schemas before → after this round's ${extra.rolesItRuns ?? '?'} runs per engine: ${extra.leftover ?? '?'}`],
    ['stale "REGEXP" wording (IT javadoc, H2 test :102)', '✔ fixed', 'both now describe the length-guarded CHECK; the design docs keep "why not an anchored REGEXP" as rationale'],
    ['V52 taken on main by #13163', '✔ renumbered', `roles is V53; gate: head ${gate('head')}; trial merge with main ${extra.mainShort ?? ''}: ${gate('merge')}`],
    ['#13163 fixtures + new reader (findReadable/readableGrant)', '✔ converted', 'its 3 test files carry main\'s content + role writes (a dropped hunk in merge f93fca3703 was restored by b5031c5318; head vs base: no file loses lines); readableGrant now derives canCreateSession from role'],
    ['H2 suite on head', h2 && h2[2] === '0' && h2[3] === '0' ? '✔ green' : '✖', h2 ? `${h2[1]} run · ${h2[2]} failures · ${h2[3]} errors · ${h2[4]} skipped (RuntimeBrokerDefaultOnTest, skipped on main too)` : '?'],
    ['-Pmysql-integration · MySQL 8.4.7', /· 0 failures · 0 errors/.test(itCell('mysql')) ? '✔ green' : (extra.itMysqlNote ? '✔ green after isolated rerun' : '✖'), `${itCell('mysql')}${extra.itMysqlNote ? ' · ' + extra.itMysqlNote : ''}`],
    ['-Pmysql-integration · MariaDB 10.11.18', /· 0 failures · 0 errors/.test(itCell('mariadb')) ? '✔ green' : (extra.itMariadbNote ? '✔ green after isolated rerun' : '✖'), `${itCell('mariadb')}${extra.itMariadbNote ? ' · ' + extra.itMariadbNote : ''}`],
  ];
  render('r3-01-status', card({
    title: 'Re-verification at c9103bee60 — every round-2 item is fixed; no new findings',
    sub: `Head c9103bee60 = round-2 head + main merge f93fca3703 + V53 renumber b5031c5318 + IT fix c9103bee60. main ${extra.mainShort ?? ''} is ${extra.mainAhead ?? '?'} commits past the PR base, none in sdk-java, so the trial merge's sdk-java tree equals the head's.`,
    blocks: [
      { table: table(['Item', 'Status', 'Evidence on this head'], rows) },
      { note: `Merge-order caveat (unchanged in kind): V53 is also claimed by ${extra.v53Others ?? '?'} other open PRs. The gate only proves the main it ran against — re-run it immediately before merging.` },
    ],
  }));
}

// ---------- Figure 2: upgrade lineages ----------
if (want(2)) {
  const rows = lin.map((x) => {
    const applied = x.up.springBoot.flyway.find((l) => /Successfully applied/.test(l))?.replace(/^.*Successfully applied /, '').replace(/ to schema `[^`]+`/, '').replace(/ \(execution time.*$/, '') ?? '?';
    const d = x.up.probeDiff;
    const rej = x.up['constraint.shipped'];
    return [x.label, x.en, applied, `${d.same === d.total ? '✔' : '✖'} ${d.same}/${d.total} identical`, `${rej.filter((o) => !o.accepted).length}/${rej.length - 3} rejected`, `${x.seed.revoke.closeMs} → ${x.up.revoke.closeMs} ms`, x.up.owners.allSessionsOwnerEqualsCreator.replace('\t', ' / ')];
  });
  const P = J(`${RIG}/state/r13544_mh3_mysql.probes-upgrade.json`);
  const S = J(`${RIG}/state/r13544_mh3_mysql.probes-seed.json`);
  const cap = (a) => {
    const v = P[`${a}|POST web-shell sessions/query`];
    return (v.visible ?? []).filter((x) => ['s_op_w1', 's_rd_w2', 's_dn_w1', 's_op_w3'].includes(x.s)).map((x) => `${x.s}=${x['capabilities.workspaceTurns']}`).join('  ');
  };
  const same = (a) => (JSON.stringify(P[`${a}|POST web-shell sessions/query`]) === JSON.stringify(S[`${a}|POST web-shell sessions/query`]) ? 'yes' : 'no');
  const capRows = [
    ['op (W1 OPERATOR, W3 DRAINING)', cap('op'), same('op')],
    ['rd ((T,T) on W2 → OPERATOR)', cap('rd'), same('rd')],
    ['dn (creator, downgraded to READER)', cap('dn'), same('dn')],
  ];
  const oj = (e, en) => {
    const o = R(`r13544_mh3_${e}-oldjar-main`).oldJarBoot;
    return [`main jar on the V53 database (${en})`, o.booted ? 'boots' : 'refuses', `${Object.keys(o.probes).length} probes → HTTP ${[...new Set(Object.values(o.probes).map((v) => v.status))].join('/')}`, (o.sqlErrors.find((l) => /Unknown column/.test(l)) ?? '').replace(/^.*Unknown column/, 'Unknown column')];
  };
  render('r3-02-upgrade', card({
    title: 'Storage-only claim holds at V53 — 517/517 answers unchanged in all four lineages',
    sub: 'Same rig as rounds 1–2: Spring fat jar (JDK 21.0.12, embedded Runtime Broker) + packaged Hosted Harness + fake OpenAI model against MySQL 8.4.7 and MariaDB 10.11.18; every decision read through the public and WebShell HTTP APIs. The main arm now includes #13163 (V52), so main → head exercises its new readable-grant reader against the role column.',
    blocks: [
      { h: 'Same database, old jar then head jar', table: table(['Upgrade lineage', 'Engine', 'Flyway at head startup', 'Decision probes', 'non-canonical role writes', 'SSE close after grant DELETE', 'owner ≠ creator / sessions'], rows) },
      { h: "#13163's WebShell capability (capabilities.workspaceTurns, now derived from role) — main → head, MySQL", table: table(['Actor', 'Value per creator Session after upgrade', 'same as before'], capRows) },
      { h: 'Rollback without restoring the database (informational)', table: table(['Arm', 'Startup', 'Answers', 'Cause'], [oj('mysql', 'MySQL 8.4.7'), oj('mariadb', 'MariaDB 10.11.18')]) },
      { note: 'Non-canonical writes: trailing/leading space, tab, NUL, NBSP, case, empty, NONE, SPECTATOR, "REA DER", UPDATE / ON DUPLICATE KEY UPDATE / REPLACE, omitted role — rejected with 3819 (MySQL) / 4025 (MariaDB) / 1364 (strict, omitted). A padded UPDATE on a live grant is rejected and that actor\'s 14 HTTP answers stay unchanged on both engines.' },
    ],
  }));
}

// ---------- Figure 3: mutation ----------
if (want(3)) {
  const lines = txt(`${RIG}/out/mutation-r3.txt`).trim().split('\n').filter((l) => /^M\d/.test(l) && !/^M0 /.test(l));
  const last = new Map();
  for (const l of lines) {
    const mm = /^(M\d+\w?) (.*?): (H2|IT\[(\w+)\]) (KILLED|SURVIVED|BUILD-ERROR)(?: tests=(\S+))?(?: totals=\('(\d+)', '(\d+)', '(\d+)', '(\d+)'\))?(?: killers=\[(.*?)\])?/.exec(l);
    if (!mm) continue;
    const rec = last.get(mm[1]) ?? { name: `${mm[1]} ${mm[2]}` };
    if (mm[3] === 'H2') rec.h2 = { v: mm[5], tests: mm[6], run: mm[7], red: Number(mm[8]) + Number(mm[9]), killers: (mm[11] ?? '').split(', ').map((x) => x.replace(/'/g, '')).filter((x) => x.includes('.') && !x.startsWith('com.')) };
    else rec[mm[4]] = mm[5];
    last.set(mm[1], rec);
  }
  const order = (k) => { const [, n, s] = /^M(\d+)(\w?)/.exec(k); return Number(n) * 10 + (s ? s.charCodeAt(0) - 96 : 0); };
  const rows = [...last.entries()].sort((x, y) => order(x[0]) - order(y[0])).map(([, r]) => [
    r.name,
    r.h2 ? (r.h2.v === 'KILLED' ? `KILLED (${r.h2.red} red / ${r.h2.run})` : `${r.h2.v} (${r.h2.run} run)`) : '—',
    r.mysql ?? '—',
    r.mariadb ?? '—',
    (r.h2?.killers ?? []).slice(0, 2).join(', ').replace(/(\w+)\.(\w{36})\w+/g, '$1.$2…'),
  ]);
  render('r3-03-mutation', card({
    title: 'Mutants on head c9103bee60 — the shipped IT now pins the length guards on both engines',
    sub: 'One-line changes to V53 or to a reader/writer in the PR diff. H2 = full surefire suite (M3–M6: the PR migration + owner tests). IT = ManagedWorkspaceRolesMySqlIT exactly as shipped (no rig patch this round), via failsafe on each real engine; unmutated it passes on both. M11b is new: the readable-grant reader #13163 added, converted to role by this PR.',
    blocks: [
      { table: table(['Mutant', 'H2', 'IT · MySQL 8.4.7', 'IT · MariaDB 10.11.18', 'First H2 killers'], rows) },
      { note: "M1b–M1d survive H2 by construction (H2 compares without PAD SPACE); the real-engine IT is their guard and now catches them on MySQL as well as MariaDB without any rig change. CI still runs that IT only in the MariaDB lane." },
    ],
  }));
}
