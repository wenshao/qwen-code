// Repair the field a negative row's id names; a row that still fails to parse
// carries a second defect, so it does not pin the rule its id claims.
import fs from 'node:fs';
import { parseManagedEventEnvelope, MANAGED_EVENT_ENVELOPE_FORBIDDEN_FIELDS } from '../src/managed-runtime/managed-event-envelope.js';
const f = JSON.parse(fs.readFileSync('src/managed-runtime/contracts/managed-event-envelope-v1.fixtures.json', 'utf8'));
const base = f.envelope as Record<string, unknown>;
const why = (v: unknown) => { try { parseManagedEventEnvelope(v); return 'ACCEPTED'; } catch (e) { return (e as Error).message; } };
const field = (id: string): string | null => {
  const map: Array<[RegExp, string]> = [[/^session-id-/, 'sessionId'], [/^event-id-/, 'eventId'], [/^tenant-id-/, 'tenantId'], [/^workspace-id-/, 'workspaceId'], [/^stream-/, 'stream'], [/^digest-|^payload-ref-|^payload-body/, 'payloadRef'], [/^sequence-/, 'sequence'], [/^occurred-at-/, 'occurredAt'], [/^kind-/, 'kind'], [/^v-/, 'v']];
  for (const [re, k] of map) if (re.test(id)) return k; return null;
};
const out: string[] = [];
for (const c of f.envelopeCases) {
  if (c.valid) continue;
  const e = c.envelope;
  if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
  const repaired: Record<string, unknown> = { ...e };
  if (c.id.startsWith('forbidden-')) for (const k of MANAGED_EVENT_ENVELOPE_FORBIDDEN_FIELDS) delete repaired[k];
  else if (c.id === 'unknown-field') for (const k of Object.keys(repaired)) { if (!(k in base)) delete repaired[k]; }
  else { const k = field(c.id); if (!k) { out.push(`${c.id}\t(no field mapping)`); continue; } repaired[k] = base[k]; }
  const r = why(repaired);
  out.push(`${c.id}\toriginal: ${why(e)}\trepaired: ${r}${r === 'ACCEPTED' ? '' : '\t<< SECOND DEFECT'}`);
}
console.log(out.filter((l) => l.includes('SECOND DEFECT') || l.includes('no field')).join('\n') || 'every negative row isolates its named defect');
console.log(`checked ${out.length} negative object rows`);
