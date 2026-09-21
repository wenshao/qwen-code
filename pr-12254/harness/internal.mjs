// Internal Conversations workspace must be invisible to the batch.
import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Report, startDaemon, http, writeSession, freshDir, sid, sleep } from './lib.mjs';
const R = new Report('I. Internal Conversations workspace is invisible to the batch (real standalone session)');
const ROOT = freshDir('/root/verify/pr12254-harness/run-internal');
const HOME = path.join(ROOT, 'home'); const A = path.join(ROOT, 'ws-A');
mkdirSync(path.join(HOME, '.qwen'), { recursive: true }); mkdirSync(A, { recursive: true });
writeSession(HOME, A, sid('A', 1), { minute: 1, title: 'A-1' });
const d = await startDaemon('head', HOME, [A], { args: ['--initialize-timeout-ms', '60000'] });
try {
  const id = randomUUID();
  const mk = await http(d, 'POST', '/standalone/sessions', { sessionId: id });
  console.log('POST /standalone/sessions', mk.status, mk.text.slice(0, 300));
  await sleep(1500);
  const st = await http(d, 'GET', '/daemon/status?detail=full');
  const ws = (st.json?.workspaces ?? st.json?.runtimes ?? []);
  const flat = JSON.stringify(st.json);
  const internal = [...flat.matchAll(/"workspaceCwd":"([^"]+)"[^{}]*?"internal":true|"internal":true[^{}]*?"workspaceCwd":"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  console.log('status keys', Object.keys(st.json ?? {}), 'internal cwds:', internal);
  const list = await http(d, 'GET', '/standalone/sessions');
  console.log('GET /standalone/sessions', list.status, JSON.stringify(list.json).slice(0, 400));
  const all = await http(d, 'POST', '/sessions/catalog', { workspaces: 'all' });
  R.check('I1', `standalone session created (HTTP ${mk.status}); "all" still lists only the public workspace`, mk.status < 300 && all.json.workspaces.length === 1 && all.json.workspaces[0].cwd === A, all.json.workspaces.map((m) => path.basename(m.cwd)).join(','));
  R.check('I2', 'no batch row anywhere carries the standalone session id', !JSON.stringify(all.json).includes(id));
  for (const s of list.json?.sessions ?? []) if (s.workspaceCwd && !internal.includes(s.workspaceCwd)) internal.push(s.workspaceCwd);
  const legacy = await http(d, 'GET', `/workspaces/${encodeURIComponent(internal[0] ?? '/x')}/sessions`);
  console.log('legacy GET on the internal cwd →', legacy.status, (legacy.json?.sessions ?? []).length, 'rows');
  if (internal.length) {
    const sel = await http(d, 'POST', '/sessions/catalog', { workspaces: internal.map((w) => ({ workspace: w })) });
    R.check('I3', 'selecting the internal workspace cwd explicitly → 404 workspace_not_found (no empty success page; indistinguishable from an unknown workspace)', sel.json.workspaces.every((m) => m.error?.code === 'workspace_not_found' && m.sessions === undefined), internal.join(','));
  } else R.note('internal workspace cwd not discoverable from /daemon/status; I3 skipped');
} finally { await d.stop(); }
R.summary(); R.save('/root/verify/pr12254-harness/out/probes-internal');
