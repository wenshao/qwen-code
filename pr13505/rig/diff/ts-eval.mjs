// VERIFICATION RIG ONLY (PR #13505): TypeScript side of the differential — the authority's own
// reader (parseManagedSessionRecordJson) + the record-body registry (parse / taskKindOf / isStart /
// isSuccessor), exactly the calls LocalManagedSessionAuthority makes.
// usage: node ts-eval.mjs <coreDistSrc> <in.jsonl> <out.jsonl>
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
const [CORE, IN, OUT] = process.argv.slice(2);
const { MANAGED_EXTENSION_RECORD_BODIES } = await import(`${CORE}/managed-runtime/managed-extension-projection.js`);
const { parseManagedSessionRecordJson, MANAGED_SESSION_LIMITS } = await import(`${CORE}/managed-runtime/managed-session-records.js`);
const out = createWriteStream(OUT);
function read(text) {
  try { return { ok: true, v: parseManagedSessionRecordJson(text, MANAGED_SESSION_LIMITS.maxEventBytes) }; }
  catch (e) { return { ok: false }; }
}
function one(body, text) {
  const r = read(text);
  if (!r.ok) return { read: false };
  if (!body) return { read: true, ok: false, err: 'no body registered' };
  try {
    const p = body.parse(r.v);
    let startParsed;
    try { startParsed = body.isStart(p.record); } catch (e) { startParsed = 'THROW:' + e.constructor.name; }
    return { read: true, ok: true, rid: p.recordId, task: body.taskKindOf(p.record), start: body.isStart(r.v), startParsed };
  } catch (e) {
    return { read: true, ok: false, err: String(e.message), cls: e.constructor.name };
  }
}
let n = 0;
for await (const line of createInterface({ input: createReadStream(IN) })) {
  const row = JSON.parse(line);
  const body = MANAGED_EXTENSION_RECORD_BODIES[row.domain];
  let res;
  if (row.op === 'one') res = one(body, row.a);
  else {
    const a = read(row.a), b = read(row.b);
    if (!a.ok || !b.ok) res = { read: false };
    else {
      let succ, succParsed = null;
      try { succ = body.isSuccessor(a.v, b.v); } catch (e) { succ = 'THROW:' + e.constructor.name + ':' + e.message; }
      try { succParsed = body.isSuccessor(body.parse(a.v).record, body.parse(b.v).record); } catch (e) { succParsed = 'n/a'; }
      res = { read: true, succ, succParsed };
    }
  }
  out.write(JSON.stringify({ id: row.id, ...res }) + '\n');
  n++;
}
out.end();
console.error(`ts-eval ${n} rows`);
