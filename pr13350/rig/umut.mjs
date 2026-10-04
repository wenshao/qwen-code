// Unit-level mutation matrix on a git-less clone of the head tree.
// usage: node umut.mjs <id...>   (ids: U1..U8, or all)
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const T = '/Users/wenshao/pr13350-rig/src-umut/packages/cli';
const REC = `${T}/src/serve/hosted-runtime-recovery.ts`;
const SES = `${T}/src/serve/hosted-harness-session.ts`;
const OUT = '/Users/wenshao/pr13350-rig/out/umut.log';
// [file, line, expected substring, replacement-of-that-substring, description]
const M = {
  U1: [REC, 472, 'if (!input.leaseAlreadyHeld) {', 'if (true) {', 'execute-path catch releases a held lease'],
  U2: [REC, 496, 'if (!input.leaseAlreadyHeld)', 'if (true)', 'acquire-only catch releases a held lease'],
  U3: [REC, 514, 'if (acquiredRuntime && !passive && !input.leaseAlreadyHeld) {', 'if (acquiredRuntime && !passive) {', 'finalAuthorization throw releases a held lease'],
  U4: [REC, 527, 'if (acquiredRuntime && !passive && !input.leaseAlreadyHeld) {', 'if (acquiredRuntime && !passive) {', 'not-runnable exit releases a held lease'],
  U5: [SES, 1405, 'leaseAlreadyHeld: attached.runtimeLeaseHeld !== undefined,', 'leaseAlreadyHeld: false,', 'redrive never passes leaseAlreadyHeld'],
  U6: [SES, 1389, 'attached.active !== undefined ||', 'false ||', 'redrive ignores an in-flight settlement (active)'],
  U7: [SES, 1412, 'if (recovered.acquiredRuntime)', 'if (false)', 'redrive does not record the re-acquired lease'],
  U8: [SES, 1373, "const passive = body?.['passiveManagedRuntimeRecovery'] === true;", 'const passive = false;', 'redrive treats a passive load as a continuation'],
};
const ids = process.argv.slice(2).includes('all') ? Object.keys(M) : process.argv.slice(2);
for (const id of ids) {
  const [file, line, expect, repl, desc] = M[id];
  const original = readFileSync(file, 'utf8');
  const lines = original.split('\n');
  if (!lines[line - 1].includes(expect)) throw new Error(`${id}: line ${line} does not contain ${expect}: ${lines[line - 1]}`);
  lines[line - 1] = lines[line - 1].replace(expect, repl);
  writeFileSync(file, lines.join('\n'));
  try {
    const t0 = Date.now();
    const r = spawnSync('npx', ['vitest', 'run', 'src/serve/hosted-harness-session.test.ts', 'src/serve/hosted-runtime-recovery.test.ts'], { cwd: T, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const summary = (out.match(/^\s*Tests\s+.*$/m) || ['?'])[0].trim();
    const failed = [...new Set([...out.matchAll(/(?:FAIL|×)\s+(.+?)(?:\s+\d+ms)?$/gm)].map((m) => m[1].trim()))].slice(0, 12);
    const line1 = `${id} exit=${r.status} ${Math.round((Date.now() - t0) / 1000)}s ${desc} :: ${summary}\n${failed.map((f) => '    - ' + f).join('\n')}\n`;
    appendFileSync(OUT, line1);
    process.stdout.write(line1);
  } finally {
    writeFileSync(file, original);
  }
}
