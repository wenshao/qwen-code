// Round 2 (#13544 @ 28734793da) evidence cards. usage: node build2.mjs [figure-number...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { card, table } from './card.mjs';

const RIG = '/Users/wenshao/pr13544-rig';
const FIG = `${RIG}/fig`;
const only = process.argv.slice(2);
const R = (name) => JSON.parse(readFileSync(`${RIG}/runs/${name}/results.json`, 'utf8'));
const txt = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const render = (name, html, width = 1600) => {
  writeFileSync(`${FIG}/${name}.html`, html);
  execFileSync('node', [`${FIG}/render.mjs`, `${FIG}/${name}.html`, `${FIG}/${name}.png`, String(width)], { stdio: 'inherit' });
};
const want = (n) => only.length === 0 || only.includes(String(n));
const STACK =
  'Real stack per arm: Spring Managed Agent Server fat jar (JDK 21.0.12, embedded Runtime Broker) + packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) + fake OpenAI model, against MySQL 8.4.7 (native) and MariaDB 10.11.18 (container). Every decision is read through the public and WebShell HTTP APIs.';
const lin = [
  ['base 1162c96ab9 (V50) → head', 'bh2', 'mysql', 'MySQL 8.4.7', 'seed-base'],
  ['base 1162c96ab9 (V50) → head', 'bh2', 'mariadb', 'MariaDB 10.11.18', 'seed-base'],
  ['main (V51, L3) → head', 'mh2', 'mysql', 'MySQL 8.4.7', 'seed-main'],
  ['main (V51, L3) → head', 'mh2', 'mariadb', 'MariaDB 10.11.18', 'seed-main'],
].map(([label, l, e, en, s]) => ({ label, l, e, en, seed: R(`r13544_${l}_${e}-${s}`), up: R(`r13544_${l}_${e}-upgrade-head`) }));
const totals = (log) => [...log.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();

// ---------- Figure 1: round-1 items ----------
if (want(1)) {
  const gate = (arm) => {
    try {
      return '✔ ' + execFileSync('node', ['scripts/check-flyway-migrations.js', 'packages/sdk-java/managed-agent-server'], { cwd: `${RIG}/src-${arm}`, encoding: 'utf8' }).trim().replace(/^.*managed-agent-server: /, '');
    } catch (e) {
      return '✖ ' + String(e.stdout + e.stderr).trim();
    }
  };
  const h2 = totals(txt(`${RIG}/out/test-head-full2.log`));
  const itCell = (e) => {
    const l = txt(`${RIG}/out/it-head-${e}-r2.log`);
    const t = totals(l);
    return t ? `${t[1]} run · ${t[2]} failure${t[2] === '1' ? '' : 's'} · ${t[3]} error${t[3] === '1' ? '' : 's'}` : 'not run';
  };
  const iso = JSON.parse(txt(`${RIG}/out/it-isolated.json`) || '{}');
  const flyApplied = (x) => x.up.springBoot.flyway.find((l) => /Successfully applied/.test(l))?.replace(/^.*Successfully applied /, '').replace(/ to schema `[^`]+`/, '').replace(/ \(execution time.*$/, '') ?? '?';
  const rows = [
    ['Blocker: V51 collides with main #13354', '✔ fixed', `roles migration is now V52. Flyway gate: head ${gate('head').replace('✔ ', '')}; trial merge with today's main a7230ed7ea: ${gate('merge').replace('✔ ', '')}. Real boot: V50 → ${flyApplied(lin[0])}; V51 → ${flyApplied(lin[2])}`],
    ['main-side L3 tests on dropped booleans', '✔ fixed', `H2 suite on head: ${h2 ? `${h2[1]} run · ${h2[2]} failures · ${h2[3]} errors · ${h2[4]} skipped (RuntimeBrokerDefaultOnTest, skipped on main too)` : '?'} — round 1: 54 errors`],
    ['  mysql-integration ITs · MariaDB 10.11.18', '✔ green except one load timeout', `${itCell('mariadb')}${iso.mariadb ? ' · ' + iso.mariadb : ''}`],
    ['  mysql-integration ITs · MySQL 8.4.7', '✖ 1 deterministic failure', `${itCell('mysql')} · ManagedWorkspaceRolesMySqlIT fails (new finding, next figure); ${iso.mysql ?? ''}`],
    ['P2 padded role values', '✔ fixed', 'byte-exact CHECK ships inside V52; every non-canonical value is rejected on both engines (figure 3)'],
    ['P3 negative tests masked by a PK clash', '✔ fixed', 'fresh actor keys; dropping the CHECK and restoring DEFAULT are now both caught by H2 (figure 4)'],
    ['Storage-only claim', '✔ still holds', `${lin.map((x) => `${x.up.probeDiff.same}/${x.up.probeDiff.total}`).join(' · ')} answers unchanged across 4 lineages (figure 2)`],
  ];
  render('r2-01-round1-items', card({
    title: 'Re-verification at 28734793da — every round-1 item is closed; one new test-only finding',
    sub: 'Head 28734793da = the P2/P3 fix 4dbde35e6f + main merge af51bf59be + renumber to V52. Trial merge with the current main (3 commits ahead, none in sdk-java) has an sdk-java tree identical to the head.',
    blocks: [
      { table: table(['Round-1 item', 'Status', 'Evidence on this head'], rows) },
      { note: 'Merge-order caveat: V52 is also claimed by 6 other open PRs (#13654, #13642, #13572, #13550, #13325, #13163). Whichever lands first takes V52, and the uniqueness check only proves the main it ran against — re-run it (or git merge-tree + the gate) immediately before merging.' },
    ],
  }));
}

