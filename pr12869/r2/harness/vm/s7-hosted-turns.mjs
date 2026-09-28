// Full chain: packaged Hosted Harness + scripted model + real Spring/MySQL/worker.
// Turn 1 runs normally. Turn 2's acquire is delivered when the scheduled scan observes the (healthy) binding.
import * as d from './drive.mjs';
import * as H from './hosted-lib.mjs';
import { startFakeOpenAIServer, fakeToolCall } from './fake-openai-server.mjs';
import fs from 'node:fs';
const [tag = 'pr', storage = 'b', align = 'align'] = process.argv.slice(2);
const say = (...a) => console.log(d.now(), `[${tag}]`, ...a);
fs.mkdirSync(H.RUN, { recursive: true });
const ws = `ws-${storage}`;
try { d.seed(ws, `st-${storage}`); } catch { /* seeded */ }
const sid = await d.createSession(ws);
say(`Workspace Session ${sid} on ${ws}; server trusted-local-reboot-recovery=${fs.readFileSync('/etc/qwen-w0e3.env', 'utf8').match(/TRUSTED=(\w+)/)[1]} jar=${fs.readFileSync('/etc/qwen-w0e3.env', 'utf8').match(/JAR=(\S+)/)[1]}`);

let n = 0;
const model = await startFakeOpenAIServer(({ body }) => {
  const messages = body.messages;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (!receipts.length) { n++; return { content: 'Writing the note.', toolCalls: [fakeToolCall('write_file', { file_path: `note-${n}.txt`, content: `turn ${n}` }, `write-${n}`)] }; }
  return { content: `DONE after ${receipts.length} tool result(s)` };
});
const proxy = await H.startBrokerProxy('http://127.0.0.1:4182');
const h = await new H.Harness({ name: tag, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start();
const s = new H.HSession(h, sid, ws);
say('harness session create ->', (await s.create()).status);
const ledger = (t0) => proxy.ledger.filter((e) => e.received >= t0).map((e) => `${e.method} ${e.url} -> ${e.status}${e.code ? ` ${e.code}` : ''}${e.forwarded - e.received > 20 ? ` (delivered after ${e.forwarded - e.received} ms)` : ''}`);
const bindingRow = () => d.sql(`SELECT binding_id, binding_state, runtime_generation, UNIX_TIMESTAMP(last_reconciled_at)*1000 FROM qwen_runtime_binding WHERE isolation_key='${sid}' ORDER BY runtime_generation DESC LIMIT 1`)[0];

let t0 = Date.now();
let r = await s.prompt('Write the first note.');
say('turn 1:', H.summarize(r)); for (const t of H.toolTrace(r.events)) say('   ', t);
say('   broker requests:', JSON.stringify(ledger(t0)));

if (align === 'align') {
  // One persistent SQL client, so the rig can see the scan's operation claim within a few milliseconds.
  const { spawn } = await import('node:child_process');
  const client = spawn('docker', ['exec', '-i', 'w0e3-db', 'mysql', '-uroot', '-prootpw', '-N', '-B', '--unbuffered', d.DB], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = ''; const waiters = [];
  client.stdout.on('data', (chunk) => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { waiters.shift()?.(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } });
  const ask = (q) => new Promise((resolve) => { waiters.push(resolve); client.stdin.write(q + ';\n'); });
  const bid = bindingRow()[0];
  await ask('SELECT 1');
  proxy.state.hook = async (entry) => {
    if (!entry.url.endsWith('/tool-sessions:acquire')) return;
    proxy.state.hook = null;
    const waited = Date.now();
    // Deliver the (unchanged) request when the scheduled scan holds its claim on this healthy binding.
    for (;;) { if ((await ask(`SELECT IFNULL(operation_owner,'-') FROM qwen_runtime_binding WHERE binding_id='${bid}'`)) !== '-') break; }
    entry.note = `delivered when the scheduled scan claimed the binding (waited ${Date.now() - waited} ms for the next scan)`;
    client.stdin.end();
  };
}
t0 = Date.now();
r = await s.prompt('Write the second note.');
say('turn 2:', H.summarize(r)); for (const t of H.toolTrace(r.events)) say('   ', t);
say('   broker requests:', JSON.stringify(ledger(t0)));
const held = proxy.ledger.find((e) => e.note); if (held) say('   proxy:', held.note, `-> ${held.status} ${held.code ?? ''} ${held.message ?? ''}`);
t0 = Date.now();
r = await s.prompt('Write the third note.');
say('turn 3:', H.summarize(r)); for (const t of H.toolTrace(r.events)) say('   ', t);
say('   broker requests:', JSON.stringify(ledger(t0)));
const b = bindingRow();
say(`Broker side: binding ${b[0].slice(0, 8)} state=${b[1]} generation=${b[2]}; holder rows for it: ${d.sql(`SELECT COUNT(*) FROM managed_workspace_execution_lease WHERE binding_id='${b[0]}'`)[0][0]}; worker alive: ${d.workers().includes('managed-runtime-worker')}`);
say('Workspace files:', fs.readdirSync(`/srv/ws/${storage}/project`).filter((f) => f.startsWith('note-')).join(' ') || '(none)');
say('harness status:', JSON.stringify(await s.status()));
await h.stop(); await proxy.close(); await model.close();
