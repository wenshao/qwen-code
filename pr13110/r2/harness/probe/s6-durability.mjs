// S6: what the author's E2E did not cover — production MySQL, database restart/crash, server (Broker + workers) restart,
// Harness crash with cold load in a new process, and loss of the worker backup volume.
// usage: DB=<db> node s6-durability.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, backups, backupDir, read, holderOf, workerPids, sleep, one, j, RIG, DB, RUN } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const R = new Report(`s6-${scenario}${process.env.ARM ? '-' + process.env.ARM : ''}`);
const model = await startModel();
let h = await new Harness({ name: `s6-${scenario}${process.env.ARM ?? ''}`, modelUrl: model.url }).start();
const w = await workspace(letter);
const f = (rel) => path.join(w.dir, rel);
const sh = (cmd, args, env = {}) => execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').at(-1);
const ORIGINAL = Buffer.concat([Buffer.from('original '), Buffer.from([0xf0, 0x9f, 0x92, 0x00, 0xff])]);
async function seedAndWrite() {
  fs.writeFileSync(f('notes.txt'), ORIGINAL);
  fs.writeFileSync(f('other.txt'), 'other');
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await s.create();
  const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'changed' }), call('write_file', { file_path: 'new.txt', content: 'created' })]], 'P1'));
  R.check('P1 completes (overwrite + create)', p.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'notes.txt') === 'changed', turn(p));
  return { s, p };
}
const restored = () => fs.readFileSync(f('notes.txt')).equals(ORIGINAL) && !fs.existsSync(f('new.txt'));
try {
  if (scenario === 'mysql-restart' || scenario === 'mysql-kill') {
    const { s, p } = await seedAndWrite();
    const before = (await s.history()).json.history;
    R.say(`  ${sh(`${RIG}/mysql.sh`, [scenario === 'mysql-kill' ? 'kill' : 'stop'])}`);
    await sleep(1500);
    const down = await s.history();
    R.note('history while the database is down', `status=${down.status} ${down.json?.code ?? ''}`);
    R.say(`  ${sh(`${RIG}/mysql.sh`, ['start'])}`);
    let after;
    for (let i = 0; i < 60; i++) {
      after = await s.history();
      if (after.status === 200) break;
      await sleep(1000);
    }
    R.check(`history survives a database ${scenario === 'mysql-kill' ? 'crash (SIGKILL)' : 'restart'}`, after.status === 200 && j(after.json.history) === j(before), `status=${after.status} mysqld=${one('SELECT VERSION()')} uptime=${one("SHOW GLOBAL STATUS LIKE 'Uptime'") ?? ''}s`);
    const st = await s.status();
    R.note('Session after the outage', `recoveryBlocked=${st.recoveryBlocked}`);
    const undo = await s.rewind(p.promptId);
    R.check('undo after the database came back restores the exact original bytes', undo.status === 200 && restored(), `status=${undo.status} ${undo.json?.code ?? ''} changed=${j(undo.json?.filesChanged)}`);
    const again = await s.rewind(p.promptId, undo.requestId);
    R.check('receipt replays after the restart', again.status === 200 && j(again.json) === j(undo.json));
  } else if (scenario === 'spring-kill') {
    const { s, p } = await seedAndWrite();
    const pids = workerPids();
    R.say(`  ${sh(`${RIG}/stop.sh`, [DB, 'spring', 'KILL'])}; worker processes before=${pids.length}`);
    await sleep(1000);
    R.say(`  ${sh(`${RIG}/spring.sh`, ['head', DB])}`);
    R.note('backup files on the worker volume after the server restart', j(backups(s.sessionId)));
    let undo;
    for (let i = 0; i < 20; i++) {
      undo = await s.rewind(p.promptId);
      if (undo.status === 200) break;
      R.say(`    undo attempt ${i + 1}: status=${undo.status} ${undo.json?.code ?? ''} recoveryBlocked=${(await s.status()).recoveryBlocked}`);
      if ((await s.status()).recoveryBlocked) break;
      await sleep(3000);
    }
    R.check('undo after the server (Session Store + Broker + workers) was killed and restarted', undo.status === 200 && restored(), `status=${undo.status} ${undo.json?.code ?? ''} changed=${j(undo.json?.filesChanged)}`);
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after restart' })]], 'P2'));
    R.check('a new Write/Edit turn works after the restart', p2.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'notes.txt') === 'after restart', turn(p2));
  } else if (scenario === 'spring-kill-turn') {
    // Baseline for the restart case: does an ordinary tool turn work after the (non-durable, macOS) server restart? Runs on both arms.
    const arm = process.env.ARM ?? 'head';
    const { s } = await seedAndWrite();
    R.say(`  ${sh(`${RIG}/stop.sh`, [DB, 'spring', 'KILL'])}`);
    await sleep(1000);
    R.say(`  ${sh(`${RIG}/spring.sh`, [arm, DB], arm === 'base' ? { WORKER_DIST: 'base' } : {})}`);
    const p2 = await s.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'P2'), 120_000);
    R.say(`  [${arm}] read_file turn in the live Session after the server restart: ${turn(p2)}`);
    R.say(`  harness stderr: ${h.log().split('\n').filter((x) => /recovery|failed/i.test(x)).slice(-1).join('').slice(0, 260)}`);
    const s3 = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
    await s3.create();
    const p3 = await s3.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'P3'), 120_000);
    R.say(`  [${arm}] a NEW Session in the same Workspace after the restart: ${turn(p3)}`);
  } else if (scenario === 'harness-kill') {
    const { s, p } = await seedAndWrite();
    const before = (await s.history()).json.history;
    await h.stop('SIGKILL');
    R.say('  Harness killed with SIGKILL (no detach); starting a new Harness process');
    h = await new Harness({ name: `s6-${scenario}-b`, modelUrl: model.url }).start();
    const s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId));
    let l;
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      l = await s2.load();
      if (l.status === 200) break;
      await sleep(3000);
    }
    R.check('cold load in a new Harness (after the 60 s writer lease)', l.status === 200, `status=${l.status} ${l.json?.code ?? ''} after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const after = (await s2.history()).json?.history;
    R.check('history is intact in the new Harness', j(after) === j(before));
    const undo = await s2.rewind(p.promptId);
    R.check('undo from the new Harness restores the exact original bytes', undo.status === 200 && restored(), `status=${undo.status} ${undo.json?.code ?? ''} changed=${j(undo.json?.filesChanged)}`);
  } else if (scenario === 'volume-lost') {
    // The worker backup volume is lost (ephemeral container disk, or the Session moves to another host).
    const { s, p } = await seedAndWrite();
    R.note('where the backups live', `${backupDir(s.sessionId).replace(RUN, '<server account QWEN_HOME>/..')} -> ${j(backups(s.sessionId))}`);
    await s.detach();
    fs.renameSync(backupDir(s.sessionId), backupDir(s.sessionId) + '.lost');
    const l = await s.load();
    const hist = await s.history();
    R.note('load + history after the volume was lost', `load=${l.status} history=${hist.status} snapshots=${hist.json?.history?.state.snapshots.length}`);
    const ro = await s.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'READ_ONLY'));
    const st = await s.status();
    R.say(`  read-only prompt on an unrelated file: ${turn(ro)}`);
    R.say(`  Session recoveryBlocked=${st.recoveryBlocked}; Workspace lease holder=${holderOf(letter) === ro.promptId ? 'THIS PROMPT (still held)' : holderOf(letter)}`);
    R.say(`  harness stderr: ${h.log().split('\n').filter((x) => /recovery/i.test(x)).slice(-1).join('').slice(0, 260)}`);
    R.check('no file was touched', read(w.dir, 'notes.txt') === 'changed' && read(w.dir, 'new.txt') === 'created');
    const rl = await s.reload();
    R.say(`  detach -> ${rl.detach}, load -> ${rl.load} ${rl.code ?? ''}`);
    // put the volume back: does the Session recover?
    fs.renameSync(backupDir(s.sessionId) + '.lost', backupDir(s.sessionId));
    if (rl.load === 200) {
      const again = await s.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'READ_AGAIN'));
      R.note('after the backups were put back: read-only prompt in the same Session', turn(again));
    } else {
      const l2 = await s.load();
      R.note('after the backups were put back', `load=${l2.status} ${l2.json?.code ?? ''}`);
    }
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1500));
} finally {
  await h.stop();
  await model.close();
  R.done();
}
