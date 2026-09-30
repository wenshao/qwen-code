// S12: rolling-upgrade order. Harness arm and server (Broker + worker) arm differ.
// usage: DB=<server db> SPORT=.. BPORT=.. HARNESS_ARM=<head|base> SERVER_ARM=<label> node s12-skew.mjs <letter>
import fs from 'node:fs';
import path from 'node:path';
import { Report, Harness, HSession, startModel, startBrokerProxy, ledgerLines, workspace, createWorkspaceSession, storeConnection, script, call, turn, read, holderOf } from './lib.mjs';
const [letter] = process.argv.slice(2);
const ha = process.env.HARNESS_ARM, sa = process.env.SERVER_ARM;
const R = new Report(`s12-skew-harness-${ha}-server-${sa}`);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness({ name: `s12-${ha}-${sa}`, modelUrl: model.url, brokerUrl: proxy.url, arm: ha }).start();
const w = await workspace(letter);
try {
  fs.writeFileSync(path.join(w.dir, 'notes.txt'), 'original');
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  await s.create();
  const t0 = Date.now();
  const p = await s.prompt(script([[call('read_file', { file_path: 'notes.txt' })], [call('write_file', { file_path: 'notes.txt', content: 'changed' })]], 'DONE'));
  const st = await s.status();
  R.say(`Harness=${ha}, Broker+worker=${sa}: read_file then write_file -> ${turn(p)}`);
  R.say(`  wire: ${ledgerLines(proxy.ledger, t0).filter((l) => /acquire|control|:start|release/.test(l)).join(' | ')}`);
  R.say(`  notes.txt=${JSON.stringify(read(w.dir, 'notes.txt'))} recoveryBlocked=${st.recoveryBlocked} lease holder=${holderOf(letter) === p.promptId ? 'THIS PROMPT (still held)' : holderOf(letter)}`);
  R.say(`  harness stderr: ${h.log().split('\n').filter((l) => /recovery blocked|failed:/i.test(l)).slice(-1).join('').slice(0, 260)}`);
  if (ha === 'head') {
    const hist = await s.history();
    R.say(`  GET files/history -> ${hist.status} ${hist.json?.code ?? ''} snapshots=${hist.json?.history?.state.snapshots.length ?? '-'}`);
  }
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
  R.done();
}
