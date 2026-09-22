// Loaded via --require (execArgv) or NODE_OPTIONS in the daemon AND every
// process it spawns with those args. Records what V8 actually got.
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const dir = process.env.PR12353_PROBE_DIR || '/root/verify/pr12353-work/probe-out';
try {
  fs.mkdirSync(dir, { recursive: true });
  const rec = {
    pid: process.pid,
    ppid: process.ppid,
    role: process.argv.includes('--acp') ? 'acp-child' : process.argv.includes('serve') ? 'daemon' : 'other',
    argv: process.argv.slice(1),
    execArgv: process.execArgv,
    heapSizeLimitMb: +(v8.getHeapStatistics().heap_size_limit / 1048576).toFixed(2),
    gcExposed: typeof globalThis.gc === 'function',
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    qwenCodeServe: process.env.QWEN_CODE_SERVE ?? null,
    loadedVia: __filename,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify(rec));
} catch {}
