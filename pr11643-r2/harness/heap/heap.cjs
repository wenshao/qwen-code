// Independent check of S-3: retained heap of a real @xterm/headless 5.5.0 responder
// constructed exactly as the registry does, fed N bytes in 64 KB chunks.
const { Terminal } = require('/root/git/qwen-code-x7/node_modules/@xterm/headless');
const mode = process.argv[2]; // 'nolf' | 'lines'
const total = Number(process.argv[3]); const drain = process.argv[4] === 'drain';
const gc = () => { global.gc(); global.gc(); };
const mb = () => +(process.memoryUsage().heapUsed / 1048576).toFixed(2);
(async () => {
  gc(); const base = mb();
  const t = new Terminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 0, logLevel: 'off' });
  let replies = 0; t.onData(() => replies++);
  const CH = 64 * 1024; let fed = 0; let pending = 0; let cbs = 0;
  const line = 'x'.repeat(79) + '\r\n';
  while (fed < total) {
    let s = mode === 'nolf' ? 'x'.repeat(CH) : line.repeat(Math.ceil(CH / line.length)).slice(0, CH);
    pending++; t.write(s, () => { cbs++; pending--; }); fed += s.length;
  }
  gc(); const undrained = mb() - base;
  if (drain) { const t0 = Date.now(); while (pending > 0) await new Promise(r => setTimeout(r, 5)); gc();
    console.log(JSON.stringify({ mode, totalMB: total/1048576, undrainedMB: +undrained.toFixed(2), drainedMB: +(mb() - base).toFixed(2), drainMs: Date.now() - t0, cbs }));
  } else console.log(JSON.stringify({ mode, totalMB: total/1048576, undrainedMB: +undrained.toFixed(2) }));
  t.dispose(); gc(); console.log(JSON.stringify({ afterDisposeMB: +(mb() - base).toFixed(2) }));
})();