// ---------- Figure 2: upgrade lineages ----------
if (want(2)) {
  const rows = lin.map((x) => {
    const applied = x.up.springBoot.flyway.find((l) => /Successfully applied/.test(l))?.replace(/^.*Successfully applied /, '').replace(/ to schema `[^`]+`/, '') ?? '?';
    const d = x.up.probeDiff;
    return [x.label, x.en, applied, `${d.same === d.total ? '✔' : '✖'} ${d.same}/${d.total} identical`, `${x.seed.revoke.closeMs} ms → ${x.up.revoke.closeMs} ms`, x.up.owners.allSessionsOwnerEqualsCreator.replace('\t', ' mismatches / ') + ' sessions'];
  });
  const b = lin[2];
  const before = new Map(b.seed['db.beforeUpgrade'].access.map((r) => [`${r.w}/${r.a}`, r.g]));
  const after = new Map(b.up['db.afterUpgrade'].access.map((r) => [`${r.w}/${r.a}`, r.g]));
  const fmt = (g) => g.replace('read=1', 'can_read=T').replace('read=0', 'can_read=F').replace('create=1', 'can_create=T').replace('create=0', 'can_create=F');
  const grantRows = [...before.keys()].filter((k) => !k.endsWith('/rv1')).map((k) => [k, fmt(before.get(k)), after.has(k) ? after.get(k) : '(row dropped)', lin.every((x) => JSON.stringify(x.up['db.afterUpgrade'].access.find((r) => `${r.w}/${r.a}` === k) ?? null) === JSON.stringify(b.up['db.afterUpgrade'].access.find((r) => `${r.w}/${r.a}` === k) ?? null)) ? 'yes' : 'no']);
  const oj = (e) => R(`r13544_mh2_${e}-oldjar-main`).oldJarBoot;
  const ojRow = (e, en) => {
    const o = oj(e);
    const st = [...new Set(Object.values(o.probes).map((v) => v.status))].join('/');
    const col = (o.sqlErrors.find((l) => /Unknown column/.test(l)) ?? '').replace(/^.*Unknown column/, 'Unknown column');
    return [`main jar on the V52 database (${en})`, o.booted ? 'boots; Flyway ignores the newer V52' : 'refuses to start', `${Object.keys(o.probes).length} probes → HTTP ${st}`, col];
  };
  render('r2-02-upgrade', card({
    title: 'Storage-only claim still holds — 517/517 answers unchanged in all four upgrade lineages',
    sub: STACK,
    blocks: [
      { h: 'Same database, old jar then head jar', cap: 'Per arm: 8 actors × (workspace list/get, session list/get, turns, events, SSE open, Turn submit + outcome, cwd change + operation outcome, create via public + WebShell) + cross-tenant controls; compared as status + error code + capability booleans. The base lineage applies L3 V51 and the roles V52 in one boot.', table: table(['Upgrade lineage', 'Engine', 'Flyway at head startup', 'Decision probes', 'SSE closes after grant DELETE', 'owner_actor_key ≠ creator'], rows) },
      { h: 'Backfill (main → head, MySQL shown)', table: table(['Workspace/actor', 'Before (booleans)', 'After V52', 'same in all 4 lineages'], grantRows) },
      { h: 'Rollback without restoring the database (informational)', table: table(['Arm', 'Startup', 'Answers', 'Cause'], [ojRow('mysql', 'MySQL 8.4.7'), ojRow('mariadb', 'MariaDB 10.11.18')]) },
      { note: 'The previous binary fails closed (500, never a wrong grant), matching design §5: stop old servers before V52; going back needs the pre-upgrade database. New creations write owner = creator (NULL for anonymous) on both engines.' },
    ],
  }));
}

// ---------- Figure 3: CHECK on real engines + the IT ----------
if (want(3)) {
  const m = lin[2].up, a = lin[3].up;
  const verdict = (o) => (o.accepted ? `ACCEPT ${(o.stored?.split('\t')[0] ?? '').replaceAll(' ', '␣')}` : `rejected (${o.error.match(/\b(\d{4})\b/)?.[1]})`);
  const cell = (s) => (/^ACCEPT \[(READER|OPERATOR|OWNER)\]$/.test(s) ? '✔ ' + s : /ACCEPT/.test(s) ? '✖ ' + s : s);
  const t1 = table(['Value written out of band', 'V52 CHECK · MySQL 8.4.7', 'V52 CHECK · MariaDB 10.11.18'], m['constraint.shipped'].map((o, i) => [o.value, cell(verdict(o)), cell(verdict(a['constraint.shipped'][i]))]));
  const pw = (r) => `${r.padded.write.readerPadded.match(/^\d{4}/)?.[0] ?? r.padded.write.readerPadded} / ${r.padded.write.operatorPadded.match(/^\d{4}/)?.[0] ?? r.padded.write.operatorPadded}; ${r.padded.diff.same}/${r.padded.diff.total} of pd's probes unchanged`;
  const exc = (e) => {
    const l = txt(`${RIG}/out/mut2-M0u-it-${e}.log`);
    const t = totals(l);
    const ex = l.match(/but was:\s*\n\s*(org\.springframework\.\S+?):/)?.[1]?.replace(/^.*\./, '') ?? 'DataIntegrityViolationException';
    return [e === 'mysql' ? 'MySQL 8.4.7' : 'MariaDB 10.11.18', e === 'mysql' ? '3819 · SQLSTATE HY000' : '4025 · SQLSTATE 23000', ex, t && t[2] === '0' && t[3] === '0' ? '✔ pass' : '✖ fails at "role NONE must be rejected"'];
  };
  render('r2-03-check', card({
    title: 'P2 closed on both engines — and the IT that pins it is red on MySQL 8.4',
    sub: "V52 ships CHECK ((role = 'READER' AND CHAR_LENGTH(role) = 6) OR … ) on a utf8mb4_bin column. Every row below is a direct SQL write against the head's migrated table.",
    blocks: [
      { h: 'CHECK matrix after main → head (INSERT unless noted)', table: t1 },
      { h: 'Padded grant on a live actor (pd: W1 READER, W2 OPERATOR)', table: table(['Engine', "UPDATE to 'READER ' / 'OPERATOR '", ], [['MySQL 8.4.7', pw(m)], ['MariaDB 10.11.18', pw(a)]]) },
      { h: 'ManagedWorkspaceRolesMySqlIT, unmodified head (2 of 2 MySQL runs fail)', table: table(['Engine', 'CHECK violation reported as', 'Spring 6.2.19 translates to', 'IT result'], [exc('mysql'), exc('mariadb')]) },
      { note: "Spring's MySQL error-code table has no 3819, and SQLSTATE HY000 has no class fallback, so MySQL's CHECK violation arrives as UncategorizedSQLException; MariaDB's SQLSTATE 23000 falls back to DataIntegrityViolationException. CI runs -Pmysql-integration only on MariaDB (the MySQL 8.4 lane runs Hosted*IT), so CI cannot see this. With the assertion widened to DataAccessException + the constraint name (rig-only), the IT passes on both engines and catches the length-guard mutants (figure 4)." },
    ],
  }));
}

// ---------- Figure 4: mutation ----------
if (want(4)) {
  const lines = txt(`${RIG}/out/mutation-r2.txt`).trim().split('\n').filter((l) => /^M\d/.test(l));
  const last = new Map();
  for (const l of lines) {
    const mm = /^(M\d+\w?) (.*?): (H2|IT\[(\w+)\]) (KILLED|SURVIVED|BUILD-ERROR)(?: tests=(\S+))?(?: totals=\('(\d+)', '(\d+)', '(\d+)', '(\d+)'\))?(?: killers=\[(.*?)\])?/.exec(l);
    if (!mm) continue;
    const key = mm[1];
    const rec = last.get(key) ?? { name: `${mm[1]} ${mm[2]}` };
    if (mm[3] === 'H2') rec.h2 = { v: mm[5], tests: mm[6], run: mm[7], red: Number(mm[8]) + Number(mm[9]), killers: (mm[11] ?? '').split(', ').map((x) => x.replace(/'/g, '')).filter((x) => x.includes('.') && !x.startsWith('com.')) };
    else rec[mm[4]] = mm[5];
    last.set(key, rec);
  }
  const order = (k) => { const [, n, s] = /^M(\d+)(\w?)/.exec(k); return Number(n) * 10 + (s ? s.charCodeAt(0) - 96 : 0); };
  const rows = [...last.entries()].sort((x, y) => order(x[0]) - order(y[0])).map(([, r]) => [
    r.name,
    r.h2 ? (r.h2.v === 'KILLED' ? `KILLED (${r.h2.red} red / ${r.h2.run})` : `${r.h2.v} (${r.h2.run} run${r.h2.tests === '*Test' ? ', full suite' : ''})`) : '—',
    r.mysql ? `${r.mysql}${r.mysql === 'KILLED' ? '' : ''}` : '—',
    r.mariadb ?? '—',
    (r.h2?.killers ?? []).slice(0, 2).join(', ').replace(/(\w+)\.(\w{36})\w+/g, '$1.$2…'),
  ]);
  render('r2-04-mutation', card({
    title: 'Mutants on head 28734793da — P3 closed; the length guards are pinned only by the real-engine IT',
    sub: 'One-line changes to V52 or to a reader/writer in the PR diff. H2 = full surefire suite (M3–M6: the PR migration + owner tests). IT = ManagedWorkspaceRolesMySqlIT via failsafe on a real engine, with its assertion widened (rig-only, both engines) to DataAccessException + the constraint name; unwidened it fails on MySQL before reaching the mutated values. Widened baseline: passes on both engines.',
    blocks: [
      { table: table(['Mutant', 'H2', 'IT · MySQL 8.4.7', 'IT · MariaDB 10.11.18', 'First H2 killers'], rows) },
      { note: "H2 compares without PAD SPACE, so its 'READER ' assertion passes under the round-1 IN-list as well (M1b–M1d survive all 1370 H2 tests). The only test that holds the P2 fix in place is ManagedWorkspaceRolesMySqlIT — which is why its MySQL 8.4 failure is worth fixing in this PR." },
    ],
  }));
}
