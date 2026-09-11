// L3 — bundled-backend terminal queries under a probing shell: first-output
// latency, what lands in the replayable scrollback, and whether the shell is
// still usable afterwards.
// usage: npx tsx l3-queries.mts <label> [shell]
import { WebTerminalRegistry } from '../../packages/core/src/services/web-terminal-registry.js';
import { sleep } from './hosts.mjs';

const label = process.argv[2] ?? 'unknown';
const shell = process.argv[3] ?? 'powershell.exe';
process.env['COMSPEC'] = shell;
process.env['SHELL'] = shell;

const registry = new WebTerminalRegistry();
const live: string[] = [];
const t0 = Date.now();
const res = await registry.create({ workspaceCwd: process.cwd() });
if ('error' in res) throw new Error(`create failed: ${res.error}`);
const id = res.terminalId;
let firstOutputMs: number | undefined;
let lastOutputAt = 0;
registry.addOutputListener(id, (chunk) => {
  firstOutputMs ??= Date.now() - t0;
  lastOutputAt = Date.now();
  live.push(chunk);
});
// Shell-agnostic "prompt is up": first output, then 800ms of quiet.
const deadline = Date.now() + 25000;
while (
  Date.now() < deadline &&
  (lastOutputAt === 0 || Date.now() - lastOutputAt < 800)
) {
  await sleep(50);
}
const promptMs = Date.now() - t0;
await sleep(1500);
registry.write(id, 'echo probe-marker-11643\r');
const echoDeadline = Date.now() + 20000;
while (Date.now() < echoDeadline && !live.join('').includes('probe-marker-11643\r\n'))
  await sleep(100);
await sleep(1500);

const snapshot = registry.readSnapshot(id);
const scrollback = snapshot?.output ?? '';
const liveText = live.join('');
// eslint-disable-next-line no-control-regex
const QUERY = /\x1b\[[?0-9;>]*[cn]/g;
// eslint-disable-next-line no-control-regex
const OSC_QUERY = /\x1b\][0-9]+;\?/g;
const report = {
  label,
  shell,
  firstOutputMs,
  promptMs,
  echoRoundTripOk: liveText.includes('probe-marker-11643'),
  scrollbackBytes: Buffer.byteLength(scrollback),
  queriesInScrollback: (scrollback.match(QUERY) ?? []).map((s) =>
    JSON.stringify(s),
  ),
  queriesInLiveStream: (liveText.match(QUERY) ?? []).map((s) =>
    JSON.stringify(s),
  ),
  oscQueriesInScrollback: (scrollback.match(OSC_QUERY) ?? []).map((s) =>
    JSON.stringify(s),
  ),
  scrollbackHeadHex: Buffer.from(scrollback.slice(0, 220)).toString('hex'),
  scrollbackTail: JSON.stringify(scrollback.slice(-400)),
};
console.log('PROBE_JSON ' + JSON.stringify(report));
process.exit(0);
