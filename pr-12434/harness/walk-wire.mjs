// Walk a session's transcript backwards exactly as the PR's loader does and
// check the pages are contiguous and non-overlapping against the JSONL itself.
import fs from 'node:fs';
const [base, token, sessionId, jsonl] = process.argv.slice(2);
const h = { authorization: `Bearer ${token}` };
let cursor; const pages = [];
for (let i = 0; i < 40; i++) {
  const q = cursor ? `cursor=${encodeURIComponent(cursor)}&limit=250` : `direction=backward&limit=250`;
  const r = await fetch(`${base}/session/${sessionId}/transcript?${q}`, { headers: h });
  const b = await r.json();
  if (!r.ok) { console.log('HTTP', r.status, JSON.stringify(b).slice(0, 200)); break; }
  const ids = [...new Set(b.events.flatMap(e => { const m = e?.data?._meta ?? {}; return [...(m.qwenTranscript?.sourceRecordIds ?? []), ...(m['qwen.session.recordId'] ? [m['qwen.session.recordId']] : [])]; }))];
  pages.push({ i, status: r.status, events: b.events.length, hasMore: b.hasMore, cursor: !!b.nextCursor, ids, partial: b.partial });
  if (!b.hasMore || !b.nextCursor) break;
  cursor = b.nextCursor;
}
const all = fs.readFileSync(jsonl, 'utf8').trim().split('\n').map(JSON.parse);
const uuids = all.map(r => r.uuid);
const pos = new Map(uuids.map((u, i) => [u, i]));
let prevMin = Infinity; let overlaps = 0;
for (const p of pages) {
  const idx = p.ids.map(id => pos.get(id)).filter(x => x !== undefined);
  const min = Math.min(...idx), max = Math.max(...idx);
  if (max >= prevMin) overlaps++;
  console.log(`page ${p.i}: events=${p.events} recordIds=${p.ids.length} jsonl[${min}..${max}] hasMore=${p.hasMore} cursor=${p.cursor}${p.partial ? ' PARTIAL' : ''}`);
  prevMin = min;
}
const seen = new Set(pages.flatMap(p => p.ids));
const userIds = all.filter(r => r.type === 'user').map(r => r.uuid);
console.log(`pages=${pages.length} jsonlRecords=${all.length} userPrompts=${userIds.length} userPromptsSeen=${userIds.filter(u => seen.has(u)).length} overlappingPages=${overlaps}`);
