// Round-3 cards: the merged head e50e2c37 (PR 0919b9d8 + main 3f56f74a / #13129 H2 + V28 rename).
import fs from 'node:fs';
const O = '/Users/wenshao/pr13138-rig/out';
const j = (p) => JSON.parse(fs.readFileSync(`${O}/${p}`, 'utf8'));
const head = j('e2e-e50/m3-hooks.json');
const cand = j('e2e-e50/m3-hooks-e50c.json');
const rbHead = j('e2e-e50/runbook-head/r2-matrix-e50.json');
const rbCand = j('e2e-e50/runbook-cand/r2-matrix-e50c.json');
const m3c = j('e2e-m3/r2-matrix-m3c.json');
const st = (s) => !s ? '-' : s.startsWith('state=') ? s.match(/state=\w+/)[0].replace('state=', '') : `refused: ${s.replace(/^REFUSED (protocol_validation_failed: )?(Workspace recovery: )?/, '')}`;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const D = '/Users/wenshao/pr13138-rig/fig/cards-r3';
fs.mkdirSync(D, { recursive: true });

// ---- card 1: the blocker
const t1 = [['storage (populated through the deployed stack)', 'head e50e2c37', 'e50e2c37 + candidate (3 lines)']];
t1.push(['st-b: 2 plain Files Sessions, one WRITE turn each', `-- ${st(head.b.summary)}`, `++ ${st(cand.b.summary)} -> ${st(cand.b.verify)}\n++ contentVerified=true authorityCompatible=true activation=false\n++ same-UUID replay byte-identical`]);
t1.push(['runbook storage: 7 Sessions, Files + Shell + O2 Shell\n(3 MB stdout published, 3 segments), 3,500 entries', `-- ${st(rbHead.A.capture)} after ${sec(rbHead.A.captureMs)}\n-- verify: ${st(rbHead.A.verify)}`, `++ ${st(rbCand.A.capture)} 7/7 in ${sec(rbCand.A.captureMs)} -> ${st(rbCand.A.verify)}\n++ replay identical, 34 authority tables unchanged\n++ SIGKILL while assets.ndjson publishes -> resume ${st(rbCand.R130.resume1)}`]);
t1.push(['st-a: 1 plain + 1 Hosted Hooks Session\n(UserPromptSubmit + PreToolUse fired)', `!! ${st(head.a.summary)}`, `!! ${st(cand.a.summary)}  (fail-closed, as designed)`]);
t1.push(['st-c: 1 Hosted MCP Session', `!! ${st(head.c.summary)}`, `!! ${st(cand.c.summary)}  (explicit W1b profile check, unchanged)`]);
const t1b = [['same population script', 'model.attempt events', 'managed-hosted-model-route / -usage resources'],
  ['0919b9d8 (round 2 DB, 8 Sessions)', '0', '0 / 0'],
  ['e50e2c37 (this round, 8 Sessions)', '!! 48', '!! 24 / 24']];
fs.writeFileSync(`${D}/01-model-resources-blocker.json`, JSON.stringify({
  title: 'e50e2c37: W1b refuses every storage whose Sessions ran a model turn on this build',
  subtitle: 'Ubuntu 24.04 ext4 VM, MySQL 8.4.11, head fat jar as systemd service + durable workers, head Harness/worker bundle, shipped e50 *-workspace-bundle.jar, scripted model',
  blocks: [
    { label: 'Operator capture (packaged maintenance jar + CLI child), each storage fenced offline via W1a', table: t1 },
    { label: 'Why: #13129 (H2) now journals every Hosted model attempt with routeRef/usageRef resources', table: t1b },
    { note: 'workspace-recovery-session.ts reads every referenced resource through an allowlist (RESOURCE_KINDS) that predates H2, so managed-hosted-model-route/-usage fail with protocol_validation_failed "unsupported resource protocol". It fails closed (no bundle, original authority untouched, row stays CAPTURING) but no storage with a post-upgrade turn can be captured. W1b unit fixtures and synthetic-journal E2E never produce model.attempt, so they stay green. Candidate: add the two kinds (+1 test that fails without it).' },
  ] }, null, 1));

