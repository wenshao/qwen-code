// For every envelope row: which top-level keys differ from the canonical envelope,
// and which single-key repairs would make the module accept it.
import fs from 'node:fs';
import { parseManagedEventEnvelope, isManagedEventEnvelopeRedelivered } from '../src/managed-runtime/managed-event-envelope.js';
const f = JSON.parse(fs.readFileSync('src/managed-runtime/contracts/managed-event-envelope-v1.fixtures.json', 'utf8'));
const base = f.envelope as Record<string, unknown>;
const ok = (v: unknown) => { try { parseManagedEventEnvelope(v); return true; } catch { return false; } };
const diffKeys = (e: Record<string, unknown>) => [...new Set([...Object.keys(base), ...Object.keys(e)])].filter((k) => JSON.stringify(base[k]) !== JSON.stringify(e[k]));
const rows: string[] = [];
for (const c of f.envelopeCases) {
  const e = c.envelope;
  if (e === null || typeof e !== 'object' || Array.isArray(e)) { rows.push(`${c.id}\t${c.valid}\tnon-object`); continue; }
  const d = diffKeys(e);
  // a row whose refusal survives repairing its named defect alone is contaminated
  const extra = d.length > 1 ? d : [];
  rows.push(`${c.id}\t${c.valid}\t${d.join(',') || '(same as canonical)'}${extra.length ? '\tMULTI' : ''}`);
}
console.log(rows.filter((r) => r.includes('MULTI')).join('\n') || 'no multi-key rows');
console.log('--- dedupe');
for (const c of f.dedupeCases) console.log(`${c.id}\tsame=${c.same}\tfirstParses=${ok(c.first)}\tsecondParses=${ok(c.second)}\tfirstDiff=${diffKeys(c.first).join(',')}\tsecondDiff=${diffKeys(c.second).join(',')}`);
