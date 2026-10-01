// S8: the same 20,000-file storage captured and verified by the PR's maintenance jar and by a one-line candidate whose
// WorkspaceRecoveryMain uses a SingleConnectionDataSource instead of DriverManagerDataSource (new connection per call).
// Both captures pin the same cut, so their sessions/assets indexes must be byte-identical.
import fs from 'node:fs';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog('s8-ab');
const { say } = L;
const N_FILES = Number(process.env.N_FILES ?? 20000);
say(L.hostFacts());
L.sh('bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh down; bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh up > /dev/null');
await P.rollout(['a', 'b']);
const rig = await L.startRig('s8');
await P.populate(rig, { extraShell: [`mkdir -p gen && python3 -c "import os\nfor d in range(100):\n  os.makedirs(f'gen/d{d:03d}', exist_ok=True)\nfor i in range(${N_FILES}): open(f'gen/d{i % 100:03d}/f{i:06d}.txt','w').write('line %d\\n' % i * 8)" && find . | wc -l`] });
const { fence, revision } = await P.offlineAndFence(rig);
const ids = W.members('a').map((m) => m.id);
say(`   members=${ids.length} source entries=${L.sh(`find ${L.root('a')} | wc -l`)}`);
const stmts = () => Number(L.one(`SELECT IFNULL(SUM(COUNT_STAR),0) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${L.DB()}'`));
const conns = () => Number(L.one(`SELECT IFNULL(SUM(COUNT_STAR),0) FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='${L.DB()}' AND DIGEST_TEXT LIKE 'SELECT @@SESSION . auto_increment_increment%'`));
const rows = [];
for (const [arm, jar] of [['head', '/opt/w1b/head-server-workspace-bundle.jar'], ['single-connection', '/opt/w1b/cand2-server-workspace-bundle.jar']]) {
  const { bundle } = W.prepareBundle(`s8-${arm}`, { sessions: ids });
  const req = W.captureRequest({ fence, revision, bundle });
  L.sql('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
  const c = await W.w1b('capture', req, { oss: true, jar, label: `${arm}-capture` });
  const cs = stmts(); const cc = conns();
  L.sql('TRUNCATE TABLE performance_schema.events_statements_summary_by_digest');
  const v = await W.w1b('verify', W.verifyRequest(req), { jar, label: `${arm}-verify` });
  const vs = stmts(); const vc = conns();
  const man = c.code === 0 ? JSON.parse(fs.readFileSync(`${bundle}/.w1-recovery/manifest.json`, 'utf8')) : null;
  const row = { arm, captureMs: c.ms, verifyMs: v.ms, assets: c.json?.assets, entries: c.json?.result?.entries, captureStatements: cs, captureConnections: cc, verifyStatements: vs, verifyConnections: vc, capture: W.summary(c), verify: W.summary(v), sessionsIndex: man?.sessions.digest, assetsIndex: man?.assets.digest, mem: c.mem };
  rows.push(row);
  say(`   ${arm}: capture ${(c.ms / 1000).toFixed(1)} s (${cs} statements, ${cc} new connections) verify ${(v.ms / 1000).toFixed(1)} s (${vs} statements, ${vc} new connections) | ${W.summary(v).slice(0, 110)}`);
}
say('== summary');
for (const r of rows) say(`   ${r.arm.padEnd(18)} entries=${r.entries} assets=${r.assets} capture ${(r.captureMs / 1000).toFixed(1)} s / ${r.captureConnections} connections, verify ${(r.verifyMs / 1000).toFixed(1)} s / ${r.verifyConnections} connections, indexes ${r.sessionsIndex?.slice(0, 12)}/${r.assetsIndex?.slice(0, 12)}`);
say(`   indexes identical across arms: ${rows[0].sessionsIndex === rows[1].sessionsIndex && rows[0].assetsIndex === rows[1].assetsIndex}`);
fs.writeFileSync(`${L.OUT}/s8-ab.json`, JSON.stringify(rows, null, 1));
await rig.stop(); say('S8-DONE');
