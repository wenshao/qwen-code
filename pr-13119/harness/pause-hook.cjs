// Preload for the WRITER process only. Every synchronous fs mutation whose
// path belongs to the settings file family (target, target.*, target.write-*/...)
// runs normally, then the process announces a numbered checkpoint and blocks
// until the orchestrator releases it. Nothing about the write itself is altered.
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.PAUSE_TARGET;
const ctl = process.env.PAUSE_CTL;
if (target && ctl) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let seq = 0;
  const related = (p) => {
    if (p === undefined || p === null) return false;
    const s = path.resolve(String(p));
    return s === target || s.startsWith(target + '.');
  };
  const orig = {};
  for (const name of ['mkdtempSync', 'writeFileSync', 'copyFileSync', 'renameSync', 'unlinkSync', 'rmSync']) {
    orig[name] = fs[name];
    fs[name] = function (...args) {
      const involved = args.slice(0, 2).filter((a) => typeof a === 'string' || a instanceof URL || Buffer.isBuffer(a)).some(related);
      const result = orig[name].apply(this, args);
      if (involved) {
        const n = ++seq;
        const desc = { n, pid: process.pid, op: name, args: args.slice(0, name === 'writeFileSync' ? 1 : 2).filter((a) => typeof a === 'string').map(String), result: typeof result === 'string' ? result : undefined };
        orig.writeFileSync.call(fs, path.join(ctl, `ckpt-${n}.json`), JSON.stringify(desc));
        const release = path.join(ctl, `release-${n}`);
        while (!fs.existsSync(release)) Atomics.wait(sleeper, 0, 0, 10);
      }
      return result;
    };
  }
  require('node:module').syncBuiltinESMExports();
}
