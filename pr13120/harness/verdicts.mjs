// Judges the ten new cases and the renamed pair with the built TypeScript
// module (packages/core/dist) and Ajv 2020, and lists how far each case is
// from the canonical record it was derived from.
// usage: node verdicts.mjs <fixtures.json> <base-fixtures.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const S = path.resolve(import.meta.dirname, '..');
const CORE = path.join(S, 'wt-pr/packages/core');
const mod = await import(pathToFileURL(path.join(CORE, 'dist/src/managed-runtime/managed-extension-record.js')));
const { Ajv2020 } = await import(pathToFileURL(path.join(S, 'wt-pr/node_modules/ajv/dist/2020.js')));
const schema = JSON.parse(fs.readFileSync(path.join(CORE, 'src/managed-runtime/contracts/managed-extension-record-v1.schema.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const ajv = new Ajv2020({ strict: true });
ajv.compile(schema);
const schemaOk = (def, value) => ajv.getSchema(`${schema.$id}#/$defs/${def}`)(value);

function diff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const objects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
  if (!objects) return [`${at || '.'}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((k) => diff(a[k], b[k], `${at}.${k}`));
}

const judge = (fn) => {
  try {
    const r = fn();
    return typeof r === 'boolean' ? { verdict: r, error: null } : { verdict: true, error: null };
  } catch (e) {
    return { verdict: false, error: `${e.constructor.name}: ${e.message}` };
  }
};

const RECORDS = {
  grantCases: ['grant', 'operationGrant', 'grant', mod.parseOperationGrant],
  runCases: ['run', 'extensionRun', 'run', (v) => mod.parseExtensionRun(v)],
  monitorRunCases: ['monitorRun', 'monitorRun', 'monitorRun', mod.parseMonitorRun],
};
const PAIRS = {
  grantSuccessorCases: mod.isOperationGrantSuccessor,
  monitorRunSuccessorCases: mod.isMonitorRunSuccessor,
};
const rows = [];
for (const [list, cases] of Object.entries(fixtures)) {
  if (!list.endsWith('Cases')) continue;
  const known = new Set((base[list] ?? []).map((c) => c.id));
  for (const c of cases) {
    if (known.has(c.id) && c.id !== 'restarts-a-settled-watch-under-the-same-runtime') continue;
    const row = { list, id: c.id, label: c.valid };
    if (RECORDS[list]) {
      const [field, def, canonical, parse] = RECORDS[list];
      Object.assign(row, judge(() => parse(c[field])));
      row.schema = schemaOk(def, c[field]);
      row.fromCanonical = diff(fixtures[canonical], c[field]);
    } else if (PAIRS[list]) {
      Object.assign(row, judge(() => PAIRS[list](c.previous, c.next)));
      row.previousIsCanonical = JSON.stringify(c.previous) === JSON.stringify(fixtures[list === 'grantSuccessorCases' ? 'grant' : 'monitorRun']);
      row.nextVsPrevious = diff(c.previous, c.next);
      const old = (base[list] ?? []).find((b) => b.id === 'rebuilds-after-a-proven-end');
      if (old && list === 'monitorRunSuccessorCases') {
        row.oldPairNextVsPrevious = diff(old.previous, old.next);
        row.oldVsNew = { previous: diff(old.previous, c.previous), next: diff(old.next, c.next) };
      }
    } else {
      row.note = 'no driver for this list';
    }
    row.agrees = row.verdict === row.label;
    rows.push(row);
  }
}
console.log(JSON.stringify(rows, null, 2));
