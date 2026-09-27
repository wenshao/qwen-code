// Replays JSONL cases through the built TypeScript module and Ajv (strict,
// draft 2020-12). Prints one line per case: <ts>\t<schema>, where ts is 1/0
// or X:<error> for a throw that is not a contract refusal.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createRequire } from 'node:module';
const [distRoot, schemaPath, casesPath] = process.argv.slice(2);
const m = await import(path.resolve(distRoot, 'src/managed-runtime/managed-extension-record.js'));
const r = await import(path.resolve(distRoot, 'src/managed-runtime/managed-session-records.js'));
const require = createRequire(path.resolve(distRoot, 'package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ strict: true });
ajv.compile(schema);
const v = (d) => ajv.getSchema(`${schema.$id}#/$defs/${d}`);
const S = { grant: v('operationGrant'), pin: v('definitionPin'), run: v('extensionRun'), monitor: v('monitorRun') };
const parse = (fn) => (a) => { fn(a); return true; };
const F = {
  grant: parse(m.parseOperationGrant), pin: parse((a) => m.parseDefinitionPin(a)),
  run: parse((a) => m.parseExtensionRun(a)), monitor: parse(m.parseMonitorRun),
  grantSucc: m.isOperationGrantSuccessor, pinPair: m.isDefinitionPinConsistent,
  runSucc: m.isExtensionRunSuccessor, monitorSucc: m.isMonitorRunSuccessor,
};
const out = fs.createWriteStream(process.argv[5] ?? '/dev/stdout');
const rl = readline.createInterface({ input: fs.createReadStream(casesPath), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const c = JSON.parse(line);
  let ts;
  try { ts = F[c.k](c.a, c.b) ? '1' : '0'; }
  catch (e) { ts = e instanceof r.ManagedSessionRecordError ? '0' : `X:${e?.constructor?.name}:${String(e?.message).slice(0, 80)}`; }
  const sc = S[c.k] ? (S[c.k](c.a) ? '1' : '0') : '-';
  out.write(`${ts}\t${sc}\n`);
}
out.end();
