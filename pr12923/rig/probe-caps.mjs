// One transient 503 on GET /capabilities (no body cap anywhere): does the upload survive?
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SP, TOKEN, Daemon, prepareHome } from './lib.mjs';
import { startFaultProxy } from './faultproxy.mjs';
const LARGE = fs.readFileSync(path.join(SP, 'runs', 'large.png'));
const RUN = path.join(SP, 'runs', 'probe-caps');
fs.rmSync(RUN, { recursive: true, force: true });
const fake = spawn(process.execPath, [path.join(SP, 'rig/fake-model.mjs'), '18955', path.join(RUN, 'f.jsonl')], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => fake.stdout.once('data', r));
const out = [];
for (const arm of ['base', 'head']) {
  const root = path.join(RUN, arm);
  const ws = path.join(root, 'ws');
  const { home, qwenHome } = prepareHome({ root, ws, fakePort: 18955 });
  const d = await new Daemon({ wt: path.join(SP, `wt-${arm}`), home, qwenHome, ws, fakePort: 18955, logFile: path.join(root, 'daemon.log'), port0: 18937, extraEnv: { QWEN_RUNTIME_DIR: path.join(root, 'rt') } }).start();
  const proxy = await startFaultProxy({ port: 18942, target: d.port });
  const { DaemonClient } = await import(path.join(SP, `wt-${arm}/packages/sdk-typescript/dist/daemon/index.js`));
  for (const [label, fault] of [['503-once', { action: 'status', status: 503 }], ['html-200', { action: 'html200' }]]) {
    proxy.clear();
    proxy.addFault({ ...fault, match: (e) => e.path === '/capabilities' });
    const s = await d.createSession();
    const c = new DaemonClient({ baseUrl: 'http://127.0.0.1:18942', token: TOKEN });
    let r;
    try {
      const ref = await c.uploadSessionAttachment(s.sessionId, new Blob([LARGE]), 'image.png', 'image/png', { clientId: s.clientId });
      r = { ok: true, attachmentId: ref.attachmentId };
    } catch (e) { r = { ok: false, error: `${e.name}: ${e.message}`.slice(0, 160) }; }
    // A second upload on the same client right after (cache is only filled by a valid answer).
    let second;
    try { await c.uploadSessionAttachment(s.sessionId, new Blob([LARGE]), 'image2.png', 'image/png', { clientId: s.clientId }); second = 'ok'; } catch (e) { second = `${e.name}`; }
    out.push({ arm, fault: label, first: r, secondUploadSameClient: second, requests: proxy.ledger.map((e) => `${e.method} ${e.path.split('/').slice(-1)[0]} ${e.status}${e.fault ? ' [' + e.fault + ']' : ''}`) });
    console.log(JSON.stringify(out.at(-1)));
  }
  await proxy.close();
  await d.stop();
}
fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify(out, null, 2));
fake.kill();
process.exit(0);
