// PR #13136: a concurrent duplicate that slips past the admission checks. A separate MySQL transaction inserts a row
// holding this Session's once key (k-up-once) and keeps it uncommitted, so the Store's non-locking check cannot see it.
// The Session then runs a turn whose UserPromptSubmit once-key Hook is committed: the Store's INSERT waits on the
// unique index, the phantom commits, and the INSERT fails with a duplicate key. Expected: the commit is rejected and
// rolled back (no second once-key row, journal not advanced by it), the Store logs which index refused it.
// usage: DB=<db> ARM=<dist> SPORT=.. BPORT=.. node s29-race.mjs <ws> <holdSeconds>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, pin, setControl, script, call, turn, hookLedger, RUN, RIG, DB, sql, one, sleep } from './lib.mjs';
import { STORAGE } from './manifest.mjs';
const [WS, HOLD] = process.argv.slice(2);
const ARM = process.env.ARM ?? 'head';
const R = new Report(`s29-race-${WS}-${ARM}`);
const env = Object.fromEntries(fs.readFileSync(`${RIG}/rig.env`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const model = await startModel();
setControl({});
const h = await new Harness({ name: `s29-${WS}`, modelUrl: model.url, arm: ARM }).start();
const w = await workspace(STORAGE[WS], WS);
const sid = await createWorkspaceSession(w.workspaceId);
const onceCalls = () => hookLedger((e) => e.session === sid && e.name === 'once' && !e.kind).length;
try {
  const s = new HSession(h, sid, storeConnection(h, w.workspaceId));
  const c = await s.create({ hookCatalog: pin(WS) });
  R.check('create Hook Session', c.status === 200, `${c.status} ${sid}`);
  const seq0 = one(`SELECT committed_sequence FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`);
  const phantom = `SET SESSION innodb_lock_wait_timeout=120; START TRANSACTION;
INSERT INTO qwen_managed_session_extension_record (session_scope_key, record_key, tenant_id, workspace_id, session_id, domain, record_id, operation_hash, revision, record_resource_id, created_at, first_sequence, hook_once_key_hash, hook_occurrence_hash, hook_ordinal)
 VALUES (SHA2(CONCAT('${env.TENANT}', CHAR(0), '${sid}'), 256), SHA2('rig-phantom', 256), '${env.TENANT}', '${w.workspaceId}', '${sid}', 'hook_execution', 'rig-phantom', SHA2('rig-phantom-op', 256), 1, 'rig-phantom-resource', 0, 0, SHA2('k-up-once', 256), SHA2('rig-phantom-occurrence', 256), 0);
SELECT CONCAT('phantom-inserted ', ROW_COUNT());
SELECT SLEEP(${HOLD});
COMMIT;
SELECT 'phantom-committed';`;
  const out = [];
  const t0 = Date.now();
  const my = spawn(env.MYSQL, ['-uroot', `-p${env.DBPASS}`, '-h127.0.0.1', `-P${env.DBPORT}`, '-N', '-B', '--unbuffered', DB], { stdio: ['pipe', 'pipe', 'pipe'] });
  my.stdout.on('data', (d) => out.push(`${Date.now() - t0}ms ${d.toString().trim()}`));
  my.stderr.on('data', (d) => /Warning/.test(d) || out.push(`err ${d}`));
  my.stdin.end(phantom);
  while (!out.some((l) => l.includes('phantom-inserted'))) await sleep(50);
  if (!out.some((l) => l.includes('phantom-inserted 1'))) throw new Error('phantom row was not inserted: ' + out.join(' | '));
  if (out.some((l) => l.includes('phantom-committed'))) throw new Error('phantom committed before the turn started');
  R.note('phantom transaction', out.join(' | '));
  const p = await s.prompt(script([[call('write_file', { file_path: 'race.txt', content: 'x' })]], 'RACE'));
  await new Promise((r) => (my.exitCode !== null ? r() : my.on('exit', r)));
  R.note('phantom transaction log', out.join(' | '));
  R.note('turn', `${turn(p)} after ${Date.now() - t0} ms`);
  const rows = sql(`SELECT record_id, IFNULL(hook_once_key_hash,'-') FROM qwen_managed_session_extension_record WHERE session_id='${sid}' AND hook_once_key_hash=SHA2('k-up-once',256)`);
  R.check('only the phantom holds the once key (the Store did not commit a second row)', rows.length === 1 && rows[0][0] === 'rig-phantom', rows.map((r) => r[0]).join(','));
  const log = fs.readFileSync(fs.readdirSync(RUN).filter((f) => /^spring-\d+\.log$/.test(f)).sort().map((f) => `${RUN}/${f}`).at(-1), 'utf8');
  const refusal = log.split('\n').filter((l) => /refused by a unique index/.test(l));
  const cause = log.split('\n').filter((l) => /uq_managed_session_hook_once/.test(l));
  R.check('Store logs the unique-index refusal', refusal.length >= 1, `${refusal.at(-1)?.replace(/^.*WARN/, 'WARN').slice(0, 220) ?? 'none'} | cause names index: ${cause.length > 0}`);
  const seq1 = one(`SELECT committed_sequence FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`);
  const head = sql(`SELECT recovery_status, IFNULL(recovery_detail_code,'-') FROM qwen_managed_session_journal_head WHERE session_id='${sid}'`)[0].join(' ');
  R.note('journal head', `committed_sequence ${seq0} -> ${seq1}; ${head}; once-key handler calls ${onceCalls()}`);
  R.note('status', JSON.stringify(await s.status()).slice(0, 300));
  const d = await s.detach();
  const l = await s.load();
  R.note('detach + load', `${d.status} ${l.status} ${l.json?.code ?? ''}`);
  if (l.status === 200) {
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'race-2.txt', content: 'y' })]], 'RACE-2'));
    R.note('next turn after reload', `${turn(p2)}; once-key handler calls ${onceCalls()}`);
    await s.detach();
  }
} finally {
  await h.close();
  await model.close();
  R.done({ session: sid });
}
