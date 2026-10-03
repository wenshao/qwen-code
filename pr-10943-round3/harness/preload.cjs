// Fault injection for PR #10943 round 3. Loaded via NODE_OPTIONS=--require,
// so it rides the environment into the supervisor and the PTY host the
// supervisor spawns. Each knob is scoped by the process's own argv, so the
// launcher and the worker are untouched.
const fs = require('node:fs');
const argv = process.argv;
const log = (msg) => {
  if (process.env.PR10943_PRELOAD_LOG) {
    fs.appendFileSync(
      process.env.PR10943_PRELOAD_LOG,
      `${new Date().toISOString()} pid=${process.pid} ${msg}\n`,
    );
  }
};

// Slow PTY-host start: block the host's event loop before it can bind its
// socket, the way a loaded machine, a cold disk or an AV scan delays a
// fresh node process.
if (argv.includes('--internal-agent-view-pty-host')) {
  const ms = Number(process.env.PR10943_PTYHOST_DELAY_MS || 0);
  if (ms > 0) {
    log(`pty-host start delayed ${ms}ms`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    log('pty-host start released');
  }
}

// Store I/O stall inside the supervisor: the first fs.promises call that
// touches the jobs/ tree (the dispatch handler recording a session) waits
// PR10943_STALL_MS before proceeding.
if (argv.includes('--internal-agent-view-supervisor')) {
  const ms = Number(process.env.PR10943_STALL_MS || 0);
  if (ms > 0) {
    const fsp = require('node:fs/promises');
    let fired = false;
    for (const name of ['mkdir', 'writeFile', 'open', 'rename', 'lstat', 'stat', 'readFile']) {
      const orig = fsp[name];
      fsp[name] = async function (...args) {
        if (!fired && typeof args[0] === 'string' && args[0].includes('/jobs/')) {
          fired = true;
          log(`supervisor store stall ${ms}ms at ${name}(${args[0]})`);
          await new Promise((r) => setTimeout(r, ms));
          log('supervisor store stall released');
        }
        return orig.apply(this, args);
      };
    }
    require('node:module').syncBuiltinESMExports();
  }
}
