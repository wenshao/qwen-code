// r2-title.mjs <arm> — one annotated prompt over raw HTTP (Web Shell's _meta shape), then read the title side-query the daemon sent.
import fs from 'node:fs';
import { BASE, TOKEN, WS, OUT, sleep, save } from './ui.mjs';
const arm = process.argv[2];
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const LOG = '/root/verify/pr12404-r2-e2e/out/mock-requests.jsonl';
const startLines = fs.readFileSync(LOG, 'utf8').split('\n').length;
const c = await (await fetch(BASE + '/session', { method: 'POST', headers: H, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) })).json();
const text = 'TITLECASE summarize @README.md';
const ann = { type: 'reference', start: 20, end: 30, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md', metadata: { fileKind: 'file' }, serialized: '@README.md' } };
const withAnn = process.argv[3] !== 'plain';
const r = await fetch(`${BASE}/session/${c.sessionId}/prompt`, { method: 'POST', headers: { ...H, 'X-Qwen-Client-Id': c.clientId }, body: JSON.stringify({ prompt: [{ type: 'text', text }], _meta: { 'qwen.submittedPrompt': text, ...(withAnn ? { inputAnnotations: [ann] } : {}) } }) });
await sleep(12000);
const lines = fs.readFileSync(LOG, 'utf8').split('\n').slice(startLines - 1).filter(Boolean).map((l) => JSON.parse(l));
const titleReq = lines.find((o) => JSON.stringify(o.messages).includes('Conversation so far'));
let conv = null;
if (titleReq) { for (const m of titleReq.messages) { const s = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); const i = s.indexOf('Conversation so far'); if (i >= 0) { conv = s.slice(i, s.indexOf('\n\n', i + 25) > 0 ? s.indexOf('\n\n', i + 25) : i + 600); break; } } }
const res = { arm, withAnn, prompt: r.status, sid: c.sessionId, titleRequest: !!titleReq, conversationText: conv, includesFileContent: conv ? conv.includes('tag reload test fixture') : null, includesAssistantReply: conv ? conv.includes('mock reply') : null };
console.log(JSON.stringify(res, null, 1));
save(`${arm}-title-${withAnn ? 'ann' : 'plain'}.json`, res);
