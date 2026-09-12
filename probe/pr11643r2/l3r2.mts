// L3 round 2 — the real WebTerminalRegistry at the PR head, on the real
// bundled ConPTY backend. Unlike round 1 this counts what the SERVER writes
// back into the PTY (node-pty's spawn is wrapped before the registry loads, so
// every IPty.write is recorded), reads the snapshot's `handlesPrimaryDa`, and
// fires a live query batch from inside the console to see which families
// reach the registry and which one gets a server answer.
// usage: node l3r2.mjs <label> <shell>
import { createRequire } from 'node:module';
import { ourHosts, summarize, sleep } from '../pr11643/hosts.mjs';

const require = createRequire(import.meta.url);
const label = process.argv[2] ?? 'unknown';
const shell = process.argv[3] ?? 'cmd.exe';
process.env['COMSPEC'] = shell;
process.env['SHELL'] = shell;

type Rec = { t: number; data: string };
const writes: Rec[] = [];
const spawnCalls: Array<{ file: string; useConptyDll: unknown; threw?: string }> = [];
const pty = require('@lydell/node-pty');
const origSpawn = pty.spawn;
pty.spawn = (file: string, args: unknown, opts: { useConptyDll?: unknown }) => {
  const call: (typeof spawnCalls)[number] = { file, useConptyDll: opts?.useConptyDll };
  spawnCalls.push(call);
  try {
    const p = origSpawn(file, args, opts);
    const w = p.write.bind(p);
    p.write = (d: string) => {
      writes.push({ t: Date.now(), data: d });
      return w(d);
    };
    return p;
  } catch (e) {
    call.threw = String((e as Error)?.message ?? e).slice(0, 200);
    throw e;
  }
};

const { WebTerminalRegistry } = await import(
  '../../packages/core/src/services/web-terminal-registry.js'
);

const HARNESS_INPUT = new Set<string>();
const send = (registry: InstanceType<typeof WebTerminalRegistry>, id: string, s: string) => {
  HARNESS_INPUT.add(s);
  registry.write(id, s);
};
const serverReplies = (from = 0) =>
  writes.slice(from).filter((w) => !HARNESS_INPUT.has(w.data)).map((w) => JSON.stringify(w.data));

// eslint-disable-next-line no-control-regex
const CSI_QUERY = /\x1b\[[?>=]?[0-9;]*(?:c|n|\$p|q)/g;
// eslint-disable-next-line no-control-regex
const OSC_QUERY = /\x1b\][0-9]+;[0-9;]*\?/g;
const queries = (s: string) => [
  ...(s.match(CSI_QUERY) ?? []),
  ...(s.match(OSC_QUERY) ?? []),
].map((q) => JSON.stringify(q));

const registry = new WebTerminalRegistry();
const live: string[] = [];
const t0 = Date.now();
const res = await registry.create({ workspaceCwd: process.cwd() });
if ('error' in res) {
  console.log('PROBE_JSON ' + JSON.stringify({ label, shell, createError: res.error, spawnCalls }));
  process.exit(0);
}
const id = res.terminalId;
const snap0 = registry.readSnapshot(id);
let firstOutputMs: number | undefined;
let lastOutputAt = 0;
registry.addOutputListener(id, (chunk: string) => {
  firstOutputMs ??= Date.now() - t0;
  lastOutputAt = Date.now();
  live.push(chunk);
});
const deadline = Date.now() + 25000;
while (Date.now() < deadline && (lastOutputAt === 0 || Date.now() - lastOutputAt < 800)) {
  await sleep(50);
}
const promptMs = Date.now() - t0;
const hostsLive = summarize(ourHosts());
const startupReplies = serverReplies();
const startupScrollback = registry.readSnapshot(id)?.output ?? '';

// Live batch from a child process inside the console: DA1, DA2, CPR, DECRQM, OSC 11.
await sleep(1000);
const mark = writes.length;
const liveMark = live.length;
send(
  registry,
  id,
  `node -e "process.stdout.write('\\x1b[c\\x1b[>c\\x1b[6n\\x1b[?2026\\x24p\\x1b]11;?\\x07LIVEPROBE-DONE\\r\\n')"\r`,
);
const probeDeadline = Date.now() + 20000;
while (Date.now() < probeDeadline && !live.slice(liveMark).join('').includes('LIVEPROBE-DONE')) {
  await sleep(100);
}
await sleep(2000);
const liveProbeText = live.slice(liveMark).join('');
const liveProbeReplies = serverReplies(mark);

send(registry, id, 'echo probe-marker-11643\r');
const echoDeadline = Date.now() + 20000;
while (Date.now() < echoDeadline && !live.join('').includes('probe-marker-11643\r\n')) await sleep(100);

const snap = registry.readSnapshot(id);
const exited = new Promise<boolean>((resolve) => {
  registry.addExitListener(id, () => resolve(true));
  setTimeout(() => resolve(false), 20000);
});
send(registry, id, 'exit\r');
const exitedOk = await exited;
await sleep(4000);

console.log(
  'PROBE_JSON ' +
    JSON.stringify({
      label,
      shell,
      spawnCalls,
      handlesPrimaryDaAtCreate: snap0?.handlesPrimaryDa ?? null,
      handlesPrimaryDa: snap?.handlesPrimaryDa ?? null,
      firstOutputMs,
      promptMs,
      hostsLive,
      startupQueriesInScrollback: queries(startupScrollback),
      startupServerReplies: startupReplies,
      liveProbeReachedRegistry: queries(liveProbeText),
      liveProbeServerReplies: liveProbeReplies,
      echoRoundTripOk: live.join('').includes('probe-marker-11643'),
      scrollbackQueries: queries(snap?.output ?? ''),
      exitedOk,
      hostsAfterExit: summarize(ourHosts()),
      scrollbackHeadHex: Buffer.from((snap?.output ?? '').slice(0, 160)).toString('hex'),
    }),
);
process.exit(0);
