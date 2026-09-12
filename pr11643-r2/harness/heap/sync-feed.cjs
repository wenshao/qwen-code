// Replays the sandbox H3 'buffer' mechanics on the real @xterm/headless 5.5.0
// responder: slices of one big string are written synchronously in a loop and
// heap is read (a) immediately, as the sandbox did, and (b) after the event
// loop has been allowed to drain the responder's write queue.
const { Terminal } = require('/root/git/qwen-code-x7/node_modules/@xterm/headless');
const gc = () => { global.gc(); global.gc(); };
const mb = () => process.memoryUsage().heapUsed / 1048576;
(async () => {
  const t = new Terminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 0, logLevel: 'off' });
  gc(); const base = mb(); let fedTotal = 0; const rows = [];
  for (const kb of [2, 20, 128, 512, 2048, 5120]) {
    const chunk = 'x'.repeat(kb * 1024);
    gc(); const h0 = mb();
    for (let i = 0; i < chunk.length; i += 65536) t.write(chunk.slice(i, i + 65536));
    fedTotal += chunk.length;
    gc(); rows.push({ kb, retainedImmediateMB: +(mb() - h0).toFixed(2) });
  }
  gc(); const immediate = +(mb() - base).toFixed(2);
  let drained = false; t.write('', () => { drained = true; });
  const t0 = Date.now(); while (!drained) await new Promise((r) => setTimeout(r, 10));
  gc(); const after = +(mb() - base).toFixed(2);
  console.log(JSON.stringify({ fedMB: +(fedTotal / 1048576).toFixed(2), rows, totalImmediateMB: immediate, totalAfterDrainMB: after, drainMs: Date.now() - t0 }));
})();
