// Batch evaluator: JSONL in, JSONL out. Each input line is {k, v}; the
// output line carries the TS module's verdict and, where a schema
// definition exists, the Ajv (strict, draft 2020-12) verdict.
import fs from 'node:fs';
import readline from 'node:readline';
import { M, schemaAccepts } from './ajv.mjs';

const { ManagedSessionRecordError } = await import(
  process.env.CORE + '/dist/src/managed-runtime/managed-session-records.js'
);
const accepts = (fn) => {
  try {
    fn();
    return true;
  } catch (e) {
    if (e instanceof ManagedSessionRecordError) return false;
    return 'THREW ' + e.constructor.name + ': ' + e.message;
  }
};
const toBytes = (b) =>
  b && typeof b === 'object' && '__b64' in b
    ? Buffer.from(b.__b64, 'base64')
    : b && typeof b === 'object' && '__str' in b
      ? b.__str
      : b;
const out = fs.createWriteStream(process.argv[2]);
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[3]), crlfDelay: Infinity });
for await (const line of rl) {
  const { k, v } = JSON.parse(line);
  let r;
  switch (k) {
    case 'manifest':
      r = { m: accepts(() => M.parseToolResultManifest(v)), s: schemaAccepts('manifest', v) };
      break;
    case 'page':
      r = { m: accepts(() => M.parseToolResultPage(v)), s: schemaAccepts('page', v) };
      break;
    case 'envelope':
      r = { m: accepts(() => M.parseToolResultEnvelope(v)), s: schemaAccepts('result', v) };
      break;
    case 'revision':
      r = { m: M.isToolResultManifestSuccessor(v.a, v.b) };
      break;
    case 'pageRevision':
      r = { m: M.isToolResultPageSuccessor(v.a, v.b) };
      break;
    case 'pageAt':
      r = { m: M.isToolResultPageAt(v.m, v.si, v.pi, v.p) };
      break;
    case 'envelopeOf':
      r = { m: M.isToolResultEnvelopeOf(v.r, v.m) };
      break;
    case 'ledger': {
      const L = new M.ToolResultSegmentLedger();
      r = {
        m: v.map((st) => {
          const q = st.op === 'publish' && st.q && typeof st.q === 'object' ? { ...st.q, bytes: toBytes(st.q.bytes) } : st.q;
          try {
            return L[st.op](q);
          } catch (e) {
            return 'THREW ' + e.message;
          }
        }),
      };
      break;
    }
  }
  out.write(JSON.stringify(r) + '\n');
}
out.end();
