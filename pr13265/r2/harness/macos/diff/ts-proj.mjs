// TS projection of every record both sides accept (state / runtimeState).
import fs from 'node:fs';
import readline from 'node:readline';
const WT = process.env.WT;
const P = await import(`${WT}/packages/core/dist/src/managed-runtime/managed-extension-projection.js`);
const body = P.MANAGED_EXTENSION_RECORD_BODIES.child_run;
const ok = new Set(fs.readFileSync(process.env.OKIDS, 'utf8').trim().split('\n'));
const out = fs.createWriteStream(process.env.OUT);
const rl = readline.createInterface({ input: fs.createReadStream(process.env.IN), crlfDelay: Infinity });
for await (const line of rl) {
  const c = JSON.parse(line);
  if (c.type !== 'record' || !ok.has(String(c.id))) continue;
  const parsed = body.parse(c.body);
  const v = P.projectManagedTask(null, parsed.run, 1000, parsed.record.stopRequested);
  out.write(`${c.id}\t${v.state}\t${v.runtimeState}\t${v.startedAt}\t${v.settledAt}\n`);
}
out.end();
