import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startDaemon, http, writeSession, freshDir, sid, workspaceIdOf } from './lib.mjs';
for (const arm of ['base', 'head']) {
  const ROOT = freshDir(`/root/verify/pr12254-harness/run-legacyloss-${arm}`);
  const HOME = path.join(ROOT, 'home'); const A = path.join(ROOT, 'ws-A');
  mkdirSync(path.join(HOME, '.qwen'), { recursive: true }); mkdirSync(A, { recursive: true });
  for (let i = 1; i <= 3; i++) writeSession(HOME, A, sid('A', i), { minute: i, title: `A-${i}` });
  const d = await startDaemon(arm, HOME, [A], { args: ['--initialize-timeout-ms', '60000'] });
  try {
    for (let i = 0; i < 3; i++) await http(d, 'POST', '/session', { cwd: A, sessionId: randomUUID() });
    const seen = []; let cursor; let n = 0;
    do {
      const r = await http(d, 'GET', `/workspaces/${workspaceIdOf(A)}/sessions?size=2&view=organized&group=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...r.json.sessions.map((s) => s.sessionId)); cursor = r.json.nextCursor;
    } while (cursor && ++n < 20);
    console.log(`${arm}: legacy GET organized size=2 drain → ${seen.length} rows, ${new Set(seen).size} unique, of 6`);
  } finally { await d.stop(); }
}
