// Timeline of Spring -> Harness calls for one Session from a tap log.
// usage: node tapsum.mjs <db> <sid> [sinceIso]
import { readFileSync } from 'node:fs';

const [, , db, sid, since = ''] = process.argv;
const lines = readFileSync(`/Users/wenshao/git/pr13598-rig/runs/${db}/tap.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const req = new Map();
for (const l of lines) if (l.dir === 'req') req.set(l.id, l);
for (const l of lines) {
  if (l.dir === 'req') continue;
  const q = req.get(l.id);
  if (!q || !q.url.includes(sid) || q.at < since) continue;
  if (/heartbeat|\/events/.test(q.url)) continue;
  const what = q.url.replace(/^\/session\/[0-9a-f-]+/, '');
  const auto = q.auto ? ` ${q.auto.kind} ${q.auto.occ ?? ''}` : '';
  let code = '';
  try { code = JSON.parse(l.body ?? '{}').code ?? ''; } catch {}
  console.log(`${q.at.slice(11, 19)} ${what}${auto} -> ${l.status ?? l.error}${code ? ' ' + code : ''} ${l.ms}ms${l.note ? ' [' + l.note + ']' : ''}${q.rule ? ' rule=' + q.rule : ''}`);
}
