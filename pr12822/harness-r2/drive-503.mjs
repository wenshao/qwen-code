// Create with input while the Hosted Harness is disabled (declared 503).
import fs from 'node:fs';
const [base, out] = process.argv.slice(2);
const T = `rig-503-${Date.now().toString(36)}`;
async function call(op, expected, method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { 'X-Qwen-Tenant-Id': T, accept: 'application/json', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  fs.appendFileSync(out, JSON.stringify({ kind: 'exchange', tenant: T, op, expected, method, path, note: 'harness disabled', request: body, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: json, raw: json ? undefined : text.slice(0, 300) }) + '\n');
  console.log(`${op.padEnd(22)} ${res.status} (spec ${expected}) ${json?.error?.code ?? ''} request_id=${json?.error?.request_id ?? '-'}`);
}
await call('createSession', 503, 'POST', '/v1/agents/sessions', { agent_id: 'qwen-code', input: [{ type: 'input_text', text: 'x' }] }, { 'Idempotency-Key': 'k-503' });
await call('webShellCreateSession', 503, 'POST', '/api/agent/web-shell/v1/sessions/create', { idempotencyKey: 'w-503', agentId: 'qwen-code', input: [{ type: 'input_text', text: 'x' }] });
