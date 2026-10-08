// Builds the PR 13544 evidence cards from runs/*/results.json + logs, renders PNGs.
// usage: node build.mjs [figure-number...]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { card, esc, table } from './card.mjs';

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
  'Real stack per arm: Spring Managed Agent Server fat jar (JDK 21.0.12, embedded Runtime Broker) + packaged Hosted Harness (dist/cli.js serve --profile hosted-harness) + fake OpenAI model, against MySQL 8.4.7 (native, 127.0.0.1) and MariaDB 10.11.18 (container, utf8mb4_bin tables). All decisions read through the public and WebShell HTTP APIs.';

const lin = [
  ['base → head (V51)', 'bh', 'mysql', 'MySQL 8.4.7', 'seed-base', 'upgrade-head'],
  ['base → head (V51)', 'bh', 'mariadb', 'MariaDB 10.11.18', 'seed-base', 'upgrade-head'],
  ['main → merge, roles as V52', 'mm', 'mysql', 'MySQL 8.4.7', 'seed-main', 'upgrade-merger'],
  ['main → merge, roles as V52', 'mm', 'mariadb', 'MariaDB 10.11.18', 'seed-main', 'upgrade-merger'],
].map(([label, l, e, en, s, u]) => ({ label, e, en, seed: R(`r13544_${l}_${e}-${s}`), up: R(`r13544_${l}_${e}-${u}`) }));

