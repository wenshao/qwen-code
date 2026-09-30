// S14 (round 2): the fixes and "Critical repairs" of 5d63bd50e1 / 263859b004 on the real stack.
// usage: DB=<db> [ARM=..] node s14-r2.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, backups, backupDir, read, holderOf, sql, one, sleep, j, FILES, RUN } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head3';
const R = new Report(`s14-${scenario}-${arm}`);
const model = await startModel();
const proxy = await startBrokerProxy();
let h = await new Harness({ name: `s14-${scenario}-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
const w = await workspace(letter);
const f = (rel) => path.join(w.dir, rel);
const mk = async () => {
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const lease = () => (holderOf(letter) === '<none>' || holderOf(letter) === '<no row>' ? 'free' : `held by ${holderOf(letter).slice(0, 8)}…`);
const seen = () => model.requests.at(-1)?.toolResults.map((t) => t.content.replace(/\\"/g, '"').replace(/\s+/g, ' ').slice(0, 170));
try {
  if (scenario === 'special-names') {
    // Legal file names that are also Object.prototype members.
    const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];
    for (const n of names) fs.writeFileSync(f(n), `original ${n}`);
    const s = await mk();
    const p1 = await s.prompt(script([names.map((n) => call('write_file', { file_path: n, content: `P1 ${n}` }))], 'P1'));
    R.check('P1 writes eight prototype-named files', p1.terminal?.[0]?.type === 'turn_complete' && names.every((n) => read(w.dir, n) === `P1 ${n}`), `${turn(p1)} model saw ${j(seen()?.slice(0, 2))}`);
    const hist = (await s.history()).json?.history;
    R.check('all eight are tracked with a backup', names.every((n) => hist?.state.snapshots[0]?.trackedFileBackups[n]?.backupFileName), `tracked=${j(Object.keys(hist?.state.snapshots[0]?.trackedFileBackups ?? {}))} backups=${backups(s.sessionId).length}`);
    const rl = await s.reload();
    const p2 = await s.prompt(script([names.map((n) => call('edit', { file_path: n, old_string: `P1 ${n}`, new_string: `P2 ${n}` }))], 'P2'));
    R.check('after detach/load (cold binding) P2 edits them again', rl.load === 200 && p2.terminal?.[0]?.type === 'turn_complete' && !p2.status2.recoveryBlocked && names.every((n) => read(w.dir, n) === `P2 ${n}`), `${turn(p2)} files=${j(names.map((n) => read(w.dir, n)))}`);
    const u = await s.rewind(p1.promptId);
    R.check('undo(P1) restores all eight originals', u.status === 200 && names.every((n) => read(w.dir, n) === `original ${n}`), `status=${u.status} changed=${j(u.json?.filesChanged)}`);
  } else if (scenario === 'undo-retry-after-release') {
    // F3 follow-up: after a definite bind refusal the undo runtime is released; the same requestId then cannot be acquired again.
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    const dir = backupDir(s.sessionId);
    fs.renameSync(dir, dir + '.away');
    const t0 = Date.now();
    const u1 = await s.rewind(p1.promptId);
    R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /warm|acquire|control|release/.test(l)).join(' | ')}`);
    R.check('missing backup: undo refused with 409, nothing restored, lease free, Session usable', u1.status === 409 && read(w.dir, 'notes.txt') === 'after P1' && lease() === 'free' && (await s.status()).recoveryBlocked === false, `status=${u1.status} code=${u1.json?.code} lease=${lease()}`);
    const u2 = await s.rewind(p1.promptId, u1.requestId);
    R.check('same requestId again: 409 runtime_session_not_acquirable, not blocked', u2.status === 409 && u2.json?.code === 'runtime_session_not_acquirable' && (await s.status()).recoveryBlocked === false, `status=${u2.status} code=${u2.json?.code}`);
    const t1 = await s.prompt(script([[call('read_file', { file_path: 'notes.txt' })]], 'READ'));
    R.check('a read-only tool turn while the backup is missing fails as a turn error and releases', t1.terminal?.[0]?.type === 'turn_error' && !t1.status2.recoveryBlocked && lease() === 'free', `${turn(t1)} lease=${lease()}`);
    fs.renameSync(dir + '.away', dir);
    const u3 = await s.rewind(p1.promptId, u1.requestId);
    R.note('backup repaired, the original requestId once more', `status=${u3.status} code=${u3.json?.code ?? ''}`);
    const u4 = await s.rewind(p1.promptId);
    R.check('backup repaired, a new requestId restores', u4.status === 200 && read(w.dir, 'notes.txt') === 'original', `status=${u4.status} notes=${j(read(w.dir, 'notes.txt'))}`);
    const t2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after repair' })]], 'WRITE'));
    R.check('tool turns work again after the repair', t2.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'notes.txt') === 'after repair', turn(t2));
  } else if (scenario === 'transient-backup-access') {
    // The backup directory is briefly unreadable (EACCES), then readable again.
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    const dir = backupDir(s.sessionId);
    fs.chmodSync(dir, 0o000);
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P2' })]], 'P2'));
    const u1 = await s.rewind(p1.promptId);
    const st1 = await s.status();
    fs.chmodSync(dir, 0o700);
    R.note('while the backup directory is unreadable', `P2: ${turn(p2)} notes=${j(read(w.dir, 'notes.txt'))}; undo: ${u1.status} ${u1.json?.code ?? ''}; recoveryBlocked=${st1.recoveryBlocked}; lease=${lease()}; model saw ${j(seen())}`);
    R.check('no mutation started while unreadable', read(w.dir, 'notes.txt') === 'after P1');
    const p3 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P3' })]], 'P3'));
    R.check('after access is back, the next Write works in the same Session', p3.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'notes.txt') === 'after P3' && !p3.status2.recoveryBlocked, `${turn(p3)} model saw ${j(seen())}`);
    const u2 = await s.rewind(p1.promptId);
    R.check('and undo(P1) restores the original', u2.status === 200 && read(w.dir, 'notes.txt') === 'original', `status=${u2.status} ${u2.json?.code ?? ''}`);
  } else if (scenario === 'readonly-drift') {
    fs.writeFileSync(f('a.txt'), 'a0');
    fs.writeFileSync(f('b.txt'), 'b0');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a1' }), call('write_file', { file_path: 'b.txt', content: 'b1' })]], 'P1'));
    fs.chmodSync(f('b.txt'), 0o444);
    const u1 = await s.rewind(p1.promptId);
    R.check('mode changed to 0444 outside: undo answers conflict, restores nothing', u1.status === 409 && u1.json?.conflict === true && read(w.dir, 'a.txt') === 'a1' && (await s.status()).recoveryBlocked === false, `status=${u1.status} body=${j(u1.json)} a=${j(read(w.dir, 'a.txt'))}`);
    fs.chmodSync(f('b.txt'), 0o000);
    const u2 = await s.rewind(p1.promptId);
    R.check('file unreadable (0000): undo answers conflict, restores nothing, Session usable', u2.status === 409 && u2.json?.conflict === true && read(w.dir, 'a.txt') === 'a1' && (await s.status()).recoveryBlocked === false, `status=${u2.status} code=${u2.json?.code ?? ''} conflict=${u2.json?.conflict} lease=${lease()}`);
    fs.chmodSync(f('b.txt'), 0o644);
    const u3 = await s.rewind(p1.promptId);
    R.check('mode back: undo restores both', u3.status === 200 && read(w.dir, 'a.txt') === 'a0' && read(w.dir, 'b.txt') === 'b0', `status=${u3.status}`);
  } else if (scenario === 'w1a-cold-load') {
    // main's W1a cold load: Java omits the tool profile, the Harness adopts the saved one and validates retained resources.
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P2' })]], 'P2'));
    await s.detach();
    await h.stop();
    h = await new Harness({ name: `s14-${scenario}-${arm}-b`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
    const s2 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId), 'none');
    const l = await s2.load();
    R.check('cold load in a new Harness WITHOUT a tool profile adopts the saved files profile', l.status === 200, `load=${l.status} ${l.json?.code ?? ''}`);
    const hist = await s2.history();
    R.check('history is readable after the profile-less cold load', hist.status === 200 && hist.json?.history?.state.snapshots.length === 2, `status=${hist.status} snapshots=${hist.json?.history?.state.snapshots.length}`);
    const u = await s2.rewind(p1.promptId);
    R.check('undo(P1) works after it', u.status === 200 && read(w.dir, 'notes.txt') === 'original', `status=${u.status} ${u.json?.code ?? ''}`);
    await s2.detach();
    // damage an OLDER file-history record (not the latest) and cold load again
    const rows = sql(`SELECT resource_id, byte_length FROM qwen_managed_session_resource WHERE session_id='${s.sessionId}' AND kind='managed-file_history' ORDER BY created_at`);
    const older = rows[0][0];
    sql(`UPDATE qwen_managed_session_resource SET inline_bytes = CONCAT(LEFT(inline_bytes, LENGTH(inline_bytes) - 2), 'X}') WHERE resource_id='${older}'`);
    const s3 = new HSession(h, s.sessionId, storeConnection(h, w.workspaceId), 'none');
    const l2 = await s3.load();
    R.note(`cold load after damaging the OLDEST of ${rows.length} file-history records`, `load=${l2.status} ${l2.json?.code ?? ''}`);
    if (l2.status === 200) await s3.detach();
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
  R.done();
}
