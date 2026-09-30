// S5: retention bounds. (a) the 100-snapshot limit; (b) the 64 KiB inline record limit as tracked files accumulate.
// usage: DB=<db> node s5-limits.mjs snapshots <letter> | record <letter> <files> | receipts <letter> <files>
import fs from 'node:fs';
import path from 'node:path';
import { Report, Harness, HSession, startModel, startBrokerProxy, workspace, createWorkspaceSession, storeConnection, script, call, turn, read, holderOf, one, sql, j, RUN } from './lib.mjs';

const [scenario, letter, filesArg] = process.argv.slice(2);
const R = new Report(`s5-${scenario}${filesArg ? '-' + filesArg : ''}`);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness({ name: `s5-${scenario}${filesArg ?? ''}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const w = await workspace(letter);
const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
await s.create();
const recordBytes = () => Number(one(`SELECT byte_length FROM qwen_managed_session_resource WHERE session_id='${s.sessionId}' AND kind='managed-file_history' ORDER BY created_at DESC, byte_length DESC LIMIT 1`) ?? 0);
const maxRecord = () => Number(one(`SELECT MAX(byte_length) FROM qwen_managed_session_resource WHERE session_id='${s.sessionId}' AND kind='managed-file_history'`) ?? 0);
const starts = () => proxy.ledger.filter((e) => /:start$/.test(e.url) && e.status === 200).length;
const stderr = () => h.log().split('\n').filter((l) => /recovery/i.test(l)).slice(-1).join('').slice(0, 300);
async function aftermath(p, label) {
  const st = await s.status();
  R.say(`  ${label}: ${turn(p)}`);
  R.say(`  harness stderr: ${stderr()}`);
  R.say(`  wire (last control calls): ${proxy.ledger.filter((e) => e.op).slice(-2).map((e) => `${e.op} -> ${e.status}${e.code ? ' ' + e.code : ''}`).join(' | ')}`);
  R.say(`  Session recoveryBlocked=${st.recoveryBlocked}; Workspace lease holder=${holderOf(letter) === p.promptId ? 'THIS PROMPT (still held)' : holderOf(letter)}`);
  const rl = await s.reload();
  R.say(`  detach -> ${rl.detach}, load -> ${rl.load} ${rl.code ?? ''}`);
  return st.recoveryBlocked;
}
try {
  if (scenario === 'snapshots') {
    fs.writeFileSync(path.join(w.dir, 'counter.txt'), '0');
    let first;
    const t0 = Date.now();
    for (let n = 1; n <= 100; n++) {
      const tp = Date.now();
      const p = await s.prompt(script([[call('write_file', { file_path: 'counter.txt', content: String(n) })]], `P${n}`));
      first ??= p.promptId;
      if (p.terminal?.[0]?.type !== 'turn_complete') {
        R.check(`prompt ${n} completes`, false, turn(p));
        break;
      }
      if ([1, 10, 25, 50, 75, 100].includes(n)) {
        const ops = proxy.ledger.filter((e) => e.t >= tp && e.op);
        R.say(`  after ${n} mutating prompts: snapshots=${(await s.history()).json.history.state.snapshots.length} record=${recordBytes()} B  this prompt ${p.ms} ms; history control calls: ${ops.map((e) => `${e.op.replace('raw-file-history:', '')} ${e.ms} ms`).join(', ')}`);
      }
    }
    const hist = (await s.history()).json.history;
    R.check('100 mutating prompts are retained as 100 snapshots', hist.state.snapshots.length === 100 && read(w.dir, 'counter.txt') === '100', `snapshots=${hist.state.snapshots.length} counter=${read(w.dir, 'counter.txt')} record=${recordBytes()} B`);
    const readOnly = await s.prompt(script([[call('read_file', { file_path: 'counter.txt' })]], 'READ'));
    R.check('a read-only prompt still works at the bound', readOnly.terminal?.[0]?.type === 'turn_complete', turn(readOnly));
    const n0 = starts();
    const p101 = await s.prompt(script([[call('write_file', { file_path: 'counter.txt', content: '101' })]], 'P101'));
    R.check('prompt 101 starts no mutation', read(w.dir, 'counter.txt') === '100' && starts() === n0, `counter=${read(w.dir, 'counter.txt')} starts +${starts() - n0}`);
    const blocked = await aftermath(p101, 'mutating prompt 101');
    R.say(`== RESULT snapshots: prompt101 blocked=${blocked}`);
  } else if (scenario === 'record') {
    const F = Number(filesArg ?? 40);
    const names = Array.from({ length: F }, (_, i) => `src/components/Component-${String(i).padStart(3, '0')}.tsx`);
    fs.mkdirSync(path.join(w.dir, 'src/components'), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(w.dir, n), `export const v = 0; // ${n}\n`);
    // P1 touches F files in batches of 10 (one prompt, several tool batches); later prompts edit one file each.
    const batches = [];
    for (let i = 0; i < F; i += 10) batches.push(names.slice(i, i + 10).map((n) => call('edit', { file_path: n, old_string: 'v = 0', new_string: 'v = 1' })));
    const p1 = await s.prompt(script(batches, 'P1'), 300_000);
    R.check(`P1 edits ${F} files`, p1.terminal?.[0]?.type === 'turn_complete', `${turn(p1)} record=${recordBytes()} B`);
    let n = 1;
    let last;
    const sizes = [recordBytes()];
    for (; n < 100; ) {
      const before = read(w.dir, names[0]);
      const n0 = starts();
      const p = await s.prompt(script([[call('edit', { file_path: names[0], old_string: `v = ${n}`, new_string: `v = ${n + 1}` })]], `P${n + 1}`));
      last = p;
      const seen = model.requests.at(-1)?.toolResults.at(-1)?.content ?? '';
      if (/undo backup could not be prepared/.test(seen)) {
        R.say(`  mutating prompt ${n + 1} with ${F} tracked files: ${turn(p)}`);
        R.say(`  model saw: ${seen.replace(/\\"/g, '"').slice(0, 260)}`);
        R.check(`prompt ${n + 1} starts no mutation and leaves the Session usable`, read(w.dir, names[0]) === before && starts() === n0 && !p.status2.recoveryBlocked, `starts +${starts() - n0} record=${recordBytes()} B lease holder=${holderOf(letter)}`);
        last = undefined;
        break;
      }
      if (p.terminal?.[0]?.type !== 'turn_complete') {
        R.say(`  mutating prompt ${n + 1} with ${F} tracked files: largest stored record so far ${maxRecord()} B (limit 65536 B); growth per prompt ~${sizes.length > 1 ? Math.round((sizes.at(-1) - sizes[0]) / (sizes.length - 1)) : '?'} B`);
        R.check(`prompt ${n + 1} starts no mutation`, read(w.dir, names[0]) === before && starts() === n0, `starts +${starts() - n0}`);
        break;
      }
      n++;
      sizes.push(recordBytes());
    }
    R.say(`  record sizes by prompt: ${sizes.join(', ')}`);
    const blocked = last && last.terminal?.[0]?.type !== 'turn_complete' ? await aftermath(last, `first refused prompt (#${n + 1})`) : false;
    R.say(`== RESULT record F=${F}: completed mutating prompts=${n} blocked=${blocked}`);
  } else if (scenario === 'receipts') {
    // Undo receipts share the same 64 KiB record. Fill the record close to the bound with ordinary prompts, then undo back and forth.
    const F = Number(filesArg ?? 40);
    const names = Array.from({ length: F }, (_, i) => `src/components/Component-${String(i).padStart(3, '0')}.tsx`);
    fs.mkdirSync(path.join(w.dir, 'src/components'), { recursive: true });
    for (const n of names) fs.writeFileSync(path.join(w.dir, n), `export const v = 0; // ${n}\n`);
    const batches = [];
    for (let i = 0; i < F; i += 10) batches.push(names.slice(i, i + 10).map((n) => call('edit', { file_path: n, old_string: 'v = 0', new_string: 'v = 1' })));
    const p1 = await s.prompt(script(batches, 'P1'), 300_000);
    const prompts = [p1.promptId];
    let n = 1;
    // stop while one more ordinary prompt would still fit
    const fill = [recordBytes()];
    const growth = () => (fill.length > 1 ? fill.at(-1) - fill.at(-2) : fill[0] * 0.65);
    while (fill.at(-1) + growth() < 65000 && n < 50) {
      const p = await s.prompt(script([[call('edit', { file_path: names[0], old_string: `v = ${n}`, new_string: `v = ${n + 1}` })]], `P${n + 1}`));
      if (p.terminal?.[0]?.type !== 'turn_complete') throw new Error('unexpected refusal while filling: ' + turn(p));
      prompts.push(p.promptId);
      n++;
      fill.push(recordBytes());
    }
    R.say(`  ${F} tracked files, ${n} mutating prompts: record=${recordBytes()} B (limit 65536 B), Session recoveryBlocked=${(await s.status()).recoveryBlocked}`);
    let blockedAt = 0;
    for (let k = 1; k <= 12; k++) {
      const target = k % 2 ? prompts[0] : prompts.at(-1);
      const before = read(w.dir, names[1]);
      const u = await s.rewind(target);
      const st = await s.status();
      R.say(`  undo #${k} (${k % 2 ? 'first' : 'last'} prompt): status=${u.status} ${u.json?.code ?? ''} filesChanged=${u.json?.filesChanged?.length ?? '-'} record=${recordBytes()} B recoveryBlocked=${st.recoveryBlocked}; ${names[1]} ${before.trim().slice(0, 20)} -> ${read(w.dir, names[1]).trim().slice(0, 20)}`);
      if (st.recoveryBlocked) {
        blockedAt = k;
        const hist = (await s.history()).json?.history;
        R.say(`  after the refused undo: files were ${before === read(w.dir, names[1]) ? 'NOT ' : ''}restored on disk; pendingUndo=${JSON.stringify(hist?.pendingUndo)} receipts=${hist?.undoReceipts.length}; Workspace lease holder=${holderOf(letter) === u.requestId ? 'the undo request (still held)' : holderOf(letter)}`);
        R.say(`  harness stderr: ${stderr()}`);
        const rl = await s.reload();
        R.say(`  detach -> ${rl.detach}, load -> ${rl.load} ${rl.code ?? ''}`);
        break;
      }
    }
    R.say(`== RESULT receipts F=${F}: prompts=${n} undo blocked at #${blockedAt}`);
  }
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
  R.done();
}