// ---------- Figure 1: merge blocker ----------
if (want(1)) {
  const boot = txt(`${RIG}/runs/mergeboot/spring-fresh.log`);
  const bootErr = /Found more than one migration with version 51/.test(boot) ? '✖ exits 1: "Found more than one migration with version 51" (0 tables created)' : '?';
  const gate = (arm) => {
    try {
      return execFileSync('node', ['scripts/check-flyway-migrations.js', 'packages/sdk-java/managed-agent-server'], { cwd: `${RIG}/src-${arm}`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().replace(/^.*managed-agent-server: /, '✔ ');
    } catch (e) {
      return '✖ ' + String(e.stdout + e.stderr).replace(/::error::packages\/sdk-java\/managed-agent-server: /, '').replace(/packages\/sdk-java\/managed-agent-server\/src\/main\/resources\/db\/migration\//g, '').trim();
    }
  };
  const mm = lin.filter((x) => x.label.startsWith('main'));
  const t1 = table(
    ['Tree', 'Newest migrations', 'scripts/check-flyway-migrations.js', 'Spring boot on a real database'],
    [
      ['PR head 3cd5b12fcc', 'V50 … · V51__managed_workspace_roles', gate('head'), '✔ boots, V50 → V51 applied (MySQL + MariaDB)'],
      ['trial merge c3882b802c (head + main fe4d4e345c)', 'V51__managed_workspace_roles + V51__workspace_session_lifecycle', gate('merge'), bootErr],
      ['rig-only: trial merge + git mv V51 → V52', 'V51__workspace_session_lifecycle · V52__managed_workspace_roles', gate('merger'), `✔ boots; main(V51) → V52 upgrade: ${mm.map((x) => `${x.up.probeDiff.same}/${x.up.probeDiff.total} identical on ${x.en}`).join(', ')}`],
    ],
  );
  const full = txt(`${RIG}/out/test-merger-full.log`);
  const tot = [...full.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
  const itRow = (e) => {
    const l = txt(`${RIG}/out/it-merger-${e}.log`);
    const t = [...l.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].pop();
    const bad = [...new Set([...l.matchAll(/Tests run:.*FAILURE! -- in com\.alibaba\.qwen\.code\.\S*?(\w+)$/gm)].map((m) => m[1]))];
    return t ? `${t[1]} run · ${t[2]} failure${t[2] === '1' ? '' : 's'} · ${t[3]} errors${bad.length ? ' — ' + bad.join(', ') : ''}` : 'not run';
  };
  const t2 = table(
    ['Suite on the renumbered trial merge', 'Result', 'Cause'],
    [
      ['H2 unit suite (mvn test, 1370 tests)', tot ? `✖ ${tot[1]} run · ${tot[2]} failures · ${tot[3]} errors · ${tot[4]} skipped` : '?', 'all errors are main-side #13354 fixtures still written against the dropped booleans'],
      ['  WorkspaceLifecycleStoreTest (new in #13354)', '✖ 53/53 error', 'fixture:520 INSERT … (can_read, can_create) VALUES (…, TRUE, TRUE); also UPDATE … SET can_create = ? at :82/:405/:408'],
      ['  WorkspaceRuntimeTest.legacyCloseHooksUse…CurrentAuthorization', '✖ 1 error', ':706 UPDATE managed_workspace_access SET can_read = FALSE — revocation must become DELETE (NONE is not storable)'],
      ['mysql-integration ITs on MySQL 8.4.7', itRow('mysql'), 'WorkspaceLifecycleMySqlIT 65 (inherits the store test fixture) · ToolPublicationLifecycleMySqlIT:131 2 · WorkspaceMigrationMySqlIT 1 (pins post-V47 versions as exactly 48–51; tree now has 48–52)'],
      ['mysql-integration ITs on MariaDB 10.11.18', itRow('mariadb'), 'same three classes; the extra ManagedAgentMySqlIT error is a 60 s writer-grant timeout under host load ~60 that passes on an isolated rerun (46 s)'],
    ],
  );
  render('01-merge-blocker', card({
    title: 'Blocker — V51 now collides with main (#13354 L3, merged 2026-10-08 03:06Z)',
    sub: 'git merges cleanly and GitHub reports MERGEABLE with all checks green, but those checks ran on a merge ref from before #13354. Flyway refuses the merged tree at startup.',
    blocks: [
      { h: 'Migration inventory, repo gate and real startup', table: t1 },
      { h: 'Semantic collisions after renumbering (what the next main merge must also reconcile)', table: t2 },
      { note: 'Needed before merge: merge main, renumber the roles migration to V52 (and the two design-doc references), move WorkspaceLifecycleStoreTest (also feeds WorkspaceLifecycleMySqlIT), WorkspaceRuntimeTest:706 and ToolPublicationLifecycleMySqlIT:131 to the role column, and extend WorkspaceMigrationMySqlIT to 48–52. The renumbered tree boots and upgrades main → V52 with every decision unchanged.' },
    ],
  }));
}

// ---------- Figure 2: upgrade invisibility ----------
if (want(2)) {
  const rows = lin.map((x) => {
    const applied = x.up.springBoot.flyway.find((l) => /Successfully applied/.test(l))?.replace(/^.*Successfully applied /, '').replace(/ to schema `[^`]+`/, '') ?? '?';
    const d = x.up.probeDiff;
    return [x.label, x.en, applied, `${d.same === d.total ? '✔' : '✖'} ${d.same}/${d.total} identical`, `${x.seed.revoke.closeMs} ms → ${x.up.revoke.closeMs} ms`, x.up.owners.allSessionsOwnerEqualsCreator.replace('\t', ' mismatches / ') + ' sessions'];
  });
  const t1 = table(['Upgrade lineage', 'Engine', 'Flyway at startup of the new jar', 'Decision probes (old jar vs new jar)', 'SSE closes after grant DELETE', 'owner_actor_key ≠ creator'], rows);
  const b = lin[0];
  const before = new Map(b.seed['db.beforeUpgrade'].access.map((r) => [`${r.w}/${r.a}`, r.g]));
  const after = new Map(b.up['db.afterUpgrade'].access.map((r) => [`${r.w}/${r.a}`, r.g]));
  const grantRows = [...before.keys()].filter((k) => !k.endsWith('/rv1')).map((k) => [k, before.get(k).replace('read=1', 'can_read=T').replace('read=0', 'can_read=F').replace('create=1', 'can_create=T').replace('create=0', 'can_create=F'), after.has(k) ? after.get(k) : '(row dropped)']);
  const t2 = table(['Workspace/actor', 'Before (V50 booleans)', 'After V51 (identical on both engines)'], grantRows);
  const P = JSON.parse(readFileSync(`${RIG}/state/r13544_bh_mysql.probes-upgrade.json`, 'utf8'));
  const pick = (k) => { const v = P[k]; return v.items ? `${v.status} ${v.items.length ? '' : '(empty list)'}${v.items.map((i) => `${i.id}${i.create ? '(create)' : ''}`).join(' ')}` : `${v.status}${v.code ? ' ' + v.code : ''}${v.turn ? ' turn ' + v.turn : ''}${v.op ? ' op ' + v.op.state : ''}`; };
  const ex = [
    ['op (T,T) on W1', 'POST /sessions/s_op_w1/events (submit)', pick('op|POST /sessions/s_op_w1/events (submit)')],
    ['op', 'POST /sessions/s_op_w1/cwd', pick('op|POST /sessions/s_op_w1/cwd')],
    ['rd (T,F) on W1', 'POST /sessions (workspace W1)', pick('rd|POST /sessions (workspace W1)')],
    ['dn: creator, downgraded to (T,F)', 'POST /sessions/s_dn_w1/events (submit)', pick('dn|POST /sessions/s_dn_w1/events (submit)')],
    ['dn', 'POST /sessions/s_dn_w1/cwd', pick('dn|POST /sessions/s_dn_w1/cwd')],
    ['cr: creator, (F,T) → dropped', 'GET /sessions/s_cr_w1', pick('cr|GET /sessions/s_cr_w1')],
    ['cr', 'POST /sessions (workspace W1)', pick('cr|POST /sessions (workspace W1)')],
    ['nn (F,F) → dropped', 'GET /workspaces', pick('nn|GET /workspaces')],
    ['op on DRAINING W3', 'POST /sessions/s_op_w3/events (submit)', pick('op|POST /sessions/s_op_w3/events (submit)')],
    ['op in other tenant', 'GET /sessions/s_op_w1', pick('other:op|GET /sessions/s_op_w1')],
  ];
  const t3 = table(['Actor (grant before upgrade)', 'Probe', 'Answer — same before and after'], ex);
  render('02-upgrade-invisibility', card({
    title: 'Storage-only claim holds on real engines — 517/517 admission answers unchanged across the upgrade',
    sub: STACK,
    blocks: [
      { h: 'Same database, old jar then new jar', cap: 'Probes per arm: 8 actors × (workspace list/get, session list/get, turns, events, SSE open, Turn submit + Turn outcome, cwd change + operation outcome, create via public + WebShell) + cross-tenant controls. Compared as status + error code + capability booleans.', table: t1 },
      { h: 'Backfill on real data (MySQL 8.4.7 shown; MariaDB identical)', table: t2 },
      { h: 'Sample of the matrix (MySQL, after upgrade)', table: t3 },
      { note: 'New jar writes owner = creator on bound, unbound and anonymous creations (NULL for anonymous); every pre-existing Session got owner_actor_key = creator_actor_key. role is VARCHAR(16) NOT NULL, no default, utf8mb4_bin, named CHECK present on both engines.' },
    ],
  }));
}

// ---------- Figure 3: padded role (open P2) ----------
if (want(3)) {
  const m = R('r13544_bh_mysql-upgrade-head'), a = R('r13544_bh_mariadb-upgrade-head');
  const verdict = (o) => (o.accepted ? `ACCEPT ${(o.stored?.split('\t')[0] ?? '').replaceAll(' ', '␣')}` : `rejected (${o.error.match(/\b(\d{4})\b/)?.[1]})`);
  const cRows = m['constraint.shipped'].map((o, i) => [o.value, verdict(o), verdict(a['constraint.shipped'][i]), verdict(m['constraint.candidate'][i]), verdict(a['constraint.candidate'][i])]);
  const cell = (s) => (/^ACCEPT \[(READER|OPERATOR|OWNER)\]$/.test(s) ? '✔ ' + s : /ACCEPT/.test(s) ? '✖ ' + s : s);
  const t1 = table(['Value written out of band', 'shipped CHECK · MySQL 8.4', 'shipped CHECK · MariaDB 10.11', 'pending fix · MySQL 8.4', 'pending fix · MariaDB 10.11'], cRows.map((r) => [r[0], ...r.slice(1).map(cell)]));
  const p = m.padded;
  const s = (v) => (v.items ? `${v.status} ${v.items.map((i) => i.id).join(',')}` : v.visible ? `${v.status} (${v.visible.length} Sessions)` : `${v.status}${v.code ? ' ' + v.code : ''}`);
  const nm = (v) => JSON.stringify({ ...v, ms: undefined });
  const same = (k) => ['before', 'afterReaderPadded', 'afterOperatorPadded'].every((ph) => nm(m.padded[ph][k]) === nm(a.padded[ph][k]));
  const keys = Object.keys(p.before);
  const mark = (b, x) => (s(b) === s(x) ? s(x) : `✖ ${s(x)}`);
  const t2 = table(['Actor pd (W1 READER, W2 OPERATOR + own Session on W2)', 'canonical', "W1 = 'READER '", "W2 = 'OPERATOR '", 'MariaDB same?'], keys.map((k) => [k, s(p.before[k]), mark(p.before[k], p.afterReaderPadded[k]), mark(p.before[k], p.afterOperatorPadded[k]), same(k) ? 'yes' : 'no']));
  const st = m.stateTrailing;
  render('03-padded-role', card({
    title: "Open P2 (r4212940548) reproduced on MySQL 8.4 too — the CHECK stores 'READER␣', the readers then answer 400",
    sub: "utf8mb4_bin is PAD SPACE on both engines, so role IN ('READER', …) accepts trailing spaces; WorkspaceAccess.valueOf(\"READER \") throws and the API answers 400 invalid_request. Pending fix = per-name CHAR_LENGTH guard from the author's reply r4214389423 (not pushed yet), applied here as rig-only DDL.",
    blocks: [
      { h: 'CHECK matrix on the migrated table (INSERT unless noted)', table: t1 },
      { h: 'What one padded grant breaks (HTTP, head jar, MySQL; MariaDB identical)', table: t2 },
      { note: `Only the padded actor is affected; bystanders still list normally. Same class already exists on main for registry state ('ACTIVE ' stored → list shows "active ", create in that Workspace → 500 internal_error, both arms). Adding the fixed CHECK in a later migration fails (3819 / 4025) on any database that already holds a padded row, so the fix belongs inside the roles migration before it ships.` },
    ],
  }));
}

// ---------- Figure 4: mutation ----------
if (want(4)) {
  const all = txt(`${RIG}/out/mutation.txt`).trim().split('\n').filter(Boolean);
  const fullIds = new Set(all.filter((l) => l.includes('[full suite]')).map((l) => l.split(' ')[0]));
  const lines = all.filter((l) => l.includes('[full suite]') || !fullIds.has(l.split(' ')[0])).map((l) => l.replace(' [full suite]', '')).sort((a, b) => Number(a.slice(1, a.indexOf(' '))) - Number(b.slice(1, b.indexOf(' '))));
  const rows = lines.map((l) => {
    const mm = /^(M\d+) (.*?): (KILLED|SURVIVED|BUILD-ERROR|ANCHOR.*?)(?: tests=(\S+))?(?: totals=\('(\d+)', '(\d+)', '(\d+)', '(\d+)'\))? killers=\[(.*?)\]/.exec(l) ?? [];
    const killers = (mm[9] ?? '').split(', ').map((x) => x.replace(/'/g, '')).filter((x) => x.includes('.') && !x.startsWith('com.'));
    const scope = mm[4] === '*Test' ? `full H2 suite (${mm[5]})` : 'PR migration + owner tests';
    return [`${mm[1]} ${mm[2]}`, scope, mm[3] === 'KILLED' ? `KILLED (${Number(mm[6]) + Number(mm[7])} red)` : mm[3], killers.slice(0, 2).join(', ').replace(/(\w+)\.(\w{40})\w+/g, '$1.$2…')];
  });
  render('04-mutation', card({
    title: 'Which guarantees the tests actually pin (mutants on the PR head)',
    sub: 'Each mutant is a one-line change to V51 or to a reader/writer in the PR diff, run with JDK 21 / Maven on head 3cd5b12fcc. P3 (r4212940552) predicted M1 and M2 would survive; they survive the whole H2 suite, not just the PR tests.',
    blocks: [
      { table: table(['Mutant', 'Tests run', 'Result', 'First killers'], rows) },
      { note: 'Pinned: backfill mapping, row drops, owner backfill and writes, and each read-site predicate mutated here. Not pinned by any of the 1289 tests: the role CHECK and the no-default rule. The negative INSERTs reuse the seeded OPERATOR key, so they pass on DuplicateKeyException whatever the constraint says. The author says the pending fix commit addresses this.' },
    ],
  }));
}
