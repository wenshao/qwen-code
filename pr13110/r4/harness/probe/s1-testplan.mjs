// S1: the PR's reviewer test plan, steps 1-3, on real MySQL 8.4.7 (the author's E2E used H2).
// usage: DB=<db> [ARM=head|base] node s1-testplan.mjs <letterA> <letterB>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, backups, backupDir, read, sha, j, one, RUN } from './lib.mjs';

const [la, lb] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head';
const R = new Report(`s1-testplan-${arm}`);
const model = await startModel(`${RUN}/model-s1-${arm}.jsonl`);
const proxy = await startBrokerProxy();
const h = await new Harness({ name: `s1-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
R.say(`harness arm=${arm} boot=${h.bootId} db=${one('SELECT VERSION()')}`);
const ORIGINAL_BIN = Buffer.from([0xf0, 0x9f, 0x92, 0x00, 0xff, 0xfe, 0x0a]); // not valid UTF-8
const sessions = [];
try {
  for (const letter of [la, lb]) {
    const w = await workspace(letter);
    const id = await createWorkspaceSession(w.workspaceId);
    const s = new HSession(h, id, storeConnection(h, w.workspaceId));
    fs.writeFileSync(path.join(w.dir, 'notes.txt'), `original-${letter}\n`);
    fs.writeFileSync(path.join(w.dir, 'blob.bin'), ORIGINAL_BIN);
    fs.chmodSync(path.join(w.dir, 'notes.txt'), 0o640);
    const c = await s.create();
    R.check(`[${letter}] create files-profile Session`, c.status === 200, `status=${c.status}`);
    sessions.push({ letter, w, s });
  }

  // Step 1: overwrite an existing file, create a new file, then edit the existing file again, in ONE prompt; same relative names in both Workspaces.
  for (const x of sessions) {
    const t0 = Date.now();
    const p = await x.s.prompt(
      script(
        [
          [call('write_file', { file_path: 'notes.txt', content: 'middle' }), call('write_file', { file_path: 'new.txt', content: 'created' }), call('write_file', { file_path: 'blob.bin', content: '�' })],
          [call('edit', { file_path: 'notes.txt', old_string: 'middle', new_string: 'final' })],
        ],
        'HISTORY_FILES_DONE',
      ),
    );
    x.promptId = p.promptId;
    R.check(`[${x.letter}] P1 two batches complete`, p.terminal?.[0]?.type === 'turn_complete' && !p.status2.recoveryBlocked, turn(p));
    R.check(`[${x.letter}] files on disk after P1`, read(x.w.dir, 'notes.txt') === 'final' && read(x.w.dir, 'new.txt') === 'created', `notes=${j(read(x.w.dir, 'notes.txt'))} new=${j(read(x.w.dir, 'new.txt'))}`);
    if (!arm.startsWith('base')) R.say(`      wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /control|:start|release|acquire/.test(l)).map((l) => l.replace(/^POST /, '')).join(' | ')}`);
    const hist = await x.s.history();
    x.hist = hist.json?.history;
    if (arm.startsWith('base')) {
      R.check(`[${x.letter}] base: no history route`, hist.status === 404, `GET files/history -> ${hist.status}`);
      R.check(`[${x.letter}] base: no backups on the worker volume`, backups(x.s.sessionId).length === 0, `backup dir entries=${backups(x.s.sessionId).length}`);
      const rw = await x.s.rewind(p.promptId);
      R.check(`[${x.letter}] base: no undo route`, rw.status === 404, `POST files/rewind -> ${rw.status}`);
      continue;
    }
    const snaps = x.hist?.state?.snapshots ?? [];
    R.check(`[${x.letter}] exactly one snapshot for the prompt, pendingTurn null`, hist.status === 200 && snaps.filter((s) => s.promptId === p.promptId).length === 1 && snaps.length === 1 && x.hist.pendingTurn === null, `snapshots=${snaps.length} tracked=${Object.keys(snaps[0]?.trackedFileBackups ?? {}).join(',')} pendingTurn=${x.hist?.pendingTurn}`);
    const tracked = snaps[0]?.trackedFileBackups ?? {};
    R.check(`[${x.letter}] repeated edit keeps the FIRST preimage (notes.txt version 1)`, tracked['notes.txt']?.version === 1 && tracked['new.txt']?.backupFileName === null, `notes=${j(tracked['notes.txt'])} new=${j(tracked['new.txt'])}`);
    const dir = backupDir(x.s.sessionId);
    const nb = tracked['notes.txt']?.backupFileName && fs.readFileSync(path.join(dir, tracked['notes.txt'].backupFileName));
    const bb = tracked['blob.bin']?.backupFileName && fs.readFileSync(path.join(dir, tracked['blob.bin'].backupFileName));
    R.check(`[${x.letter}] backup bytes on the worker volume are this Workspace's originals`, nb?.toString() === `original-${x.letter}\n` && bb?.equals(ORIGINAL_BIN), `notes backup=${j(nb?.toString())} blob backup sha=${bb && sha(bb).slice(0, 12)} expected=${sha(ORIGINAL_BIN).slice(0, 12)}`);
    R.check(`[${x.letter}] expected file states recorded (digest+mode)`, x.hist.state.files['notes.txt']?.digest === `sha256:${sha('final')}` && x.hist.state.files['new.txt']?.digest === `sha256:${sha('created')}`, j(x.hist.state.files).slice(0, 260));
  }
  R.check('Harness launch-directory decoy unchanged', read(h.root, 'proof.txt') === 'decoy' && !fs.existsSync(path.join(h.root, 'notes.txt')), `proof.txt=${j(read(h.root, 'proof.txt'))}`);
  if (arm.startsWith('base')) throw new Error('BASE-DONE');

  // Step 2: detach + load, then undo through the private API.
  for (const x of sessions) {
    const rl = await x.s.reload();
    const after = (await x.s.history()).json?.history;
    R.check(`[${x.letter}] detach/load keeps history`, rl.load === 200 && j(after) === j(x.hist), `detach=${rl.detach} load=${rl.load}`);
    // external edit -> conflict, nothing restored
    fs.writeFileSync(path.join(x.w.dir, 'notes.txt'), 'external');
    x.conflict = await x.s.rewind(x.promptId);
    R.check(`[${x.letter}] external edit -> 409 conflict, no restoration`, x.conflict.status === 409 && x.conflict.json?.conflict === true && read(x.w.dir, 'notes.txt') === 'external' && read(x.w.dir, 'new.txt') === 'created' && fs.readFileSync(path.join(x.w.dir, 'blob.bin')).toString() === '�', `status=${x.conflict.status} body=${j(x.conflict.json)} notes=${j(read(x.w.dir, 'notes.txt'))} new=${j(read(x.w.dir, 'new.txt'))}`);
    const st = await x.s.status();
    R.check(`[${x.letter}] conflict leaves the Session usable`, st.recoveryBlocked === false, `recoveryBlocked=${st.recoveryBlocked}`);
    fs.writeFileSync(path.join(x.w.dir, 'notes.txt'), 'final');
    x.undo = await x.s.rewind(x.promptId);
    const mode = fs.statSync(path.join(x.w.dir, 'notes.txt')).mode & 0o777;
    R.check(`[${x.letter}] undo restores original bytes, removes the created file`, x.undo.status === 200 && x.undo.json?.conflict === false && read(x.w.dir, 'notes.txt') === `original-${x.letter}\n` && !fs.existsSync(path.join(x.w.dir, 'new.txt')) && fs.readFileSync(path.join(x.w.dir, 'blob.bin')).equals(ORIGINAL_BIN), `status=${x.undo.status} filesChanged=${j(x.undo.json?.filesChanged)} notes=${j(read(x.w.dir, 'notes.txt'))} new.txt exists=${fs.existsSync(path.join(x.w.dir, 'new.txt'))} blob sha=${sha(fs.readFileSync(path.join(x.w.dir, 'blob.bin'))).slice(0, 12)} mode=${mode.toString(8)}`);
    R.check(`[${x.letter}] original mode 0640 restored`, mode === 0o640, `mode=${mode.toString(8)}`);
  }
  R.check('the other Workspace kept its own original', read(sessions[0].w.dir, 'notes.txt') === `original-${la}\n` && read(sessions[1].w.dir, 'notes.txt') === `original-${lb}\n`);

  // Step 3: replay of completed undo requests.
  for (const x of sessions) {
    const starts0 = proxy.ledger.filter((e) => e.op === 'raw-file-history:rewind').length;
    const again = await x.s.rewind(x.promptId, x.undo.requestId);
    const againConflict = await x.s.rewind(x.promptId, x.conflict.requestId);
    R.check(`[${x.letter}] same requestId replays the original receipts (200 and 409)`, again.status === 200 && j(again.json) === j(x.undo.json) && againConflict.status === 409 && j(againConflict.json) === j(x.conflict.json), `undo=${again.status} conflict=${againConflict.status}`);
    R.check(`[${x.letter}] replay runs no restoration`, proxy.ledger.filter((e) => e.op === 'raw-file-history:rewind').length === starts0, `rewind control calls before=${starts0} after=${proxy.ledger.filter((e) => e.op === 'raw-file-history:rewind').length}`);
    const fresh = await x.s.rewind(x.promptId);
    R.check(`[${x.letter}] a new undo of the same prompt changes nothing`, fresh.status === 200 && j(fresh.json?.filesChanged) === '[]', `status=${fresh.status} filesChanged=${j(fresh.json?.filesChanged)}`);
    const mismatch = await x.s.rewind(randomUUID(), x.undo.requestId);
    R.note(`[${x.letter}] old requestId with a different promptId`, `status=${mismatch.status} code=${mismatch.json?.code}`);
    // another write, then reload, then the old request again
    const p2 = await x.s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'second prompt' })]], 'P2_DONE'));
    R.check(`[${x.letter}] P2 (another write) completes`, p2.terminal?.[0]?.type === 'turn_complete', turn(p2));
    const rl = await x.s.reload();
    const n0 = proxy.ledger.filter((e) => e.op === 'raw-file-history:rewind').length;
    const a0 = proxy.ledger.filter((e) => /acquire/.test(e.url)).length;
    const late = await x.s.rewind(x.promptId, x.undo.requestId);
    R.check(`[${x.letter}] old undo after another write + reload: original receipt, no restoration, no acquire`, rl.load === 200 && late.status === 200 && j(late.json) === j(x.undo.json) && read(x.w.dir, 'notes.txt') === 'second prompt' && proxy.ledger.filter((e) => e.op === 'raw-file-history:rewind').length === n0 && proxy.ledger.filter((e) => /acquire/.test(e.url)).length === a0, `status=${late.status} notes=${j(read(x.w.dir, 'notes.txt'))}`);
    const st = await x.s.status();
    R.check(`[${x.letter}] Session not blocked at the end`, st.recoveryBlocked === false);
    const hist = (await x.s.history()).json.history;
    R.say(`      final record: snapshots=${hist.state.snapshots.length} undoReceipts=${hist.undoReceipts.length} pendingTurn=${hist.pendingTurn} pendingUndo=${hist.pendingUndo}`);
  }
  R.note('commitFileHistory transactions in MySQL (qwen_managed_session_journal_tx)', sessions.map((x) => `${x.letter}=${one(`SELECT COUNT(*) FROM qwen_managed_session_journal_tx WHERE session_id='${x.s.sessionId}' AND operation='commitFileHistory'`)}`).join(' '));
} catch (e) {
  if (e.message !== 'BASE-DONE') {
    R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 600));
    R.say(h.log().slice(-1500));
  }
} finally {
  for (const x of sessions) await x.s.detach().catch(() => undefined);
  await h.stop();
  await proxy.close();
  await model.close();
  R.done();
}
