// Minimal repro: does ShellExecutionService call rawCapture.write() for the same
// stream while a previous write() is still pending? node overlap.mjs <repo> [delayMs] [MiB]
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, delayArg = '5', mibArg = '4'] = process.argv.slice(2);
const { ShellExecutionService } = await import(pathToFileURL(path.join(repo, 'packages/core/dist/src/services/shellExecutionService.js')).href);
const inflight = { stdout: 0, stderr: 0 };
const maxInflight = { stdout: 0, stderr: 0 };
const events = [];
let received = 0;
const sink = {
  async write(stream, chunk) {
    inflight[stream]++;
    maxInflight[stream] = Math.max(maxInflight[stream], inflight[stream]);
    if (inflight[stream] > 1) events.push(`overlap ${stream} depth=${inflight[stream]} chunk=${chunk.length}`);
    received += chunk.length;
    await new Promise((r) => setTimeout(r, Number(delayArg)));
    inflight[stream]--;
  },
  async finish() {},
  setStarted() {},
  setProcessResult() {},
};
const bytes = Number(mibArg) * 1024 * 1024;
const cmd = `${JSON.stringify(process.execPath)} -e "process.stdout.write(Buffer.alloc(${bytes}, 0x61))"`;
const handle = await ShellExecutionService.execute(cmd, process.cwd(), () => {}, new AbortController().signal, false, {}, { rawCapture: sink });
const result = await handle.result;
console.log(JSON.stringify({ node: process.version, delayMs: Number(delayArg), wroteBytes: bytes, sinkReceived: received, maxInflight, overlaps: events.length, first: events.slice(0, 3), exitCode: result.exitCode }));
