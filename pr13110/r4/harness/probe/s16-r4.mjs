// S16 (round 4): a831c40fcd restores the previous history when a backup preparation is refused after its checkpoint.
//   enospc-*: the Session's backup directory is a 4 MB disk image, so backing up a 6 MB file fails with ENOSPC mid-preparation.
//   busy-phantom: refusals while a tracked file is being rewritten; do refused prompts leave snapshots behind?
//   prepare-latency: prompt latency with many snapshots / tracked files (prepare now re-validates the previous history).
// usage: DB=<db> ARM=<arm> node s16-r4.mjs <scenario> <letter>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Report, Harness, HSession, startModel, startBrokerProxy, startStoreProxy, workspace, createWorkspaceSession, storeConnection, script, call, turn, toolTrace, backupDir, read, holderOf, sleep, j, FILES, NODE, RUN } from './lib.mjs';

const [scenario, letter] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head6';
const R = new Report(`s16-${scenario}-${arm}`);
const model = await startModel(`${RUN}/model-s16-${scenario}-${arm}.jsonl`);
const proxy = await startBrokerProxy();
let h = await new Harness({ name: `s16-${scenario}-${arm}`, modelUrl: model.url, brokerUrl: proxy.url, arm }).start();
const w = await workspace(letter);
const f = (rel) => path.join(w.dir, rel);
const mk = async () => {
  const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId));
  const c = await s.create();
  if (c.status !== 200) throw new Error(`create ${c.status} ${j(c.json)}`);
  return s;
};
const ok = (p) => p.terminal?.[0]?.type === 'turn_complete' && !p.status2?.recoveryBlocked;
const results = (p) => toolTrace(p.events ?? []).filter((l) => l.startsWith('result ')).map((l) => l.slice(7).replace(/\\"/g, '"').replace(/\/[^ "]*\/child\//g, '').slice(0, 150));
const lease = () => (['<none>', '<no row>'].includes(holderOf(letter)) ? 'free' : `held by ${holderOf(letter).slice(0, 8)}…`);
const hist = async (s) => (await s.history()).json?.history;
const describe = async (s, names) => {
  const x = await hist(s);
  if (!x) return 'history unavailable';
  return `snapshots=${j(x.state.snapshots.map((sn) => `${names[sn.promptId] ?? sn.promptId.slice(0, 8)}[${Object.keys(sn.trackedFileBackups).sort().join(',')}]`))} tracked=${j(Object.keys(x.state.files).sort())} failedBackups=${x.state.snapshots.flatMap((sn) => Object.entries(sn.trackedFileBackups).filter(([, b]) => b.failed).map(([k]) => `${names[sn.promptId] ?? '?'}:${k}`)).join(',') || 'none'} pending=${x.pendingTurn ? 'set' : 'null'}`;
};
const undo = async (s, p, label) => {
  const u = await s.rewind(p.promptId);
  return `${label}: ${u.status}${u.json?.code ? ' ' + u.json.code : ''}${u.json?.conflict ? ' conflict' : ''}${u.json?.filesChanged ? ' changed=' + j(u.json.filesChanged) : ''}`;
};
let volume = null;
const mountTinyBackupVolume = (dir) => {
  const img = path.join(RUN, `tiny-${scenario}-${arm}.dmg`);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('hdiutil', ['create', '-size', '12m', '-fs', 'HFS+', '-volname', 'fhtiny', '-ov', img], { stdio: 'ignore' });
  execFileSync('hdiutil', ['attach', '-nobrowse', '-mountpoint', dir, img], { stdio: 'ignore' });
  volume = dir;
  const freeKb = () => Number(execFileSync('df', ['-k', dir], { encoding: 'utf8' }).trim().split('\n').at(-1).split(/\s+/)[3]);
  // Leave about 1.5 MB free: small backups fit, the 3 MB file does not. The filler is removed later ("disk freed").
  fs.writeFileSync(path.join(dir, '.rig-filler'), Buffer.alloc(Math.max(0, freeKb() - 1536) * 1024));
  return `backup directory is a 12 MB volume pre-filled to ${freeKb()} KiB free`;
};
const BIG = () => 'MARK0\n' + 'line of filler text for the large tracked file\n'.repeat(65_000);
const freeDisk = () => {
  fs.rmSync(path.join(volume, '.rig-filler'), { force: true });
  return 'filler removed (disk space freed)';
};

try {
  if (scenario === 'enospc-next-prompt' || scenario === 'enospc-same-prompt') {
    fs.writeFileSync(f('a.txt'), 'a0');
    fs.writeFileSync(f('big.txt'), BIG());
    const s = await mk();
    R.say(`  ${mountTinyBackupVolume(backupDir(s.sessionId))}; big.txt is ${(fs.statSync(f('big.txt')).size / 1e6).toFixed(1)} MB`);
    const names = {};
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'a.txt', content: 'a1' })]], 'P1'));
    names[p1.promptId] = 'P1';
    R.check('P1 writes a.txt (small backup fits)', ok(p1) && read(w.dir, 'a.txt') === 'a1', turn(p1));
    const both = [call('edit', { file_path: 'a.txt', old_string: 'a1', new_string: 'a2' }), call('edit', { file_path: 'big.txt', old_string: 'MARK0', new_string: 'MARK1' })];
    if (scenario === 'enospc-same-prompt') {
      // one prompt: the two-file batch is refused, the model retries with a.txt only
      model.state.hook = async (entry) => {
        if (entry.step === 1) R.say(`  between batch 1 and batch 2: ${freeDisk()}`);
      };
      const batch1 = [call('write_file', { file_path: 'new.txt', content: 'n1' }), call('edit', { file_path: 'big.txt', old_string: 'MARK0', new_string: 'MARK1' })];
      const p2 = await s.prompt(script([batch1, [call('edit', { file_path: 'a.txt', old_string: 'a1', new_string: 'a2' })]], 'P2'), 240_000);
      model.state.hook = null;
      names[p2.promptId] = 'P2';
      const r = results(p2);
      R.note('P2 batch 1 (create new.txt + edit big.txt; big.txt cannot be backed up)', `${j(r.slice(0, 2))} new.txt exists=${fs.existsSync(f('new.txt'))}`);
      R.check('P2 batch 2, same prompt, a.txt only: the narrower retry succeeds', ok(p2) && read(w.dir, 'a.txt') === 'a2' && read(w.dir, 'big.txt').startsWith('MARK0'), `${turn(p2)} retry result: ${r.at(-1)}`);
      R.say(`  history after P2: ${await describe(s, names)}`);
      const rl = await s.reload();
      const p3 = await s.prompt(script([[call('edit', { file_path: 'a.txt', old_string: 'a2', new_string: 'a3' })]], 'P3'));
      names[p3.promptId] = 'P3';
      R.check('after detach + load, the next Write/Edit prompt works', rl.load === 200 && ok(p3) && read(w.dir, 'a.txt') === 'a3', `load=${rl.load} ${turn(p3)} model saw ${j(results(p3))}`);
      R.say(`  history after P3: ${await describe(s, names)}`);
      fs.writeFileSync(f('new.txt'), 'created by the user after P2');
      R.say('  the user creates new.txt (P2 never wrote it)');
      R.note('undo P3, P2, P1', [await undo(s, p3, 'undo(P3)'), `a=${j(read(w.dir, 'a.txt'))}`, await undo(s, p2, 'undo(P2)'), `a=${j(read(w.dir, 'a.txt'))} new.txt=${j(read(w.dir, 'new.txt'))}`, await undo(s, p1, 'undo(P1)'), `a=${j(read(w.dir, 'a.txt'))} new.txt=${j(read(w.dir, 'new.txt'))}`].join('; '));
    } else {
      const p2 = await s.prompt(script([both], 'P2'), 240_000);
      names[p2.promptId] = 'P2';
      R.check('P2 (a.txt + big.txt): refused as a tool error, nothing changed, Session usable', ok(p2) && read(w.dir, 'a.txt') === 'a1' && read(w.dir, 'big.txt').startsWith('MARK0'), `${turn(p2)} model saw ${j(results(p2))} lease=${lease()}`);
      R.say(`  history after the refused P2: ${await describe(s, names)}`);
      R.say(`  ${freeDisk()}`);
      const p3 = await s.prompt(script([[call('edit', { file_path: 'a.txt', old_string: 'a1', new_string: 'a3' })]], 'P3'));
      names[p3.promptId] = 'P3';
      R.check('P3 edits a.txt only: succeeds', ok(p3) && read(w.dir, 'a.txt') === 'a3', `${turn(p3)} model saw ${j(results(p3))}`);
      const after = await describe(s, names);
      R.check('durable history has no trace of the refused P2 (no P2 snapshot, big.txt not tracked)', !after.includes('"P2"') && !after.includes('big.txt'), after);
      const rl = await s.reload();
      const p4 = await s.prompt(script([[call('edit', { file_path: 'a.txt', old_string: 'a3', new_string: 'a4' })]], 'P4'));
      names[p4.promptId] = 'P4';
      R.check('after detach + load (cold binding), the next Write/Edit prompt works', rl.load === 200 && ok(p4) && read(w.dir, 'a.txt') === 'a4', `load=${rl.load} ${turn(p4)} model saw ${j(results(p4))}`);
      R.note('undo of the refused P2', await undo(s, p2, 'undo(P2)'));
      R.note('undo P4, then P1', [await undo(s, p4, 'undo(P4)'), `a=${j(read(w.dir, 'a.txt'))}`, await undo(s, p1, 'undo(P1)'), `a=${j(read(w.dir, 'a.txt'))}`].join('; '));
      R.say(`  final history: ${await describe(s, names)} lease=${lease()}`);
    }
  } else if (scenario === 'busy-phantom') {
    fs.writeFileSync(f('log.txt'), 'start\n');
    fs.writeFileSync(f('x.txt'), 'x0');
    const s = await mk();
    const names = {};
    const p1 = await s.prompt(script([[call('write_file', { file_path: 'log.txt', content: 'p1\n' }), call('write_file', { file_path: 'x.txt', content: 'x1' })]], 'P1'));
    names[p1.promptId] = 'P1';
    const every = Number(process.env.EVERY ?? 60);
    const writer = spawn(NODE, ['-e', `const fs=require('fs');setInterval(()=>fs.appendFileSync(${j(f('log.txt'))},'tick '+Date.now()+'\\n'),${every})`], { stdio: 'ignore' });
    await sleep(300);
    let prev = 'x1';
    const refused = [];
    const applied = [];
    for (let i = 1; i <= 10; i++) {
      const next = `x-${i}`;
      const p = await s.prompt(script([[call('edit', { file_path: 'x.txt', old_string: prev, new_string: next })]], 'PX'));
      names[p.promptId] = `B${i}`;
      if (read(w.dir, 'x.txt') === next) (applied.push(`B${i}`), (prev = next));
      else refused.push(`B${i}`);
    }
    writer.kill();
    await sleep(300);
    const last = await s.prompt(script([[call('edit', { file_path: 'x.txt', old_string: prev, new_string: 'x-final' })]], 'PX'));
    names[last.promptId] = 'LAST';
    const d = await describe(s, names);
    const x = await hist(s);
    const snapIds = (x?.state.snapshots ?? []).map((sn) => names[sn.promptId]);
    const phantom = refused.filter((n) => snapIds.includes(n));
    R.say(`  writer every ${every} ms: applied=${j(applied)} refused=${j(refused)}`);
    R.say(`  history: ${d}`);
    R.check('no snapshot for a refused prompt', refused.length > 0 && phantom.length === 0, `refused=${refused.length} with a snapshot: ${j(phantom)}`);
    R.check('the final edit after the writer stops succeeds', ok(last) && read(w.dir, 'x.txt') === 'x-final', turn(last));
  } else if (scenario === 'prepare-latency') {
    // 40 tracked files, then single-file prompts until capacity; and 1 tracked file over 60 prompts.
    for (let i = 0; i < 40; i++) fs.writeFileSync(f(`m/f${i}.txt`.replace('m/', `m-`)), `v0 ${i}`);
    const s = await mk();
    const p1 = await s.prompt(script([Array.from({ length: 40 }, (_, i) => call('write_file', { file_path: `m-f${i}.txt`, content: `v1 ${i}` }))], 'P1'), 240_000);
    const ms40 = [];
    for (let k = 2; k <= 5; k++) {
      const p = await s.prompt(script([[call('edit', { file_path: 'm-f0.txt', old_string: `v${k - 1} 0`, new_string: `v${k} 0` })]], 'PK'));
      ms40.push(p.ms);
    }
    R.say(`  40 tracked files: P1 ${p1.ms} ms; prompts 2-5 ${j(ms40)} ms`);
    fs.writeFileSync(f('one.txt'), 'n0');
    const s2 = await mk();
    const ms1 = [];
    for (let k = 1; k <= 60; k++) {
      const p = await s2.prompt(script([[call('edit', { file_path: 'one.txt', old_string: `n${k - 1}`, new_string: `n${k}` })]], 'PN'));
      ms1.push(p.ms);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    R.say(`  1 tracked file, 60 prompts: median ms of prompts 1-10=${med(ms1.slice(0, 10))} 26-35=${med(ms1.slice(25, 35))} 51-60=${med(ms1.slice(50, 60))}`);
    R.say(`== LATENCY ${j({ arm, ms40, first10: med(ms1.slice(0, 10)), mid10: med(ms1.slice(25, 35)), last10: med(ms1.slice(50, 60)) })}`);
  } else if (scenario === 'latency-100') {
    // 1 tracked file, 100 Write/Edit prompts: per-prompt latency and Harness event-loop stalls.
    fs.writeFileSync(f('one.txt'), 'n0');
    const s = await mk();
    const ms = [];
    for (let k = 1; k <= 100; k++) {
      const p = await s.prompt(script([[call('edit', { file_path: 'one.txt', old_string: `n${k - 1}`, new_string: `n${k}` })]], 'PN'), 300_000);
      if (!ok(p)) throw new Error(`prompt ${k}: ${turn(p)}`);
      ms.push(p.ms);
    }
    const stalls = (h.log().match(/maxMs=([0-9.]+) daemon event loop stall/g) ?? []).map((x) => Math.round(Number(x.match(/[0-9.]+/)[0])));
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const buckets = [0, 20, 40, 60, 80].map((i) => med(ms.slice(i, i + 20)));
    R.say(`== LATENCY ${j({ arm, buckets, max: Math.max(...ms), total_s: Math.round(ms.reduce((x, y) => x + y, 0) / 1000), stalls: stalls.length, maxStall: Math.max(0, ...stalls) })}`);
    fs.writeFileSync(`${RUN}/latency-100-${arm}.json`, JSON.stringify({ arm, ms, stalls }));
  } else if (scenario === 'store-traffic-100') {
    // Same 100 prompts as latency-100, through the Store proxy: requests, bytes and Store time per prompt.
    const store = await startStoreProxy();
    fs.writeFileSync(f('one.txt'), 'n0');
    const s = new HSession(h, await createWorkspaceSession(w.workspaceId), storeConnection(h, w.workspaceId, store.url));
    if ((await s.create()).status !== 200) throw new Error('create');
    const rows = [];
    for (let k = 1; k <= 100; k++) {
      const n0 = store.ledger.length;
      const p = await s.prompt(script([[call('edit', { file_path: 'one.txt', old_string: `n${k - 1}`, new_string: `n${k}` })]], 'PN'), 300_000);
      if (!ok(p)) throw new Error(`prompt ${k}: ${turn(p)}`);
      const mine = store.ledger.slice(n0);
      const gets = mine.filter((e) => e.method === 'GET');
      rows.push({ k, ms: p.ms, req: mine.length, gets: gets.length, respKB: Math.round(mine.reduce((x, e) => x + (e.respBytes ?? 0), 0) / 1024), reqKB: Math.round(mine.reduce((x, e) => x + (e.bytes ?? 0), 0) / 1024), storeMs: mine.reduce((x, e) => x + (e.ms ?? 0), 0) });
    }
    const pick = [1, 2, 10, 25, 50, 75, 100].map((k) => rows[k - 1]);
    for (const r of pick) R.say(`  prompt ${String(r.k).padStart(3)}: ${String(r.ms).padStart(5)} ms, Store requests ${r.req} (GET ${r.gets}), response ${r.respKB} KiB, request ${r.reqKB} KiB, summed Store time ${r.storeMs} ms`);
    R.say(`== TRAFFIC ${j({ arm, pick })}`);
    fs.writeFileSync(`${RUN}/store-traffic-100-${arm}.json`, JSON.stringify(rows));
    await store.close();
  } else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1500));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
  if (volume) {
    try {
      execFileSync('hdiutil', ['detach', volume, '-force'], { stdio: 'ignore' });
    } catch (e) {
      R.say(`  detach failed: ${e.message}`);
    }
  }
  R.done();
}