// ---- card 2: Flyway collision before/after e50e2c37
const t2 = [['database', 'merged tree before the fix (85150b91; same product tree)', 'e50e2c37 (V27 hooks + V28 W1b)']];
t2.push(['fresh', '-- does not start: FlywayException\n-- "Found more than one migration with version 27"', '++ starts; 28 migrations validated']);
t2.push(['first migrated by main 3f56f74a (V27 hooks)', '-- does not start: same exception', '++ starts; applies V28 workspace recovery bundle']);
t2.push(['first migrated by the PR branch (V27 = W1b)', '- (not run)','!! does not start: "Migration checksum mismatch for\n!! migration version 27" (main 3f56f74a: same)']);
const t2b = [['10 Java test classes, 122 tests (H2)', 'merged before the fix', 'V28 tree (byte-identical to e50e2c37 sdk-java)'],
  ['WorkspaceRecoveryStore/StorageGuard, ExtensionRecordStore,\nHook contracts, TurnQuery, Flyway/migration, API contract, ToolPublication', '-- 119 errors: Found more than one migration\n-- with version 27', '++ 122 passed']];
fs.writeFileSync(`${D}/02-flyway-fixed.json`, JSON.stringify({
  title: 'Duplicate Flyway V27 after merging main — fixed in e50e2c37',
  subtitle: 'Same VM, MySQL 8.4.11, real server fat jars started as the systemd service; Java tests in the Maven 3 / JDK 21 container',
  blocks: [
    { label: 'Server start', table: t2 },
    { label: 'Targeted Java tests', table: t2b },
    { note: 'Git merges the two V27 files without a conflict; only Flyway sees it. The rename in e50e2c37 fixes fresh installs and main->head upgrades. A database that already applied the branch-only V27 (any deployment built from this PR before e50e2c37) is refused by both main and the head and has to be recreated; the author has scoped that out, this just measures it.' },
  ] }, null, 1));

// ---- card 3: everything else from round 2 still holds with the candidate
const t3 = [['round-2 check (merged tree + candidate, same VM)', 'result']];
t3.push(['A runbook: capture -> same-UUID replay -> fresh verify', `++ ${st(m3c.A.capture)} 7/7 (${sec(m3c.A.captureMs)}) -> ${st(m3c.A.verify)}; replay identical; authority unchanged`]);
t3.push(['R1-29 stray file only in the operator copy', `++ ${m3c.R129.state}/${m3c.R129.lastError}; same UUID after cleaning: ${st(m3c.R129.retry)}`]);
t3.push(['R1-31 file missing from the copy', `++ ${m3c.R131a.state}/${m3c.R131a.lastError}, no path on stderr; same UUID after restoring: ${st(m3c.R131a.retry)}`]);
t3.push(['R1-31 new source file after the copy', `++ ${m3c.R131b.state}/${m3c.R131b.lastError}; same UUID once removed: ${st(m3c.R131b.retry)}`]);
t3.push(['R1-30 SIGKILL while assets.ndjson publishes', `++ resume 1 ${st(m3c.R130.resume1)}, resume 2 ${st(m3c.R130.resume2)}`]);
t3.push(['R1-32 verify UTC-sealed capture under UTC / Shanghai / VM default', `++ ${['utc', 'shanghai', 'systemDefault'].map((k) => m3c.R132verify[k].match(/authorityCompatible=\w+/)[0].replace('authorityCompatible=', '')).join(' / ')} (authorityCompatible)`]);
t3.push(['R1-32 killed under UTC, resumed under UTC / Asia/Shanghai', `++ ${m3c['R132same-tz'].state} / ${m3c['R132other-tz'].state}`]);
const t3b = [['TS suites on the merged tree', 'result'],
  ['CLI: W1b (3 files) + H2 hook/harness/routes + cli/index (11 files)', '++ 485 passed, 4 skipped'],
  ['core: session store, hook authority/record/activation (4 files)', '++ 77 passed'],
  ['scripts/tests/ci-platform-lanes.test.js (the conflicted file)', '++ 39 passed'],
  ['W1b suites on e50e2c37 + candidate (incl. the new test)', '++ 81 passed; new test fails without the fix']];
fs.writeFileSync(`${D}/03-round2-holds.json`, JSON.stringify({
  title: 'With the candidate, every round-2 guarantee still holds on the merged tree',
  subtitle: 'Merged tree = e50e2c37 sdk-java/core/cli byte-for-byte (W1b worker chunk has the same content hash); in this run the second Workspace Sessions had no completed turn (rig had not created its cwd), so O2 Shell is covered by the head runbook in card 1',
  blocks: [
    { table: t3 },
    { table: t3b },
  ] }, null, 1));
console.log(fs.readdirSync(D).join(' '));
