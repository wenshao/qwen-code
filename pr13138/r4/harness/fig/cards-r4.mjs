// Round-4 cards: head d8bc703e (B1 fix 258c57ed, V31, retirement evidence) and head + main d5c22d33.
import fs from 'node:fs';
const O = '/Users/wenshao/pr13138-rig/out';
const j = (p) => JSON.parse(fs.readFileSync(`${O}/${p}`, 'utf8'));
const r3head = j('e2e-e50/m3-hooks.json'); const r3rb = j('e2e-e50/runbook-head/r2-matrix-e50.json');
const h = j('e2e-r4/m3-hooks.json');
const d = j('e2e-r4/r4-runbook-d8b.json'); const m = j('e2e-r4/r4-runbook-m4.json');
const fly = fs.readFileSync(`${O}/e2e-r4-flyway.txt`, 'utf8');
const st = (s) => !s ? '-' : s.startsWith('state=') ? s.match(/state=\w+/)[0].replace('state=', '') : `refused: ${s.replace(/^REFUSED (protocol_validation_failed: )?(Workspace recovery: )?/, '')}`;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const D = '/Users/wenshao/pr13138-rig/fig/cards-r4';
fs.mkdirSync(D, { recursive: true });
const sess = (s) => s.match(/sessions=(\d+\/\d+)/)?.[1];

const t1 = [['storage', 'round 3: e50e2c37', 'd8bc703e (head)', 'd8bc703e + main d5c22d33']];
t1.push(['2 plain Files Sessions', `-- ${st(r3head.b.summary)}`, `++ ${st(h.b.summary)} -> ${st(h.bVerify)}, replay identical`, '- (not run; W1b chunk identical)']);
t1.push(['runbook: Files + Shell + O2 Shell (3 MB, 3 segments)\n+ a real undo (1 undoReceipt)\n+ O1 and S2 deleted by the real Java completion', `-- ${st(r3rb.A.capture)}\n   (round 3 had no undo / deletions)`,
  `++ ${st(d.A.capture)} ${sess(d.A.capture)} in ${sec(d.A.captureMs)} -> ${st(d.A.verify)}\n++ both deleted Sessions in sessions.ndjson\n++ replay identical; 37 authority tables unchanged\n++ SIGKILL while assets.ndjson publishes -> resume ${st(d.R130.resume)}`,
  `++ ${st(m.A.capture)} ${sess(m.A.capture)} in ${sec(m.A.captureMs)} -> ${st(m.A.verify)}\n++ both deleted Sessions in sessions.ndjson\n++ replay identical; authority unchanged`]);
t1.push(['1 plain + 1 Hosted Hooks Session', `!! ${st(r3head.a.summary)}`, `!! ${st(h.a.summary)} (as designed)`, '-']);
t1.push(['1 Hosted MCP Session', `!! ${st(r3head.c.summary)}`, `!! ${st(h.c.summary)} (as designed)`, '-']);
const fl = [['Flyway (real fat jar as the systemd service)', 'result']];
for (const l of fly.split('\n').filter((x) => x.startsWith('== '))) {
  const [, label, jar, state] = l.match(/^== (\S+): (\S+) -> (\w+)/);
  const hist = l.match(/history=\[(.*)\]/)[1].split(' ').filter((x) => /^\d+:/.test(x)).map((x) => x.split(':')[0]).join(',');
  const name = { 'H1-head-fresh': 'fresh DB, head', 'H2a-main-fresh': 'fresh DB, main d5c22d33', 'H2b-main-then-head': 'main d5c22d33 DB, then head', 'H3a-e50-fresh': 'fresh DB, round-3 head e50e2c37', 'H3b-e50-then-head': 'e50e2c37 DB (V28 = W1b), then head' }[label];
  fl.push([name, state === 'active' ? `++ starts; versions >=27: ${hist}` : `!! does not start: Migration checksum mismatch for version 28`]);
}
fs.writeFileSync(`${D}/01-b1-fixed.json`, JSON.stringify({
  title: 'd8bc703e: B1 is fixed — ordinary Hosted Sessions are captured again',
  subtitle: 'Same Ubuntu 24.04 ext4 VM + MySQL 8.4.11; each build ran its own fat jar (systemd), Harness/worker bundle and shipped *-workspace-bundle.jar; scripted model',
  blocks: [
    { table: t1 },
    { label: 'Migrations', table: fl },
    { note: 'main\'s new scripts/check-flyway-migrations.js reports "31 migrations, all versions unique" for the head and for head + main (it flags round 3\'s two V27 files). A database created by an intermediate head of this PR (V28 or V27 = W1b) cannot be upgraded; recreate it.' },
  ] }, null, 1));

const t2 = [['Session (deleted through SessionLifecycleCoordinator)', 'operation', 'Session', 'journal head', 'retirement', 'publications']];
for (const [n, x] of Object.entries(d.deleted)) {
  const f = x.facts;
  t2.push([`${n}${n === 'O1' ? ' (O2 Shell publication)' : ' (Shell)'}`, `${f.op[0]}/${f.op[1]}/${f.op[2]}`, f.session[0], `${f.head[0]}, checkpoint ${f.head[1]}, writer ${f.head[2]}`, `same op, gen ${f.retirement[1]}, protected ${f.retirement[2]}`, f.publications]);
}
const t3 = [['tamper applied to S2 (reverted after each case)', 'capture']];
for (const n of d.neg) t3.push([n.what, `++ refused: ${(n.stderr || n.summary).replace(/^(protocol_validation_failed: )?(Workspace recovery: )?/, '')}${n.state ? ` (${n.state})` : ' (preflight, no row)'}`]);
t3.push(['control: everything reverted, new UUID', `++ ${st(d.negControl)}`]);
fs.writeFileSync(`${D}/02-retirement.json`, JSON.stringify({
  title: 'The new retired-Session path: real Java DELETE completion, then tampering',
  subtitle: 'Public DELETE of a Workspace Session is still 409 workspace_unavailable, so only the admission row is SQL (same columns as ManagedAgentStore); claim + completeOperation + retire() are the real code',
  blocks: [
    { label: 'What the real completion left behind', table: t2 },
    { label: 'Capture of the same storage after one tamper at a time (d8bc703e)', table: t3 },
    { note: 'Accepted only as a whole: DELETED Session with deleted_at, retirement generation 1 and not protected, the DELETE operation COMPLETED/CONFIRMED under the same id, and a DELETED head with no checkpoint pointer or writer. Each of the six single deviations below is refused; the journal and its resources are still exported and verified.' },
  ] }, null, 1));
console.log(fs.readdirSync(D).join(' '));
