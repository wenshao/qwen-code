// Trace the stream events around an overlapping rawCapture.write().
import * as path from 'node:path';
import net from 'node:net';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const [repo, delayArg = '5', mibArg = '4'] = process.argv.slice(2);
const { ShellExecutionService } = await import(pathToFileURL(path.join(repo, 'packages/core/dist/src/services/shellExecutionService.js')).href);
const log = [];
const t0 = performance.now();
const ts = () => (performance.now() - t0).toFixed(2);
for (const name of ['pause', 'resume']) {
  const orig = net.Socket.prototype[name];
  net.Socket.prototype[name] = function (...args) {
    if (this.__traced) log.push(`${ts()} ${this.__traced}.${name}() flowing(before)=${this.readableFlowing} buffered=${this.readableLength}` + (name === "resume" ? " by " + new Error().stack.split("\n").slice(2, 6).map((l) => l.trim()).join(" <- ") : ""));
    return orig.apply(this, args);
  };
}
const origEmit = Readable.prototype.emit;
Readable.prototype.emit = function (ev, ...args) {
  if (this.__traced && (ev === 'data' || ev === 'end')) {
    const stack = new Error().stack.split('\n').slice(2, 7).map((l) => l.trim().replace(/\(.*node:internal\/(.*)\)/, '($1)')).join(' <- ');
    log.push(`${ts()} ${this.__traced} emit ${ev} ${ev === 'data' ? args[0].length : ''} flowing=${this.readableFlowing} via ${stack}`);
  }
  return origEmit.call(this, ev, ...args);
};
const origOn = net.Socket.prototype.on;
net.Socket.prototype.on = function (ev, fn) {
  if (ev === 'data' && !this.__traced && fn.name === 'stdoutHandler') this.__traced = 'stdout';
  return origOn.call(this, ev, fn);
};
const inflight = { stdout: 0, stderr: 0 };
let overlaps = 0;
let n = 0;
const sink = {
  async write(stream, chunk) {
    const id = ++n;
    inflight[stream]++;
    log.push(`${ts()}   write#${id} start ${stream} ${chunk.length} depth=${inflight[stream]}${inflight[stream] > 1 ? '   <<< OVERLAP' : ''}`);
    if (inflight[stream] > 1) overlaps++;
    await new Promise((r) => setTimeout(r, Number(delayArg)));
    inflight[stream]--;
    log.push(`${ts()}   write#${id} end`);
  },
  async finish() {}, setStarted() {}, setProcessResult() {},
};
const bytes = Number(mibArg) * 1024 * 1024;
const cmd = `${JSON.stringify(process.execPath)} -e "process.stdout.write(Buffer.alloc(${bytes}, 0x61))"`;
const handle = await ShellExecutionService.execute(cmd, process.cwd(), () => {}, new AbortController().signal, false, {}, { rawCapture: sink });
await handle.result;
const idx = log.findIndex((l) => l.includes('OVERLAP'));
console.log(`overlaps=${overlaps}`);
if (idx >= 0) console.log(log.slice(Math.max(0, idx - 12), idx + 4).join('\n'));
