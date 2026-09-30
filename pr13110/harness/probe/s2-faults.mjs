// S2: the PR's reviewer test plan step 4 (missing backups, injected preparation/persistence failures, tool errors,
// cancellation, unknown effects, incomplete undo) plus undo admission edge cases, on real MySQL.
// usage: DB=<db> node s2-faults.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Report, Harness, HSession, startModel, startBrokerProxy, startStoreProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, backups, backupDir, read, holderOf, sleep, j, one, FILES, SHELL, RUN } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const R = new Report(`s2-${scenario}`);
const model = await startModel(`${RUN}/model-s2-${scenario}.jsonl`);
const proxy = await startBrokerProxy();
const store = await startStoreProxy();
const h = await new Harness({ name: `s2-${scenario}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const w = await workspace(letter);
const mk = async (profile = FILES) => {
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId, store.url), profile);
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const f = (rel) => path.join(w.dir, rel);
const starts = () => proxy.ledger.filter((e) => /:start$/.test(e.url) && e.status === 200).length;
const hist = async (s) => (await s.history()).json?.history;
const pending = async (s) => {
  const x = await hist(s);
  return `pendingTurn=${x?.pendingTurn ?? null} pendingUndo=${j(x?.pendingUndo ?? null)} snapshots=${x?.state.snapshots.length}`;
};
const stderr = () => h.log().split('\n').filter((l) => /recovery/i.test(l)).slice(-1).join('').slice(0, 260);

try {
  if (scenario === 'cold-missing-backup') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' }), call('write_file', { file_path: 'new.txt', content: 'created' })]], 'P1'));
    R.check('P1 completes and leaves one backup on the worker volume', p1.terminal?.[0]?.type === 'turn_complete' && backups(s.sessionId).length === 1, `${turn(p1)} backups=${j(backups(s.sessionId))}`);
    await s.detach();
    fs.rmSync(path.join(backupDir(s.sessionId), backups(s.sessionId)[0]));
    const l = await s.load();
    R.note('load after the backup file was removed', `status=${l.status} ${l.json?.code ?? ''}`);
    const n0 = starts();
    const undo = await s.rewind(p1.promptId);
    R.check('undo with a missing backup restores nothing', read(w.dir, 'notes.txt') === 'after P1' && read(w.dir, 'new.txt') === 'created', `status=${undo.status} body=${j(undo.json)} notes=${j(read(w.dir, 'notes.txt'))} new=${j(read(w.dir, 'new.txt'))}`);
    R.note('state after the refused undo', `recoveryBlocked=${(await s.status()).recoveryBlocked} ${await pending(s)} lease holder=${holderOf(letter)} stderr=${stderr()}`);
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P2' })]], 'P2'));
    R.check('a later Write starts no unbacked mutation', read(w.dir, 'notes.txt') === 'after P1' && starts() === n0, `${turn(p2)} notes=${j(read(w.dir, 'notes.txt'))} starts +${starts() - n0}`);
    const rl = await s.reload();
    R.note('reload afterwards', `detach=${rl.detach} load=${rl.load} ${rl.code ?? ''}`);
  } else if (scenario === 'live-missing-backup') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' }), call('write_file', { file_path: 'new.txt', content: 'created' })]], 'P1'));
    fs.rmSync(path.join(backupDir(s.sessionId), backups(s.sessionId)[0]));
    const undo = await s.rewind(p1.promptId);
    R.check('live Session: undo with a missing backup restores nothing', read(w.dir, 'notes.txt') === 'after P1' && read(w.dir, 'new.txt') === 'created', `status=${undo.status} body=${j(undo.json)}`);
    R.note('state after the refused undo', `recoveryBlocked=${(await s.status()).recoveryBlocked} ${await pending(s)} lease holder=${holderOf(letter)}`);
    const n0 = starts();
    const p2 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P2' })]], 'P2'));
    R.check('a later Write starts no unbacked mutation', read(w.dir, 'notes.txt') === 'after P1' && starts() === n0, `${turn(p2)} notes=${j(read(w.dir, 'notes.txt'))} starts +${starts() - n0}`);
  } else if (scenario === 'undo-refusal-lease') {
    // A definite undo refusal (missing backup -> bind rejected) after the undo runtime was acquired: who holds the Workspace afterwards?
    fs.writeFileSync(f('notes.txt'), 'original');
    fs.writeFileSync(f('other.txt'), 'other');
    const s = await mk();
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'after P1' })]], 'P1'));
    fs.rmSync(path.join(backupDir(s.sessionId), backups(s.sessionId)[0]));
    const t0 = Date.now();
    const undo = await s.rewind(p1.promptId);
    R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /acquire|control|release|warm/.test(l)).join(' | ')}`);
    const holder = holderOf(letter);
    R.check('undo refused, nothing restored', undo.status !== 200 && read(w.dir, 'notes.txt') === 'after P1', `status=${undo.status} code=${undo.json?.code}`);
    R.note('Workspace execution lease after the refused undo', holder === undo.requestId ? `held by the undo request ${holder} (never released)` : holder);
    const rl = await s.reload();
    R.note('detach/load of the Session', `detach=${rl.detach} load=${rl.load} ${rl.code ?? ''} recoveryBlocked=${(await s.status())?.recoveryBlocked}`);
    const p2 = await s.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'P2'));
    R.note('same Session after reload: read_file on an unrelated file', turn(p2));
    const sib = await mk();
    const sp = await sib.prompt(script([[call('read_file', { file_path: 'other.txt' })]], 'SIB'));
    R.note('another Session of the Workspace: read_file', turn(sp));
    R.note('lease holder at the end', holderOf(letter) === undo.requestId ? 'still the undo request' : holderOf(letter));
  } else if (scenario === 'store-fail-prepare') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    let hits = 0;
    store.state.hook = (entry, body) => (body?.operation === 'commitFileHistory' || /commitFileHistory/.test(JSON.stringify(body ?? {}).slice(0, 4000)) ? (hits++, hits === 1 ? 'fail-503' : 'forward') : 'forward');
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'mutated' })]], 'P1'));
    store.state.hook = null;
    R.check('history persistence failure before dispatch: no mutation started', hits >= 1 && read(w.dir, 'notes.txt') === 'original' && starts() === 0, `${turn(p)} injected=${hits} notes=${j(read(w.dir, 'notes.txt'))} starts=${starts()}`);
    R.note('state', `recoveryBlocked=${(await s.status()).recoveryBlocked} lease holder=${holderOf(letter) === p.promptId ? 'THIS PROMPT' : holderOf(letter)} stderr=${stderr()}`);
    const rl = await s.reload();
    R.note('reload', `detach=${rl.detach} load=${rl.load} ${rl.code ?? ''}`);
  } else if (scenario === 'tool-error') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'changed' })], [call('edit', { file_path: 'notes.txt', old_string: 'NOT PRESENT', new_string: 'x' }), call('edit', { file_path: 'missing/none.txt', old_string: 'a', new_string: 'b' })]], 'P1'));
    R.check('known tool errors: turn completes, Session usable', p.terminal?.[0]?.type === 'turn_complete' && !p.status2.recoveryBlocked, turn(p));
    const x = await hist(s);
    R.check('history retains the observed state (notes.txt tracked, pendingTurn null)', x.pendingTurn === null && x.state.files['notes.txt'] && x.state.files['missing/none.txt'] === null, j(x.state.files).slice(0, 200));
    const undo = await s.rewind(p.promptId);
    R.check('undo after a tool error restores the original', undo.status === 200 && read(w.dir, 'notes.txt') === 'original', `status=${undo.status} changed=${j(undo.json?.filesChanged)}`);
  } else if (scenario === 'cancel') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    // batch 1 writes; the model's next reply is held so the cancel lands between two batches
    let release;
    const gate = new Promise((r) => (release = r));
    model.state.hook = async (entry) => {
      if (entry.step === 1) await gate;
    };
    const sub = await s.submit(script([[call('write_file', { file_path: 'notes.txt', content: 'changed before cancel' }), call('write_file', { file_path: 'new.txt', content: 'created' })], [call('write_file', { file_path: 'never.txt', content: 'x' })]], 'P1'));
    for (let i = 0; i < 300 && read(w.dir, 'new.txt') !== 'created'; i++) await sleep(100);
    for (let i = 0; i < 100 && !model.requests.some((r) => r.step === 1); i++) await sleep(100);
    const c = await s.cancel();
    release();
    const st = await s.waitIdle(60_000);
    model.state.hook = null;
    const events = (await s.transcript()).filter((e) => e.promptId === sub.promptId && e.type.startsWith('turn_'));
    R.check('cancellation after the first batch: turn cancelled, Session usable', c.status === 204 && !st.recoveryBlocked && !fs.existsSync(f('never.txt')), `cancel=${c.status} terminal=${events.map((e) => `${e.type}(${e.data?.stopReason ?? ''})`).join(',')} recoveryBlocked=${st.recoveryBlocked}`);
    const x = await hist(s);
    R.check('cancelled turn keeps its observed file changes in history', x?.pendingTurn === null && x.state.snapshots.length === 1 && x.state.files['notes.txt'] && x.state.files['new.txt'], `${await pending(s)} files=${Object.keys(x?.state.files ?? {})}`);
    const undo = await s.rewind(sub.promptId);
    R.check('undo of the cancelled prompt restores', undo.status === 200 && read(w.dir, 'notes.txt') === 'original' && !fs.existsSync(f('new.txt')), `status=${undo.status} changed=${j(undo.json?.filesChanged)}`);
  } else if (scenario === 'unknown-snapshot') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    proxy.state.hook = (entry) => (entry.op === 'raw-file-history:snapshot' ? 'drop-reply' : 'forward');
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'effect happened' })]], 'P1'));
    proxy.state.hook = null;
    R.check('lost settlement reply: blocked, the effect ran exactly once, the model did not continue', p.status2.recoveryBlocked === true && read(w.dir, 'notes.txt') === 'effect happened' && starts() === 1 && model.requests.filter((r) => r.step >= 0).length === 1, `${turn(p)} starts=${starts()} model calls=${model.requests.filter((r) => r.step >= 0).length}`);
    R.check('pending marker is durable', (await hist(s))?.pendingTurn === p.promptId, await pending(s));
    const rl = await s.reload();
    R.check('reload stays blocked', rl.load === 409, `load=${rl.load} ${rl.code}`);
    R.note('Workspace lease', holderOf(letter) === p.promptId ? 'still held by the blocked prompt' : holderOf(letter));
    R.check('no replay after reload', starts() === 1 && read(w.dir, 'notes.txt') === 'effect happened');
  } else if (scenario === 'undo-rewind-reply-lost' || scenario === 'undo-release-reply-lost') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'changed' }), call('write_file', { file_path: 'new.txt', content: 'created' })]], 'P1'));
    const dropRelease = scenario === 'undo-release-reply-lost';
    let armed = true;
    proxy.state.hook = (entry) => (armed && (dropRelease ? /:release$/.test(entry.url) : entry.op === 'raw-file-history:rewind') ? ((armed = false), 'drop-reply') : 'forward');
    const undo = await s.rewind(p.promptId);
    proxy.state.hook = null;
    const st = await s.status();
    R.check(`incomplete undo (${dropRelease ? 'release' : 'rewind'} reply lost): refused as unfinished, Session blocked`, undo.status === 503 && st.recoveryBlocked === true, `status=${undo.status} code=${undo.json?.code} recoveryBlocked=${st.recoveryBlocked}`);
    R.note('files on disk', `notes=${j(read(w.dir, 'notes.txt'))} new.txt exists=${fs.existsSync(f('new.txt'))}`);
    R.check('pending undo is durable', j((await hist(s))?.pendingUndo) === j({ requestId: undo.requestId, promptId: p.promptId }), await pending(s));
    const again = await s.rewind(p.promptId, undo.requestId);
    R.note('same requestId retried in the live Session', `status=${again.status} code=${again.json?.code}`);
    const rl = await s.reload();
    R.check('reload stays blocked with the file-history code', rl.load === 409 && rl.code === 'hosted_file_history_recovery_required', `load=${rl.load} ${rl.code}`);
    R.note('Workspace lease', `holder=${holderOf(letter)} (undo runtime session = requestId ${undo.requestId})`);
  } else if (scenario === 'undo-busy') {
    // Another Session of the same Workspace is running a Shell command while this Session asks for undo.
    fs.writeFileSync(f('notes.txt'), 'original');
    const b = await mk();
    const p = await b.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'changed' })]], 'P1'));
    const a = await mk(SHELL);
    const long = await a.submit(script([[call('run_shell_command', { command: 'sleep 12; echo done', description: 'long job' })]], 'LONG_DONE'));
    for (let i = 0; i < 200 && holderOf(letter) !== long.promptId; i++) await sleep(100);
    const t0 = Date.now();
    const undo = await b.rewind(p.promptId);
    const st = await b.status();
    R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /acquire|control|release|warm/.test(l)).join(' | ')}`);
    R.check('undo while the Workspace is busy is refused without touching files', undo.status !== 200 && read(w.dir, 'notes.txt') === 'changed', `status=${undo.status} code=${undo.json?.code}`);
    R.note('Session B after the busy refusal', `recoveryBlocked=${st.recoveryBlocked} ${await pending(b)} stderr=${stderr()}`);
    await a.waitIdle(120_000);
    const retry = await b.rewind(p.promptId);
    R.note('retry after the other Session finished', `status=${retry.status} code=${retry.json?.code} notes=${j(read(w.dir, 'notes.txt'))}`);
    const np = await b.prompt(script([], 'NEXT'));
    R.note('next prompt in Session B', turn(np));
    const rl = await b.reload();
    const after = rl.load === 200 ? await b.rewind(p.promptId) : undefined;
    R.note('after detach/load', `load=${rl.load} ${rl.code ?? ''} undo=${after?.status} notes=${j(read(w.dir, 'notes.txt'))}`);
  } else if (scenario === 'admission') {
    fs.writeFileSync(f('notes.txt'), 'original');
    const s = await mk();
    const p = await s.prompt(script([[call('write_file', { file_path: 'notes.txt', content: 'changed' })]], 'P1'));
    const raw = (body, clientId = s.clientId) => h.json(`/session/${s.sessionId}/files/rewind`, body, { clientId: clientId ?? undefined });
    const cases = [
      ['requestId not a UUID', await raw({ promptId: p.promptId, requestId: 'abc' }), 400],
      ['promptId missing', await raw({ requestId: randomUUID() }), 400],
      ['unknown promptId', await raw({ promptId: randomUUID(), requestId: randomUUID() }), 404],
      ['no client id', await raw({ promptId: p.promptId, requestId: randomUUID() }, null), 404],
      ['another client id', await raw({ promptId: p.promptId, requestId: randomUUID() }, randomUUID()), 404],
    ];
    for (const [label, r, want] of cases) R.check(`undo refused: ${label}`, r.status === want, `status=${r.status} code=${r.json?.code}`);
    const noId = await h.json(`/session/${s.sessionId}/files/history`, undefined, {});
    R.check('history without the client id is refused', noId.status === 404, `status=${noId.status}`);
    R.check('refusals left the file and the Session alone', read(w.dir, 'notes.txt') === 'changed' && (await s.status()).recoveryBlocked === false);
    // undo while a turn is active in the same Session
    let release;
    const gate = new Promise((r) => (release = r));
    model.state.hook = async (entry) => {
      if (entry.step === 0 && entry.reply === 'HELD') await gate;
    };
    const sub = await s.submit(script([], 'HELD'));
    for (let i = 0; i < 100 && !model.requests.some((r) => r.reply === 'HELD'); i++) await sleep(50);
    const during = await s.rewind(p.promptId);
    release();
    await s.waitIdle();
    R.check('undo during an active turn -> 409 hosted_turn_active, not blocked', during.status === 409 && during.json?.code === 'hosted_turn_active' && (await s.status()).recoveryBlocked === false, `status=${during.status} code=${during.json?.code}`);
    // two concurrent undo requests
    const [u1, u2] = await Promise.all([s.rewind(p.promptId), s.rewind(p.promptId)]);
    R.check('two concurrent undo requests: one runs, one is refused as active', [u1.status, u2.status].sort().join() === '200,409' && read(w.dir, 'notes.txt') === 'original', `statuses=${u1.status},${u2.status} codes=${u1.json?.code ?? ''},${u2.json?.code ?? ''}`);
    R.check('Session usable afterwards', (await s.status()).recoveryBlocked === false, sub.promptId ? await pending(s) : '');
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await proxy.close();
  await store.close();
  await model.close();
  R.done();
}
