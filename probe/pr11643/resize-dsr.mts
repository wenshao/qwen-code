// Does the server-side query responder track the terminal size the client
// negotiated? A cursor-position report (DSR 6n) is only correct if the
// responder's grid is the same width as the PTY's.
import os from 'node:os';
if (process.argv[3] !== 'native')
  (os as { platform: () => NodeJS.Platform }).platform = () =>
    'win32' as NodeJS.Platform;
const { WebTerminalRegistry } = await import(
  '../../packages/core/src/services/web-terminal-registry.js'
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
process.env['SHELL'] = '/bin/bash';
const registry = new WebTerminalRegistry();
const live: string[] = [];
const res = await registry.create({ workspaceCwd: process.cwd() });
if ('error' in res) throw new Error(res.error);
const id = res.terminalId;
registry.addOutputListener(id, (c) => live.push(c));
await sleep(1200);
// What a browser tab does the moment it attaches: negotiate its real size.
const cols = Number(process.argv[4] ?? 120);
registry.resize(id, cols, 24);
await sleep(400);
live.length = 0;
// 100 printable chars, then ask where the cursor is. On a `cols`-wide grid the
// answer is column 101; on an 80-wide grid the line has wrapped.
registry.write(
  id,
  `stty -echo; printf 'A%.0s' $(seq 1 100); printf '\\033[6n'; IFS= read -r -s -t 3 -d 'R' p; stty echo; printf '\\nCOLS=%s REPORT=%s\\n' "$(tput cols)" "$(printf '%s' "$p" | tr -d '\\033[')"\r`,
);
await sleep(4000);
const text = live.join('');
const m = /COLS=(\d+) REPORT=([0-9;]*)/.exec(text);
console.log(
  'PROBE_JSON ' +
    JSON.stringify({
      label: process.argv[2],
      requestedCols: cols,
      shellSeesCols: m?.[1],
      dsrReport: m?.[2],
      expectedColumn: 101,
      raw: text.slice(-200),
    }),
);
process.exit(0);
