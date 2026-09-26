// Source mutants of schemaValidator.ts, each run against this PR's test file and the test file before
// this PR (copied next to it as schemaValidator.pre12777.test.ts), at --retry=0 and --retry=2.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const CORE = `${process.env.HOME}/git/qwen-code-pr12777/packages/core`;
const SRC = `${CORE}/src/utils/schemaValidator.ts`;
const ORIG = fs.readFileSync(SRC, 'utf8');
const BRANCH = '  if (key === undefined || compiled.failedTexts.has(key)) {\n    compiled.direct.add(schema);\n    return validator.compile(schema);\n  }';
const M = {
  NONE: ['no mutation (baseline)', []],
  // --- the author's table
  L1: ['catch returns the object compile, no rethrow of the copy error', [
    [`      try {\n        return validator.compile(schema);\n      } catch {\n        // The object fails as its copy did, or as a duplicate of the $id its\n        // copy claimed first. Either way the copy's error is its own.\n        throw copyError;\n      }`, `      return validator.compile(schema);`]]],
  Z1r: ['isExactJsonValue rejects -0', [[`      return Number.isFinite(value);`, `      return Number.isFinite(value) && !Object.is(value, -0);`]]],
  N1: ['arrays with keys other than indexes count as exact (main rule)', [[`(array ? (value as unknown[]).length + 1 : Object.keys(value).length)`, `Object.keys(value).length + (array ? 1 : 0)`]]],
  NP: ['objects without a prototype count as exact (main rule)', [[`prototype === (array ? Array.prototype : Object.prototype) &&`, `(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null) &&`]]],
  X5: ['direct branch drops the object from compiled.direct', [[`  if (compiled.direct.has(schema)) {\n    return validator.compile(schema);`, `  if (compiled.direct.has(schema)) {\n    compiled.direct.delete(schema);\n    return validator.compile(schema);`]]],
  T2: ['direct branch drops the object only when its compile throws', [[`  if (compiled.direct.has(schema)) {\n    return validator.compile(schema);`, `  if (compiled.direct.has(schema)) {\n    try { return validator.compile(schema); } catch (e) { compiled.direct.delete(schema); throw e; }`]]],
  M8b: ['catch removes the failed copy with removeSchema', [[`    } catch (copyError) {\n`, `    } catch (copyError) {\n      validator.removeSchema(JSON.parse(key) as AnySchema);\n`]]],
  F1: ['catch no longer adds the object to compiled.direct', [[`      compiled.failedTexts.add(key);\n      compiled.direct.add(schema);\n`, `      compiled.failedTexts.add(key);\n`]]],
  CF: ['unknown format warning filter stops matching', [[`args[0].startsWith('unknown format ')`, `args[0].startsWith('unknown formats ')`]]],
  // --- mine
  A1: ['every array counts as inexact (drops the +1 for length)', [[`(value as unknown[]).length + 1 :`, `(value as unknown[]).length :`]]],
  A2: ['catch always throws the copy error, even when the object compiles', [
    [`      try {\n        return validator.compile(schema);\n      } catch {`, `      try {\n        validator.compile(schema);\n        throw copyError;\n      } catch {`]]],
  A3: ['catch drops failedTexts.add (C3 from #12747)', [[`      compiled.failedTexts.add(key);\n      compiled.direct.add(schema);\n`, `      compiled.direct.add(schema);\n`]]],
  A4: ['toJSON check removed', [[`        typeof (value as Record<string, unknown>)['toJSON'] !== 'function' &&\n`, ``]]],
  A5: ['subclassed arrays count as exact', [[`prototype === (array ? Array.prototype : Object.prototype) &&`, `(array || prototype === Object.prototype) &&`]]],
  // --- the #12759 set, re-run on this PR's source
  B3c: ['#12759: a new object whose text failed gets an accept-all validator', [[BRANCH, '  if (key !== undefined && compiled.failedTexts.has(key)) {\n    return (() => true) as unknown as ValidateFunction;\n  }\n' + BRANCH]]],
  M7: ['#12759: a new object whose text failed is not added to direct', [[BRANCH, BRANCH.replace('    compiled.direct.add(schema);', '    if (key === undefined) compiled.direct.add(schema);')]]],
  D1: ['#12759: compileOnce drops the early return for direct', [['  if (compiled.direct.has(schema)) {\n    return validator.compile(schema);\n  }\n', '']]],
  X1: ['#12759: an inexact schema is not added to direct', [[BRANCH, BRANCH.replace('    compiled.direct.add(schema);', '    if (key !== undefined) compiled.direct.add(schema);')]]],
  X2: ['#12759: failedTexts is never consulted', [['if (key === undefined || compiled.failedTexts.has(key)) {', 'if (key === undefined) {']]],
};
const only = process.argv.slice(2);
const run = (retry) => {
  const out = `${process.env.TMPDIR ?? '/tmp'}/vt-${process.pid}-${retry}.json`;
  spawnSync('npx', ['vitest', 'run', 'src/utils/schemaValidator.test.ts', 'src/utils/schemaValidator.pre12777.test.ts', `--retry=${retry}`, '--reporter=json', `--outputFile=${out}`, '--coverage.enabled=false'], { cwd: CORE, encoding: 'utf8' });
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  const r = {};
  for (const f of j.testResults) {
    const key = f.name.includes('pre12777') ? 'before' : 'pr';
    const failed = f.assertionResults.filter((a) => a.status === 'failed').length;
    r[key] = failed ? `fail(${failed})` : `pass(${f.assertionResults.length})`;
  }
  return r;
};
const rows = [];
try {
  for (const [id, [desc, edits]] of Object.entries(M)) {
    if (only.length && !only.includes(id)) continue;
    let src = ORIG;
    for (const [a, b] of edits) {
      if (src.split(a).length !== 2) throw new Error(`${id}: anchor not unique/absent: ${a.slice(0, 60)}`);
      src = src.replace(a, b);
    }
    fs.writeFileSync(SRC, src);
    const r0 = run(0), r2 = run(2);
    const row = `${id.padEnd(4)} PR tests r0=${r0.pr} r2=${r2.pr} | tests before PR r0=${r0.before} r2=${r2.before} | ${desc}`;
    console.log(row); rows.push(row);
  }
} finally {
  fs.writeFileSync(SRC, ORIG);
}
fs.appendFileSync('logs-mutants.txt', rows.join('\n') + '\n');
