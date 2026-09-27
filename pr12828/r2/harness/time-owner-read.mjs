// Time the paired selector's owner read (the part that runs inside the
// initialize-timeout selection budget) on the large Legacy transcript.
import fs from 'node:fs';
import path from 'node:path';
const WT = process.env.WT;
const OUT = path.resolve(process.env.OUT);
const { createSessionExecutionEngineSelector } = await import(path.join(WT, 'packages/cli/dist/src/serve/session-execution-engine-selector.js'));
const QDIR = path.join(OUT, 'home/.qwen');
const WS = fs.realpathSync(path.join(OUT, 'ws/alpha'));
const chats = path.join(QDIR, 'projects', fs.readdirSync(path.join(QDIR, 'projects')).find((p) => p.includes('alpha')), 'chats');
const files = fs.readdirSync(chats).filter((f) => f.endsWith('.jsonl') && !f.includes('ledger')).map((f) => path.join(chats, f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
const big = files[0];
const sessionId = path.basename(big, '.jsonl');
const select = createSessionExecutionEngineSelector({ runtimeBaseDir: QDIR });
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  let r;
  try { r = await select({ operation: 'load', request: { workspaceCwd: WS, sessionId }, daemonOwnedStandalone: false }); } catch (e) { r = `throws ${e.message}`; }
  console.log(`${(fs.statSync(big).size / 1e6).toFixed(0)} MB owner read #${i + 1}: ${(performance.now() - t0).toFixed(0)} ms -> ${r}`);
}
