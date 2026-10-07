// TS side of the differential: node ts-eval.mjs <dist-managed-runtime-dir> < cases.jsonl > verdicts
import { createInterface } from 'node:readline';
const dir = process.argv[2];
const { MANAGED_EXTENSION_RECORD_BODIES: B } = await import(`${dir}/managed-extension-projection.js`);
const { ManagedSessionRecordError } = await import(`${dir}/managed-session-records.js`);
const cls = (e) => (e instanceof ManagedSessionRecordError ? 'R' : `C(${e?.constructor?.name}:${String(e?.message).slice(0, 60)})`);
const bool = (f) => { try { return f() ? 'T' : 'F'; } catch (e) { return cls(e).replace(/^R$/, 'C(R)'); } };
const out = [];
for await (const line of createInterface({ input: process.stdin })) {
  if (!line) continue;
  const c = JSON.parse(line);
  const body = B[c.domain];
  let a, b;
  try { a = JSON.parse(c.a); b = c.b === undefined ? undefined : JSON.parse(c.b); }
  catch (e) { out.push(`${c.id}\tJSONERR`); continue; }
  if (c.op === 'one') {
    let p; try { body.parse(a); p = 'A'; } catch (e) { p = cls(e); }
    out.push(`${c.id}\tP=${p}\tS=${bool(() => body.isStart(a))}`);
  } else {
    out.push(`${c.id}\tX=${bool(() => body.isSuccessor(a, b))}`);
  }
}
for (const l of out) process.stdout.write(l + "\n");
