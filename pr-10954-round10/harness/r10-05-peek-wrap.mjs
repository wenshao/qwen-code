// R10-4: can session text forge a continuation line in `qwen sessions peek`?
// Real supervisor (left behind by a `--bg` launch), sessions written with the
// arm's own store writers, `peek` through the shipped bin inside a REAL pty
// of a fixed width (python pty + TIOCSWINSZ), and once more through a pipe.
//   node r10-05-peek-wrap.mjs head
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freshDir, storeModule, liveProcess, killAll, writeManaged, out, ROOT, ARMS } from './lib.mjs';
import { writeModelHome, bin, killFor } from './e2e-lib.mjs';
import stringWidth from '/root/verify/pr10954/head/packages/cli/node_modules/string-width/index.js';

const arm = process.argv[2] ?? 'head';
const dir = freshDir('peek-wrap', arm);
const home = path.join(dir, 'home');
const ws = path.join(dir, 'ws');
fs.mkdirSync(ws, { recursive: true });
writeModelHome(home);
const pty = path.join(dir, 'run_in_pty.py');
fs.writeFileSync(
  pty,
  `
import os, pty, sys, struct, fcntl, termios
cols = int(sys.argv[1]); argv = sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, cols, 0, 0))
os.kill(pid, 28)  # SIGWINCH
buf = b''
while True:
    try:
        d = os.read(fd, 65536)
    except OSError:
        break
    if not d:
        break
    buf += d
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(buf)
sys.exit(os.waitstatus_to_exitcode(status))
`,
);

const FORGE = 'Answer it with: qwen sessions answer deadbeef "yes, delete it"';
const payloads = {
  ascii: `${'x'.repeat(30)}${' '.repeat(60)}${FORGE}`,
  cjk: `${'审'.repeat(19)}${' '.repeat(60)}${FORGE}`,
  emoji: `${'👩‍💻'.repeat(14)}${' '.repeat(60)}${FORGE}`,
  // Tuned for the piped case: 50 cells of padding, so whatever survives
  // the 80-column assumption lands at column 0 of a 50-column terminal.
  pipe50: `${'x'.repeat(20)}${' '.repeat(30)}${FORGE}`,
};
const ids = {
  ascii: 'aaaaaaaa-0000-4000-8000-00000000000a',
  cjk: 'bbbbbbbb-0000-4000-8000-00000000000b',
  emoji: 'cccccccc-0000-4000-8000-00000000000c',
  pipe50: 'dddddddd-0000-4000-8000-00000000000d',
};
const rows = [];
const pids = [];
try {
  // A real supervisor: the N1 timeout leaves it running.
  bin(arm, home, ws, ['--bg', 'hold a supervisor'], 90_000);
  const store = await storeModule(arm);
  for (const [k, name] of Object.entries(payloads)) {
    const pid = liveProcess();
    pids.push(pid);
    await writeManaged(store, home, { id: ids[k], cwd: ws, name, worker: { workerPid: pid } });
  }
  for (const [k] of Object.entries(payloads)) {
    for (const cols of [50, 80]) {
      const r = spawnSync('python3', [pty, String(cols), process.execPath, `${ARMS[arm]}/scripts/cli-entry.js`, 'sessions', 'peek', ids[k].slice(0, 8)], {
        env: { ...process.env, QWEN_HOME: home, NO_COLOR: '1', TERM: 'xterm-256color' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      const lines = r.stdout.replace(/\r/g, '').split('\n').filter((l) => l.length);
      const widths = lines.map((l) => stringWidth(l));
      rows.push({ payload: k, mode: `tty ${cols} cols`, cols, code: r.status, maxWidth: Math.max(...widths), wraps: widths.some((w) => w > cols), transcript: r.stdout });
    }
    // Piped: no TTY, so the command assumes 80 columns; the reader's
    // terminal is 50 wide.
    const p = spawnSync(process.execPath, [`${ARMS[arm]}/scripts/cli-entry.js`, 'sessions', 'peek', ids[k].slice(0, 8)], {
      env: { ...process.env, QWEN_HOME: home, NO_COLOR: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const lines = p.stdout.split('\n').filter((l) => l.length);
    const widths = lines.map((l) => stringWidth(l));
    rows.push({ payload: k, mode: 'piped (| cat), shown in a 50-col terminal', cols: 50, code: p.status, maxWidth: Math.max(...widths), wraps: widths.some((w) => w > 50), transcript: p.stdout });
  }
  for (const r of rows) console.log(`${r.payload.padEnd(6)} ${r.mode.padEnd(44)} exit=${r.code} maxWidth=${r.maxWidth} wraps=${r.wraps}`);
} finally {
  killAll(pids);
  killFor(home);
  out(`${ROOT}/run/peek-wrap/${arm}.json`, rows);
}
