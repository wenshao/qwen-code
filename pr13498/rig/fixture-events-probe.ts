// Finds every object in the shared contract fixtures that the record contract
// accepts as a committed event, then derives, round-trips and schema-checks it.
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line import/no-internal-modules
import { Ajv2020 } from 'ajv/dist/2020.js';
import { managedEventEnvelopeFrom, parseManagedEventEnvelope } from '../src/managed-runtime/managed-event-envelope.js';
import { parseManagedSessionEvent, MANAGED_SESSION_EVENT_KINDS } from '../src/managed-runtime/managed-session-records.js';
const dir = path.resolve('src/managed-runtime/contracts');
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'managed-event-envelope-v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true }); ajv.compile(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/envelope`)!;
const kinds: Record<string, number> = {}; const failures: string[] = []; let found = 0; const seen = new Set<string>();
const visit = (node: unknown, where: string) => {
  if (Array.isArray(node)) { node.forEach((c, i) => visit(c, `${where}[${i}]`)); return; }
  if (node === null || typeof node !== 'object') return;
  let event;
  try { event = parseManagedSessionEvent(node); } catch { event = undefined; }
  if (event) {
    const text = JSON.stringify(node); if (!seen.has(text)) { seen.add(text); found++;
      kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
      try {
        const env = managedEventEnvelopeFrom(event); const wire = JSON.parse(JSON.stringify(env));
        const parsed = parseManagedEventEnvelope(wire);
        if (JSON.stringify(parsed) !== JSON.stringify(env)) failures.push(`${where}: round trip`);
        if (!validate(wire)) failures.push(`${where}: schema ${JSON.stringify(validate.errors)}`);
      } catch (e) { failures.push(`${where}: ${(e as Error).message}`); }
    }
  }
  for (const [k, v] of Object.entries(node)) visit(v, `${where}.${k}`);
};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.fixtures.json'))) visit(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), f);
console.log(JSON.stringify({ distinctValidEvents: found, kinds, kindsNeverSeen: MANAGED_SESSION_EVENT_KINDS.filter((k) => !(k in kinds)), failures }, null, 1));
