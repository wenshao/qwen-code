// A/B: same CJK command through ShellExecutionService child_process path, with and without rawCapture.
import { ShellExecutionService } from '../packages/core/dist/src/services/shellExecutionService.js';
const cmd = process.argv[2] ?? 'i=0; while [ $i -lt 40 ]; do echo "第$i行：托管工作区输出预览需要保留尾部"; i=$((i+1)); done; exit 6';
async function run(label, withRaw, slow) {
  const chunks = [];
  const sink = {
    async write(stream, chunk) { chunks.push(chunk.length); if (slow) await new Promise((r) => setTimeout(r, 5)); },
    async finish() {}, setStarted() {}, setProcessResult() {},
  };
  const ac = new AbortController();
  const handle = await ShellExecutionService.execute(cmd, process.cwd(), () => {}, ac.signal, false,
    { maxBufferedOutputBytes: 64 * 1024 }, withRaw ? { rawCapture: sink } : {});
  const r = await handle.result;
  const firstLine = r.output.split('\n')[0];
  console.log(`${label}: exit=${r.exitCode} ok=${r.output.includes('托管工作区')} first=${JSON.stringify(firstLine.slice(0, 40))} rawChunks=${chunks.length}`);
}
await run('no rawCapture       ', false, false);
await run('rawCapture (fast)   ', true, false);
await run('rawCapture (5ms/ack)', true, true);
