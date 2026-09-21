// Two ~10 MB annotated prompts in ONE session (paging stress).
import fs from 'node:fs';
import { BASE, TOKEN, WS, OUT, sleep } from './ui.mjs';
const arm = process.argv[2];
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const c = await (await fetch(BASE + '/session', { method: 'POST', headers: H, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) })).json();
const pad = 'x'.repeat(1000);
for (const tag of ['HUGE2A', 'HUGE2B']) {
  const text = `${tag} check @README.md`;
  const anns = [{ type: 'reference', start: tag.length + 7, end: tag.length + 17, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md', serialized: '@README.md' } }];
  for (let i = 0; i < 9300; i++) anns.push({ type: 'reference', start: 0, end: 1, text: 'B', reference: { id: 'junk' + i, kind: 'file', value: pad } });
  const r = await fetch(`${BASE}/session/${c.sessionId}/prompt`, { method: 'POST', headers: { ...H, 'X-Qwen-Client-Id': c.clientId }, body: JSON.stringify({ prompt: [{ type: 'text', text }], _meta: { inputAnnotations: anns } }) });
  console.log(`[${arm}] ${tag} prompt=${r.status}`);
  await sleep(6000);
}
fs.writeFileSync(`${OUT}/${arm}-s5-sids-huge2.json`, JSON.stringify({ cases: { HUGE2A: { sid: c.sessionId } } }));
