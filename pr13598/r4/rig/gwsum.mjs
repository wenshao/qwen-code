// usage: node gwsum.mjs [filterRegex]  — one line per model request in runs/model-requests-r4.jsonl
import { readFileSync } from 'node:fs';
const re = process.argv[2] ? new RegExp(process.argv[2]) : null;
const L = readFileSync('/Users/wenshao/git/pr13598-rig/runs/model-requests-r4.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const end = new Map(L.filter((r) => r.phase !== 'request').map((r) => [r.id, r]));
for (const r of L) {
  if (r.phase !== 'request') continue;
  const users = r.shape.filter((s) => s.r === 'user');
  const last = users[users.length - 1] ?? {};
  const all = r.shape.flatMap((s) => s.mk ?? []);
  const line = `${r.id} ${r.at.slice(11, 19)} last=${JSON.stringify(last.mk)} lastOcc=${JSON.stringify(last.occ)} allMk=${JSON.stringify(all)} roles=${r.shape.map((s) => s.r[0] + (s.tc.length ? `(${s.tc.join(',')})` : '') + (s.tcid ? `<${s.tcid}>` : '')).join(' ')} end=${end.get(r.id)?.phase ?? '?'}/${end.get(r.id)?.status ?? ''}/${end.get(r.id)?.ms ?? ''}`;
  if (!re || re.test(line)) console.log(line);
}
