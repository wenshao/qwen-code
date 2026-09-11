// Emulated-win32 lane (POSIX host): flip os.platform() to 'win32' BEFORE the
// registry module is loaded, so the Windows-gated branches this PR adds — the
// bundled-backend spawn option, the headless query responder, and the
// scrollback strip — run against a real PTY and a real shell. Only the gate is
// platform-specific; the query logic itself is platform-independent JS.
// usage: npx tsx emu-win32.mts <label> [emulate|native]
import os from 'node:os';

const label = process.argv[2] ?? 'unknown';
const mode = process.argv[3] ?? 'emulate';
if (mode === 'emulate') {
  // node:os is a CJS builtin: the default export IS the live module object.
  (os as { platform: () => NodeJS.Platform }).platform = () =>
    'win32' as NodeJS.Platform;
}

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
// Wide enough that the echoed probe commands never wrap; wrapping splices a
// CR into the stream and would break the markers, not the behaviour.
registry.resize(id, 400, 24);
await sleep(1200);
live.length = 0; // drop the login banner; measure only the probe exchange

// Emit a Device Attributes query and a Device Status Report from inside the
// shell, then read whatever the terminal writes back on stdin.
registry.write(
  id,
  `printf '\\033[c'; IFS= read -r -s -t 3 -d 'c' da; printf 'DA:%s\\n' "$(printf '%s' "$da" | od -An -tx1 | tr -d ' \\n')"\r`,
);
await sleep(3500);
registry.write(
  id,
  `printf '\\033[6n'; IFS= read -r -s -t 3 -d 'R' dsr; printf 'DSR:%s\\n' "$(printf '%s' "$dsr" | od -An -tx1 | tr -d ' \\n')"\r`,
);
await sleep(3500);

const snapshot = registry.readSnapshot(id);
const scrollback = snapshot?.output ?? '';
const liveText = live.join('');
// eslint-disable-next-line no-control-regex
const QUERY = /\x1b\[[?0-9;>]*[cn]/g;
const daHex = /\nDA:([0-9a-f]*)/.exec(liveText)?.[1] ?? '';
const dsrHex = /\nDSR:([0-9a-f]*)/.exec(liveText)?.[1] ?? '';

// An OSC background-colour query — what a full-screen app (vim) emits. Neither
// final byte is `c`/`n`, so the strip does not cover it.
registry.write(id, `printf '\\033]11;?\\033\\\\'; sleep 1\r`);
await sleep(2500);

// Throughput cost of feeding every byte to the server-side responder as well.
const payloadStart = Date.now();
registry.write(id, `head -c 4000000 /dev/urandom | base64 | head -c 4000000\r`);
const bigDeadline = Date.now() + 60000;
let lastLen = 0;
let quietSince = Date.now();
while (Date.now() < bigDeadline) {
  await sleep(200);
  const len = live.join('').length;
  if (len !== lastLen) {
    lastLen = len;
    quietSince = Date.now();
  } else if (Date.now() - quietSince > 1500 && len > 1_000_000) break;
}
const payloadMs = Date.now() - payloadStart;

const report = {
  label,
  mode,
  emulatedPlatform: os.platform(),
  daReplyHex: daHex,
  daAnswered: daHex.length > 0,
  dsrReplyHex: dsrHex,
  dsrAnswered: dsrHex.length > 0,
  queriesLeftInScrollback: (scrollback.match(QUERY) ?? []).map((s) =>
    JSON.stringify(s),
  ),
  queriesLeftInLiveStream: (liveText.match(QUERY) ?? []).map((s) =>
    JSON.stringify(s),
  ),
  oscQueryLeftInScrollback: (
    (registry.readSnapshot(id)?.output ?? '').match(/\x1b\]11;\?/g) ?? []
  ).length,
  bulkBytesSeen: lastLen,
  bulkMs: payloadMs,
  rssMB: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
};
console.log('PROBE_JSON ' + JSON.stringify(report));
process.exit(0);
