// TS side: the PR's built validators from packages/core/dist.
import fs from 'node:fs';
import readline from 'node:readline';
const WT = process.env.WT;
const { MANAGED_EXTENSION_RECORD_BODIES: B } = await import(`${WT}/packages/core/dist/src/managed-runtime/managed-extension-projection.js`);
const { ManagedSessionRecordError } = await import(`${WT}/packages/core/dist/src/managed-runtime/managed-session-records.js`);
const body = B.child_run;
const out = fs.createWriteStream(process.env.OUT);
const rl = readline.createInterface({ input: fs.createReadStream(process.env.IN), crlfDelay: Infinity });
const verdict = (f) => { try { f(); return 'ok'; } catch (e) { return e instanceof ManagedSessionRecordError ? 'invalid' : `crash:${e?.constructor?.name}`; } };
for await (const line of rl) {
  const c = JSON.parse(line);
  if (c.type === 'record') out.write(`${c.id}\t${verdict(() => body.parse(c.body))}\t${body.isStart(c.body)}\n`);
  else out.write(`${c.id}\t${body.isSuccessor(c.before, c.after)}\n`);
}
out.end();
