// S-3 re-measure at registry level: the real WebTerminalRegistry from the PR
// head, a real PTY running a real shell that prints N bytes, and (optionally)
// os.platform() forced to 'win32' so the headless responder is built. Heap is
// read after the output has fully drained through the registry AND the
// responder's own write queue has settled, then after exit.
// usage: node --expose-gc registry-heap.mjs <win32|linux> <bytes>
import os from 'node:os';

const forced = process.argv[2];
const bytes = Number(process.argv[3] ?? 8 * 1024 * 1024);
if (forced === 'win32') (os as { platform: () => string }).platform = () => 'win32';

const { WebTerminalRegistry } = await import(
  '../../packages/core/src/services/web-terminal-registry.js'
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gc = () => {
  (globalThis as { gc: () => void }).gc();
  (globalThis as { gc: () => void }).gc();
};
const mb = () => +(process.memoryUsage().heapUsed / 1048576).toFixed(2);

const registry = new WebTerminalRegistry();
gc();
const baseline = mb();
const res = await registry.create({ workspaceCwd: process.cwd(), env: { ...process.env, SHELL: '/bin/bash' } });
if ('error' in res) throw new Error(res.error);
const id = res.terminalId;
let received = 0;
let last = Date.now();
registry.addOutputListener(id, (d: string) => {
  received += d.length;
  last = Date.now();
});
await sleep(800);
const lines = Math.ceil(bytes / 80);
registry.write(id, `${process.env.NOLF ? `head -c ${bytes} /dev/zero | tr '\\0' x; echo; echo FLOOD-DONE` : `head -c ${bytes} /dev/zero | tr '\\0' x | fold -w 78; echo FLOOD-DONE`}\r`);
while (Date.now() - last < 1500) await sleep(100);
// Let any responder write queue settle before measuring.
await sleep(2000);
gc();
const live = +(mb() - baseline).toFixed(2);
const snap = registry.readSnapshot(id);
const exited = new Promise((r) => registry.addExitListener(id, () => r(true)));
registry.write(id, 'exit\r');
await exited;
await sleep(500);
gc();
const afterExit = +(mb() - baseline).toFixed(2);
console.log(
  JSON.stringify({
    forced,
    bytesRequested: bytes,
    lines,
    receivedChars: received,
    handlesPrimaryDa: snap?.handlesPrimaryDa ?? false,
    scrollbackBytes: Buffer.byteLength(snap?.output ?? ''),
    heapLiveMB: live,
    heapAfterExitMB: afterExit,
  }),
);
registry.dispose?.();
process.exit(0);
