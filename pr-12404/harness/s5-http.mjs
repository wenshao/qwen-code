// s5-http.mjs <arm> — raw HTTP prompts with malformed / oversized inputAnnotations, then open in the browser.
import fs from 'node:fs';
import { launch, BASE, TOKEN, WS, OUT, sleep, save } from './ui.mjs';
const arm = process.argv[2];
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const j = async (method, path, body, extra = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...H, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t.slice(0, 300); }
  return { status: r.status, d };
};
const valid = (text, s) => ({ type: 'reference', start: s, end: s + '@README.md'.length, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md', serialized: '@README.md' } });
const out = { arm, cases: {} };
const CASES = {
  NULLCASE: () => { const text = 'NULLCASE check @README.md'; return { text, anns: [null, valid(text, 15)] }; },
  BIGCASE: () => {
    const text = 'BIGCASE check @README.md';
    const pad = 'x'.repeat(1000);
    const anns = [valid(text, 14)];
    for (let i = 0; i < 4500; i++) anns.push({ type: 'reference', start: 0, end: 1, text: 'B', reference: { id: 'junk' + i, kind: 'file', value: pad } });
    return { text, anns };
  },
};
if (process.env.ONLY === 'HUGE') {
  for (const k of Object.keys(CASES)) delete CASES[k];
  const mkHuge = (tag) => () => {
    const text = `${tag} check @README.md`;
    const anns = [valid(text, tag.length + 7)];
    const pad = 'x'.repeat(1000);
    for (let i = 0; i < 9300; i++) anns.push({ type: 'reference', start: 0, end: 1, text: 'B', reference: { id: 'junk' + i, kind: 'file', value: pad } });
    return { text, anns };
  };
  CASES.HUGECASE = mkHuge('HUGECASE');
}
const reuse = {};
for (const [name, mk] of Object.entries(CASES)) {
  const created = await j('POST', '/session', { cwd: WS, sessionScope: 'thread' });
  const sid = created.d?.sessionId ?? created.d?.id;
  const { text, anns } = mk();
  const body = { prompt: [{ type: 'text', text }], _meta: { 'qwen.submittedPrompt': text, inputAnnotations: anns } };
  const bytes = JSON.stringify(body).length;
  const p = await j('POST', `/session/${sid}/prompt`, body, { 'X-Qwen-Client-Id': created.d.clientId });
  console.log(`[${arm}] ${name}: create=${created.status} sid=${sid} prompt=${p.status} bodyBytes=${bytes}`, typeof p.d === 'string' ? p.d : JSON.stringify(p.d).slice(0, 200));
  out.cases[name] = { sid, create: created.status, prompt: p.status, bodyBytes: bytes };
  await sleep(4000);
}
fs.writeFileSync(`${OUT}/${arm}-s5-sids.json`, JSON.stringify(out, null, 1));
save(`${arm}-s5-http.json`, out);
