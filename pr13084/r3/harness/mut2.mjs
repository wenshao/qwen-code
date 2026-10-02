// F1-fix mutants on head 8b0e0175: multi-replacement mutants, unit suite (surefire) only, TZ=UTC.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr13084-mut`, MOD = `${W}/packages/sdk-java/managed-agent-server`;
const st = `${MOD}/src/main/java/com/alibaba/qwen/code/managedagent/store`;
const RIG = path.dirname(new URL(import.meta.url).pathname), OUT = `${RIG}/out/mut2.jsonl`;
const A = `${st}/AliyunToolPublicationObjectStore.java`;
const M = [
  ['R1', 'read(): no guard before each attempt', [[A, '            guard.run();\n            try {\n                return request.get();', '            try {\n                return request.get();']]],
  ['R2', 'read(): retry every OSSException (403 too)', [[A, '                        || error.getErrorCode() == null\n                        || !TRANSIENT_SERVICE_ERRORS.contains(error.getErrorCode())) {', ') {']]],
  ['R3', 'read(): retry cap 3 -> 50', [[A, 'if (retries >= ClientConfiguration.DEFAULT_MAX_RETRIES\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_SERVICE_ERRORS', 'if (retries >= 50\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_SERVICE_ERRORS'], [A, 'if (retries >= ClientConfiguration.DEFAULT_MAX_RETRIES\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_CLIENT_ERRORS', 'if (retries >= 50\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_CLIENT_ERRORS']]],
  ['R4', 'retention open(): no per-attempt lease guard', [[`${st}/ToolPublicationRetentionStore.java`, 'var input = objects.open(objectKey, () -> {\n            lease.check();\n            guard.run();\n        });', 'var input = objects.open(objectKey);']]],
  ['R5', 'copyVerified(): no per-attempt lease guard', [[`${st}/ToolPublicationDataStore.java`, 'objects.open(resource.objectKey(), () -> {\n                    lease.check();\n                    heartbeat.run();\n                })', 'objects.open(resource.objectKey())']]],
  ['R6', 'read(): never retry', [[A, 'if (retries >= ClientConfiguration.DEFAULT_MAX_RETRIES\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_SERVICE_ERRORS', 'if (true\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_SERVICE_ERRORS'], [A, 'if (retries >= ClientConfiguration.DEFAULT_MAX_RETRIES\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_CLIENT_ERRORS', 'if (true\n                        || error.getErrorCode() == null\n                        || !TRANSIENT_CLIENT_ERRORS']]],
];
function reports() {
  const fails = []; const dir = `${MOD}/target/surefire-reports`; if (!fs.existsSync(dir)) return fails;
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith('TEST-') && x.endsWith('.xml'))) {
    const x = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of x.matchAll(/<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) if (m[3] && /<(failure|error)/.test(m[3])) fails.push(`${m[2].split('.').at(-1)}.${m[1]}`);
  }
  return fails;
}
function run() {
  fs.rmSync(`${MOD}/target/surefire-reports`, { recursive: true, force: true });
  const t0 = Date.now();
  const r = spawnSync(`${RIG}/mvn.sh`, ['-o', '-q', '-Dcheckstyle.skip=true', 'test'], { cwd: MOD, env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8', maxBuffer: 1 << 28 });
  return { exit: r.status, ms: Date.now() - t0, compileError: /COMPILATION ERROR/.test(r.stdout), fails: reports() };
}
const ctl = run(); fs.appendFileSync(OUT, JSON.stringify({ id: 'CTL', ...ctl }) + '\n'); console.log('CTL', ctl.exit, ctl.fails.length, Math.round(ctl.ms / 1000) + 's');
if (ctl.exit !== 0) process.exit(1);
for (const [id, desc, reps] of M) {
  const files = new Set();
  let bad = null;
  for (const [file, find, rep] of reps) { const s = fs.readFileSync(file, 'utf8'); const n = s.split(find).length - 1; if (n !== 1) { bad = `anchor ${n} in ${path.basename(file)}`; break; } fs.writeFileSync(file, s.replace(find, rep)); files.add(file); }
  if (bad) { for (const f of files) execFileSync('git', ['checkout', '--', f], { cwd: W }); fs.appendFileSync(OUT, JSON.stringify({ id, desc, error: bad }) + '\n'); console.log(id, bad); continue; }
  const r = run();
  for (const f of files) execFileSync('git', ['checkout', '--', f], { cwd: W });
  const verdict = r.compileError ? 'COMPILE-ERROR' : r.fails.length ? 'KILLED' : r.exit === 0 ? 'SURVIVED' : 'BUILD-FAILED';
  fs.appendFileSync(OUT, JSON.stringify({ id, desc, verdict, ...r }) + '\n');
  console.log(id, verdict, desc, '|', r.fails.slice(0, 3).join(' | '));
}
console.log('MUT2-DONE', execFileSync('git', ['status', '--short'], { cwd: W, encoding: 'utf8' }).trim() || 'clean');
