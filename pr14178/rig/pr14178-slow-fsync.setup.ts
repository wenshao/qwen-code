// PR #14178 verification only: delay every real durable file sync.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const delayMs = Number(process.env['PR14178_FSYNC_DELAY_MS'] ?? '125');
const counter = { calls: 0 };
(globalThis as Record<string, unknown>)['__pr14178FsyncCounter'] = counter;

const sleep = () => new Promise((resolve) => setTimeout(resolve, delayMs));
const fileHandle = Object.getPrototypeOf(
  (await fs.promises.open(import.meta.filename ?? new URL(import.meta.url).pathname, 'r')),
);
for (const name of ['sync', 'datasync'] as const) {
  const original = fileHandle[name];
  fileHandle[name] = async function (this: unknown, ...args: unknown[]) {
    counter.calls++;
    await sleep();
    return original.apply(this, args);
  };
}
for (const name of ['fsync', 'fdatasync'] as const) {
  const original = fs[name] as (...args: unknown[]) => void;
  (fs as Record<string, unknown>)[name] = (...args: unknown[]) => {
    counter.calls++;
    setTimeout(() => original(...args), delayMs);
  };
}
for (const name of ['fsyncSync', 'fdatasyncSync'] as const) {
  const original = fs[name] as (...args: unknown[]) => void;
  (fs as Record<string, unknown>)[name] = (...args: unknown[]) => {
    counter.calls++;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    return original(...args);
  };
}
for (const name of ['fsync', 'fdatasync'] as const) {
  const original = fs.promises as unknown as Record<string, unknown>;
  void original[name];
}
syncBuiltinESMExports();
import { afterAll } from 'vitest';
afterAll(() => {
  fs.appendFileSync(
    process.env['PR14178_COUNTER_FILE'] ?? '/dev/null',
    `${new Date().toISOString()} delayed_syncs=${counter.calls} delay_ms=${delayMs}\n`,
  );
});
