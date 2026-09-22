// r2-title-multi.mjs <arm> — turn 1 annotated, turn 2 plain; collect every title side-query the daemon sent for the session.
import fs from 'node:fs';
import { BASE, TOKEN, WS, sleep, save } from './ui.mjs';
const arm = process.argv[2];
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const LOG = '/root/verify/pr12404-r2-e2e/out/mock-requests.jsonl';
const startLines = fs.readFileSync(LOG, 'utf8').split('\n').length;
const c = await (await fetch(BASE + '/session', { method: 'POST', headers: H, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) })).json();
const post = (text, anns) => fetch(`${BASE}/session/${c.sessionId}/prompt`, { method: 'POST', headers: { ...H, 'X-Qwen-Client-Id': c.clientId }, body: JSON.stringify({ prompt: [{ type: 'text', text }], _meta: { 'qwen.submittedPrompt': text, ...(anns ? { inputAnnotations: anns } : {}) } }) });
const t1 = 'MULTI turn one about @README.md';
await post(t1, [{ type: 'reference', start: 21, end: 31, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md', metadata: { fileKind: 'file' }, serialized: '@README.md' } }]);
await sleep(10000);
await post('MULTI turn two is a plain follow-up question', null);
await sleep(10000);
const lines = fs.readFileSync(LOG, 'utf8').split('\n').slice(startLines - 1).filter(Boolean).map((l) => JSON.parse(l));
const convs = lines.filter((o) => JSON.stringify(o.messages).includes('Conversation so far')).map((o) => {
  for (const m of o.messages) { const s = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); const i = s.indexOf('Conversation so far'); if (i >= 0) return s.slice(i + 21, s.indexOf('Generate the session title', i)).trim(); }
});
console.log(`[${arm}] title side-queries: ${convs.length}`); convs.forEach((cv, i) => console.log(`  #${i + 1}: ${JSON.stringify(cv)}`));
save(`${arm}-title-multi.json`, { sid: c.sessionId, convs });
