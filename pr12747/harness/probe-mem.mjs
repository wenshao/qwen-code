// Preloaded into the worker: on SIGUSR2, full GC then dump memoryUsage (and optionally a heap snapshot).
import fs from 'node:fs';
import v8 from 'node:v8';
process.on('SIGUSR2', () => {
  for (let i = 0; i < 3; i++) globalThis.gc?.();
  const m = process.memoryUsage();
  let snap;
  if (process.env.PROBE_SNAPSHOT) snap = v8.writeHeapSnapshot(process.env.PROBE_SNAPSHOT + '-' + Date.now() + '.heapsnapshot');
  fs.writeFileSync(process.env.PROBE_OUT, JSON.stringify({ ...m, snap }));
});
