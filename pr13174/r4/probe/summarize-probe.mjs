// VERIFICATION RIG ONLY: print compact per-stage summary of a probe log.
import { readFileSync } from 'node:fs';
const t = readFileSync(process.argv[2], 'utf8');
const objs = [];
let i = 0;
while ((i = t.indexOf('{\n  "probe"', i)) >= 0) {
  let d = 0, j = i;
  for (; j < t.length; j++) { if (t[j] === '{') d++; if (t[j] === '}') { d--; if (!d) break; } }
  try { objs.push(JSON.parse(t.slice(i, j + 1))); } catch {}
  i = j;
}
for (const line of t.split('\n')) if (line.startsWith('{"probe"')) { try { objs.push(JSON.parse(line)); } catch {} }
for (const o of objs) {
  const turns = Array.isArray(o.turns) ? o.turns : typeof o.turns === 'string' ? o.turns.split('\n') : [];
  const last = turns.length ? turns[turns.length - 1].split('\t') : [];
  const fields = { terminal: o.terminal, ms: o.elapsedMs, lastTurn: last.slice(1, 3).join('/'), text: o.text, status: o.status ?? o.closeStatus ?? o.createStatus, sessionStatus: o.sessionStatus, op: o.operation && (o.operation.status ?? o.operation.waitError), d4ModelRequests: o.d4ModelRequests, ctx: o.laterTurnContextHasD4, mr: o.modelRoundRequests, later: o.laterRequests, body: o.body && String(o.body).slice(0, 120) };
  for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === '') delete fields[k];
  console.log(`  ${o.probe}: ${JSON.stringify(fields)}`);
}
