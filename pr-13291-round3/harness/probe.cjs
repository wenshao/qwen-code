// Preload for the Managed ACP child (and its Runtime worker, which ignores it).
// Records every fsynced write to the session log and, when PROBE_KILL names a
// trigger, SIGKILLs this process the instant the matching commit has synced.
'use strict';
const fs = require('node:fs');
const isWorker = process.argv.some((a) => a.includes('managed-runtime-worker'));
const isChild = !isWorker && process.argv.includes('--acp');
const logFile = process.env.PROBE_LOG;
const trigger = process.env.PROBE_KILL || '';
function note(obj) {
  if (!logFile) return;
  try {
    fs.appendFileSync(
      logFile,
      JSON.stringify({ t: Date.now(), pid: process.pid, role: isWorker ? 'worker' : isChild ? 'child' : 'other', ...obj }) + '\n',
    );
  } catch {}
}
if (isChild || isWorker) note({ ev: 'start', argv: process.argv.slice(2).join(' ').slice(0, 200) });
if (isChild) {
  const pending = new WeakMap();
  let fired = false;
  (async () => {
    const tmp = require('node:os').tmpdir() + '/probe-' + process.pid;
    const fh = await fs.promises.open(tmp, 'w');
    const proto = Object.getPrototypeOf(fh);
    await fh.close();
    fs.rmSync(tmp, { force: true });
    const origWrite = proto.writeFile;
    const origSync = proto.sync;
    proto.writeFile = function (data, ...rest) {
      try {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : typeof data === 'string' ? data : '';
        pending.set(this, text);
      } catch {}
      return origWrite.call(this, data, ...rest);
    };
    proto.sync = async function (...args) {
      const r = await origSync.apply(this, args);
      const text = pending.get(this);
      pending.delete(this);
      if (text && text.includes('"managedSession"')) {
        const kinds = [...text.matchAll(/"kind":"([a-z_.]+)"/g)].map((m) => m[1]);
        const phases = [...text.matchAll(/"phase":"([a-z_]+)"/g)].map((m) => m[1]);
        note({ ev: 'commit', bytes: text.length, kinds: [...new Set(kinds)].slice(0, 12), phases: [...new Set(phases)] });
        if (!fired && trigger) {
          let hit = false;
          // Fire once the transaction's COMMIT line has synced, not its event line.
          if (trigger === 'after-receipt' && text.includes('"operation":"recordToolResult"')) hit = true;
          if (trigger === 'after-results-ready' && text.includes('"commandId":"harness:results_ready:')) hit = true;
          if (trigger === 'after-results-consumed' && text.includes('"commandId":"harness:results_consumed:')) hit = true;
          if (hit) {
            fired = true;
            note({ ev: 'SIGKILL', trigger });
            process.kill(process.pid, 'SIGKILL');
            await new Promise(() => {});
          }
        }
      }
      return r;
    };
    note({ ev: 'armed', trigger });
  })().catch((e) => note({ ev: 'probe-error', message: String(e) }));
}
