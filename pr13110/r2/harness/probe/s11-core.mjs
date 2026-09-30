// S11: the shared core change (checkOriginFileChanged compares bytes, no mtime shortcut) on the compiled core of each arm.
// usage: node s11-core.mjs <head|base>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const arm = process.argv[2];
const tree = { head: '/rig/wt', base: '/rig/wt-base' }[arm];
const root = fs.mkdtempSync(path.join(os.tmpdir(), `fh-core-${arm}-`));
process.env.QWEN_HOME = path.join(root, 'qwen-home');
const { FileHistoryService } = await import(`${tree}/packages/core/dist/src/services/fileHistoryService.js`);
const out = [];
const say = (l) => (console.log(l), out.push(l));
async function correctness(name, before, after, oldMtime) {
  const dir = fs.mkdtempSync(path.join(root, 'proj-'));
  const svc = new FileHistoryService(`s-${name}`, true, dir);
  const file = path.join(dir, 'a');
  fs.writeFileSync(file, before);
  await svc.makeSnapshot('p1');
  await svc.trackEdit(file);
  fs.writeFileSync(file, after);
  if (oldMtime) fs.utimesSync(file, 0, 0);
  await svc.makeSnapshot('p2');
  fs.writeFileSync(file, 'new');
  const r2 = await svc.rewind('p2', false);
  const got = fs.readFileSync(file);
  say(`[${arm}] ${name}: rewind(p2) restored ${got.equals(after) ? 'the p2 content (correct)' : got.equals(before) ? 'the p1 content (WRONG: the change between p1 and p2 was not seen)' : 'something else'}  failed=${JSON.stringify(r2.filesFailed)}`);
}
await correctness('same size, older mtime', Buffer.from('one'), Buffer.from('tri'), true);
await correctness('invalid UTF-8 vs U+FFFD', Buffer.from([0xf0, 0x9f, 0x92]), Buffer.from('�'), false);
// cost of a snapshot when nothing changed (the ordinary CLI does this once per prompt for every tracked file)
async function cost(files, bytes) {
  const dir = fs.mkdtempSync(path.join(root, 'perf-'));
  const svc = new FileHistoryService(`perf-${files}-${bytes}`, true, dir);
  const chunk = Buffer.alloc(bytes, 0x61);
  await svc.makeSnapshot('p1');
  for (let i = 0; i < files; i++) {
    const f = path.join(dir, `f${i}.txt`);
    fs.writeFileSync(f, chunk);
    await svc.trackEdit(f);
    fs.appendFileSync(f, 'x');
  }
  await svc.makeSnapshot('p2'); // backs up the changed files
  const samples = [];
  for (let n = 3; n <= 7; n++) {
    const t0 = process.hrtime.bigint();
    await svc.makeSnapshot(`p${n}`); // nothing changed since p2
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  say(`[${arm}] unchanged snapshot, ${files} tracked file(s) x ${(bytes / 1024 / 1024).toFixed(1)} MiB: median ${samples[2].toFixed(1)} ms (min ${samples[0].toFixed(1)}, max ${samples[4].toFixed(1)})`);
  fs.rmSync(dir, { recursive: true, force: true });
}
await cost(200, 100 * 1024);
await cost(20, 5 * 1024 * 1024);
await cost(1, 256 * 1024 * 1024);
fs.rmSync(root, { recursive: true, force: true });
fs.writeFileSync(`/rig/out/s11-core-${arm}.log`, out.join('\n') + '\n');
