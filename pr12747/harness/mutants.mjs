// Independent mutation check on the PR's source: each mutant is one exact-string replacement,
// asserted to apply, run against the PR's own tests, then the file is restored byte for byte.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const REPO = '/Users/wenshao/git/qwen-code-pr12747';
const SV = 'packages/core/src/utils/schemaValidator.ts';
const EX = 'packages/cli/src/serve/managed-runtime-tool-executor.ts';
const CW = 'packages/cli/src/serve/managed-context-worker.ts';
const AW = 'packages/cli/src/serve/managed-runtime-attestation-worker.ts';
const CORE_T = ['core', ['src/utils/schemaValidator.test.ts']];
const CLI_T = ['cli', ['src/serve/managed-context-worker.test.ts', 'src/serve/managed-runtime-tool-worker.test.ts', 'src/serve/managed-runtime-attestation-worker.test.ts']];
const M = [
  ['C1 compile the caller object, not the parsed copy', SV, 'validate = validator.compile(JSON.parse(key) as AnySchema);', 'validate = validator.compile(schema);', CORE_T],
  ['C2 one cache shared by both Ajv instances', SV, 'let compiled = compiledSchemas.get(validator);', 'let compiled = compiledSchemas.get(ajvDefault);', CORE_T],
  ['C2b ...and stored under it', SV, 'compiledSchemas.set(validator, compiled);', 'compiledSchemas.set(ajvDefault, compiled);', CORE_T],
  ['C3 a failing text is not remembered', SV, 'compiled.failedTexts.add(key);\n', '\n', CORE_T],
  ['C4 NaN/Infinity count as exact JSON', SV, 'return Number.isFinite(value);', 'return true;', CORE_T],
  ['C5 callable toJSON counts as exact', SV, "typeof (value as Record<string, unknown>)['toJSON'] !== 'function' &&", '', CORE_T],
  ['C6 non-enumerable keys count as exact', SV, 'Reflect.ownKeys(value).length ===\n          Object.keys(value).length + (array ? 1 : 0)', 'true', CORE_T],
  ['C7 class instances count as exact', SV, ': prototype === Object.prototype || prototype === null) &&', ': true) &&', CORE_T],
  ['C8 seen objects are serialized again', SV, 'let validate = compiled.bySchema.get(schema);\n  if (validate) {\n    return validate;\n  }', 'let validate: ValidateFunction | undefined;', CORE_T],
  ['C9 no cache at all (base behaviour)', SV, 'validate = compileOnce(validator, anySchema);', 'validate = validator.compile(anySchema);', CORE_T],
  ['W1 shells not run in the Session context', EX, 'const result: ToolResult = await sessionIdContext.run(sessionId, () =>', 'const result: ToolResult = await ((f: () => Promise<ToolResult>) => f())(() =>', CLI_T],
  ['W2 project dir not registered', EX, 'registerSessionProjectDir(sessionId, config.storage.getProjectDir());', '', CLI_T],
  ['W3 tools built outside the Session context', CW, 'return sessionIdContext.run(sessionId, () =>\n      createManagedToolSet(directory, sessionId),\n    );', 'return createManagedToolSet(directory, sessionId);', CLI_T],
  ['W4 Session ID not hashed', CW, "return `${runtimeInstanceId}.${digest.slice(0, 32)}`;", 'return `${runtimeInstanceId}.${sessionId}`;', CLI_T],
  ['W5 all Sessions share one key', CW, "return `${runtimeInstanceId}.${digest.slice(0, 32)}`;", 'return runtimeInstanceId;', CLI_T],
  ['W6 boot v2 bytes not checked', AW, "new TextDecoder('utf-8', { fatal: true }).decode(document);", '', CLI_T],
  ['W7 the check also applied to boot v1', AW, 'const document = Buffer.concat(chunks);', "const document = Buffer.concat(chunks);\n  new TextDecoder('utf-8', { fatal: true }).decode(document);", CLI_T],
];
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const lines = [];
for (const [name, file, from, to, [pkg, tests]] of M) {
  if (only && !only.test(name)) continue;
  const abs = path.join(REPO, file);
  const orig = fs.readFileSync(abs);
  const text = orig.toString();
  const n = text.split(from).length - 1;
  if (n !== 1) { lines.push(`${name}: anchor found ${n} times — SKIPPED`); console.log(lines.at(-1)); continue; }
  fs.writeFileSync(abs, text.replace(from, to));
  const h0 = createHash('sha256').update(orig).digest('hex').slice(0, 8);
  const h1 = createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 8);
  const r = spawnSync('npx', ['vitest', 'run', '--coverage.enabled=false', ...tests], { cwd: path.join(REPO, 'packages', pkg), encoding: 'utf8', env: { ...process.env, CI: '1' } });
  fs.writeFileSync(abs, orig);
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests_ = /Tests\s+(.*)/.exec(out)?.[1]?.trim() ?? '?';
  const failed = [...out.matchAll(/(?:FAIL|×)\s+(.+?)(?:\s\d+ms)?$/gm)].map((m) => m[1]).filter((s) => !s.includes('.test.ts >') || true).slice(0, 2);
  lines.push(`${(r.status === 0 ? 'SURVIVED' : 'killed  ')} ${name} [${h0}->${h1}] ${tests_}${r.status !== 0 && failed.length ? ' | e.g. ' + failed[0].slice(0, 110) : ''}`);
  console.log(lines.at(-1));
}
const clean = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
lines.push(`worktree after restore: ${clean.trim() ? 'DIRTY\n' + clean : 'clean'}`);
console.log(lines.at(-1));
fs.appendFileSync('logs-mutants.log', lines.join('\n') + '\n');
