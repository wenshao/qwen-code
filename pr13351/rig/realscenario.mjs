// VERIFICATION RIG ONLY (PR #13351): real qwen3.8-max answer cut after its first published chunk.
// usage: ARM=head|base node realscenario.mjs <tag>
import fs from 'node:fs';
import { ARM, RIG, RUN, PORTS, createSession, api, allEvents, eventText, turnRows, ensureWorkspace, sleep, j } from './lib.mjs';
ensureWorkspace('ws-c', 'st-c');
const tag = process.argv[2] ?? 'r';
const id = `${ARM}-real-${tag}-${Date.now().toString(36)}`;
const prompt = `REALCUT id=${id}. Write the English words for the integers one through thirty, in order, separated by ", " on a single line. Output nothing else: no tools, no preamble.`;
const proxy = `http://127.0.0.1:${PORTS.model + 10}`;
const c = await createSession(prompt, { workspace: 'ws-c' });
if (c.status !== 202) throw new Error(`create ${c.status} ${j(c.json)}`);
const session = c.session;
let after = 0, terminal, released = false;
const live = [];
const t0 = Date.now();
while (!terminal && Date.now() - t0 < 240_000) {
  const r = await api('GET', `/v1/agents/sessions/${session}/events?after=${after}&limit=100`);
  for (const e of r.json.data ?? []) { live.push({ ...e, ms: Date.now() - t0 }); after = Math.max(after, e.sequence); if (e.terminal) terminal = e; }
  if (!released && live.some((e) => e.type === 'item.output_text.delta' && eventText(e))) {
    for (let i = 0; i < 100 && !released; i++) { released = (await (await fetch(`${proxy}/__rig/release?id=${id}`, { method: 'POST' })).json()).released; if (!released) await sleep(50); }
    live.push({ type: '__rig.cut_released', released, ms: Date.now() - t0 });
  }
  await sleep(100);
}
await sleep(1500);
const final = await allEvents(session);
const visible = final.filter((e) => e.type === 'item.output_text.delta').map(eventText).join('');
const liveText = live.filter((e) => e.type === 'item.output_text.delta').map(eventText).join('');
const items = await api('GET', `/v1/agents/sessions/${session}/items?limit=20`);
const committed = (items.json.data ?? []).filter((i) => i.role === 'assistant').map((i) => i.content.map((p) => p.text).join('')).join(' | ');
const proxyLog = fs.readFileSync(`${RUN}/realcut.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.id === id);
const words = visible.toLowerCase().match(/[a-z-]+/g) ?? [];
const count = (w) => words.filter((x) => x === w).length;
const res = { arm: ARM, id, session, terminal: terminal?.type, visible, liveText, committed, reconciled: final.filter((e) => e.type === 'stream.reconciled').length,
  dupOne: count('one'), dupTwo: count('two'), thirtyCount: count('thirty'), proxy: proxyLog, turns: turnRows(session), live };
fs.writeFileSync(`${RIG}/results/${id}.json`, JSON.stringify(res, null, 2));
console.log(`REALRESULT arm=${ARM} terminal=${res.terminal} reconciled=${res.reconciled} one=${res.dupOne} two=${res.dupTwo} thirty=${res.thirtyCount} cutAfter=${j(proxyLog.find((e) => e.cut)?.forwardedBeforeCut)} attempts=${proxyLog.map((e) => `a${e.attempt}:${e.bodySha.slice(0, 8)}${e.resumeInstruction ? '+resume' : ''}`).join(',')}\n  visible=${j(visible)}\n  committed=${j(committed)}`);
