// S7: what "undo prompt X" means with several prompts, plus a few byte/size/layout cases.
// usage: DB=<db> node s7-semantics.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, backups, backupDir, read, sha, j, SHELL, FILES } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const R = new Report(`s7-${scenario}`);
const model = await startModel();
const h = await new Harness({ name: `s7-${scenario}`, modelUrl: model.url }).start();
const w = await workspace(letter);
const f = (rel) => path.join(w.dir, rel);
const mk = async (profile = FILES) => {
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId), profile);
  await s.create();
  return s;
};
const state = (names) => names.map((n) => `${n}=${fs.existsSync(f(n)) ? j(read(w.dir, n)) : '<absent>'}`).join(' ');
try {
  if (scenario === 'multi-prompt') {
    fs.writeFileSync(f('a.txt'), 'a0');
    const s = await mk();
    const names = ['a.txt', 'b.txt', 'c.txt'];
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a1' }), call('write_file', { file_path: 'b.txt', content: 'b1' })]], 'P1'));
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a2' }), call('write_file', { file_path: 'c.txt', content: 'c2' })]], 'P2'));
    const p3 = await s.prompt(script([[call('write_file', { file_path: 'b.txt', content: 'b3' })]], 'P3'));
    R.say(`  after P1,P2,P3:        ${state(names)}`);
    const u2 = await s.rewind(p2.promptId);
    R.check('undo(P2) returns the Workspace to the state before P2 (P3 is undone too)', u2.status === 200 && read(w.dir, 'a.txt') === 'a1' && read(w.dir, 'b.txt') === 'b1' && !fs.existsSync(f('c.txt')), `changed=${j(u2.json?.filesChanged)} -> ${state(names)}`);
    const u1 = await s.rewind(p1.promptId);
    R.check('undo(P1) then returns to the state before P1', u1.status === 200 && read(w.dir, 'a.txt') === 'a0' && !fs.existsSync(f('b.txt')) && !fs.existsSync(f('c.txt')), `changed=${j(u1.json?.filesChanged)} -> ${state(names)}`);
    const u3 = await s.rewind(p3.promptId);
    R.note('undo(P3) after undo(P1) moves FORWARD to the state before P3', `status=${u3.status} changed=${j(u3.json?.filesChanged)} -> ${state(names)}`);
    const hist = (await s.history()).json.history;
    R.note('record after three undos', `snapshots=${hist.state.snapshots.length} undoReceipts=${hist.undoReceipts.length}`);
    const p4 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a4' })]], 'P4'));
    R.check('a new Write after the undos works and appends a snapshot', p4.terminal?.[0]?.type === 'turn_complete' && (await s.history()).json.history.state.snapshots.length === 4, `${turn(p4)} -> ${state(names)}`);
    const u4 = await s.rewind(p4.promptId);
    R.check('undo(P4) restores the state P4 started from', u4.status === 200 && read(w.dir, 'a.txt') === 'a2', `-> ${state(names)}`);
  } else if (scenario === 'bytes') {
    // binary, CRLF + BOM, empty file, 32 MiB file, nested new directories
    const big = randomBytes(32 * 1024 * 1024);
    const files = { 'bin.dat': Buffer.from([0x00, 0xff, 0xfe, 0xf0, 0x9f, 0x92, 0x0d, 0x0a]), 'crlf.txt': Buffer.from('﻿line1\r\nline2\r\n'), 'empty.txt': Buffer.alloc(0), 'big.bin': big };
    for (const [n, b] of Object.entries(files)) fs.writeFileSync(f(n), b);
    fs.chmodSync(f('bin.dat'), 0o600);
    const s = await mk();
    const t0 = Date.now();
    const p = await s.prompt(script([[...Object.keys(files).map((n) => call('write_file', { file_path: n, content: `replaced ${n}` })), call('write_file', { file_path: 'deep/new/dir/file.txt', content: 'x' })]], 'P1'), 300_000);
    R.check('P1 overwrites five kinds of files', p.terminal?.[0]?.type === 'turn_complete', `${turn(p)} backups=${backups(s.sessionId).length} backup bytes=${backups(s.sessionId).reduce((n, b) => n + fs.statSync(path.join(backupDir(s.sessionId), b)).size, 0)}`);
    const t1 = Date.now();
    const u = await s.rewind(p.promptId);
    const ok = Object.entries(files).every(([n, b]) => fs.readFileSync(f(n)).equals(b));
    R.check('undo restores every file byte for byte (binary, BOM+CRLF, empty, 32 MiB)', u.status === 200 && ok, `status=${u.status} undo ${Date.now() - t1} ms; ${Object.entries(files).map(([n, b]) => `${n}:${sha(fs.readFileSync(f(n))).slice(0, 8)}${sha(fs.readFileSync(f(n))) === sha(b) ? '=' : '!='}${sha(b).slice(0, 8)}`).join(' ')}`);
    R.check('mode 0600 restored', (fs.statSync(f('bin.dat')).mode & 0o777) === 0o600, (fs.statSync(f('bin.dat')).mode & 0o777).toString(8));
    R.note('directories created for a new file stay after undo', `deep/new/dir exists=${fs.existsSync(f('deep/new/dir'))} file exists=${fs.existsSync(f('deep/new/dir/file.txt'))}`);
  } else if (scenario === 'shell-profile') {
    // Shell profile: Write/Edit are backed up, Shell mutations are not; a Shell change to a tracked file is a conflict for undo.
    fs.writeFileSync(f('tracked.txt'), 't0');
    fs.writeFileSync(f('shell-only.txt'), 's0');
    const s = await mk(SHELL);
    const p = await s.prompt(script([[call('write_file', { file_path: 'tracked.txt', content: 't1' })], [call('run_shell_command', { command: 'echo s1 > shell-only.txt; echo made > made-by-shell.txt', description: 'shell writes' })]], 'P1'), 240_000);
    R.check('Shell-profile turn with Write then Shell completes', p.terminal?.[0]?.type === 'turn_complete' && read(w.dir, 'shell-only.txt') === 's1\n', turn(p));
    const hist = (await s.history()).json.history;
    R.check('only the Write path is tracked', j(Object.keys(hist.state.files)) === j(['tracked.txt']), j(Object.keys(hist.state.files)));
    const u = await s.rewind(p.promptId);
    R.check('undo restores the Write, leaves Shell mutations', u.status === 200 && read(w.dir, 'tracked.txt') === 't0' && read(w.dir, 'shell-only.txt') === 's1\n' && read(w.dir, 'made-by-shell.txt') === 'made\n', `changed=${j(u.json?.filesChanged)} shell-only=${j(read(w.dir, 'shell-only.txt'))}`);
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await model.close();
  R.done();
}
