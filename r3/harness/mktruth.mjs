import fs from 'node:fs';
const recs = fs.readFileSync('long.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const text = (r) => (r.message?.parts ?? []).map((p) => p.text ?? '').join('');
const turns = {}; let cur;
for (const r of recs) {
  if (r.type === 'user' && r.message) { const m = /Question #(\d+)/.exec(text(r)); if (m) { cur = m[1]; turns[cur] = { user: r.uuid }; } }
  else if (r.type === 'assistant' && cur && text(r) && !turns[cur].assistant) turns[cur].assistant = r.uuid;
}
const msgs = recs.filter((r) => (r.type === 'user' || r.type === 'assistant') && r.message && text(r));
const expected = {};
for (const n of ['ZEBRA-QUARTZ-7731', 'common-token']) expected[n] = msgs.filter((r) => text(r).toLowerCase().includes(n.toLowerCase())).length;
fs.writeFileSync('truth.json', JSON.stringify({ file: 'long.jsonl', messages: msgs.length, expected, turns }, null, 1));
console.log({ messages: msgs.length, expected, t3: turns['3'], t200: turns['200'], n: Object.keys(turns).length });
