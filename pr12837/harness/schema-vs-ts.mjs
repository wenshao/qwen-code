// For single-record kinds, find cases where Ajv and the TS module disagree
// and name the rule the module applied (its error message).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
const [distRoot, ...seeds] = process.argv.slice(2);
const m = await import(path.resolve(distRoot, 'src/managed-runtime/managed-extension-record.js'));
const P = { grant: m.parseOperationGrant, pin: (a) => m.parseDefinitionPin(a), run: (a) => m.parseExtensionRun(a), monitor: m.parseMonitorRun };
const agg = new Map(); const ex = new Map(); let total = 0;
for (const seed of seeds) {
  const cases = readline.createInterface({ input: fs.createReadStream(`big${seed}.jsonl`) });
  const verdicts = fs.readFileSync(`big${seed}.ts.txt`, 'utf8').split('\n');
  let i = 0;
  for await (const line of cases) {
    const [ts, sc] = verdicts[i++].split('\t');
    if (sc === '-' ) continue;
    total++;
    if (ts === sc) continue;
    const c = JSON.parse(line);
    let msg = 'accepted';
    try { P[c.k](c.a); } catch (e) { msg = e.message.replace(/[0-9]+/g, 'N').replace(/\.(tenantId|workspaceId|sessionId|operationId|ownerId|definitionId|executionCallId|effectId|dispatchId|deliveryId|runtimeBindingId|monitorId|ownerScopeId|resourceId|kind)\b/g, '.<id>'); }
    const key = `${c.k} schema=${sc} ts=${ts} :: ${msg.slice(0, 110)}`;
    agg.set(key, (agg.get(key) ?? 0) + 1);
    if (!ex.has(key)) ex.set(key, line.slice(0, 300));
  }
}
console.log(`single-record cases compared: ${total}`);
for (const [k, n] of [...agg].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(7), k);
const bad = [...agg.keys()].filter((k) => k.includes('schema=0 ts=1'));
console.log(`\nschema refuses but module accepts: ${bad.length} rule(s)`);
for (const k of bad) console.log('  ', k, '\n     e.g.', ex.get(k));
