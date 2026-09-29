// Round 9 Java mutants on 19f19c67 (R2-6 canonical text, R2-9 UNKNOWN v3 cancel).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut3`;
const MVN = process.argv[2];
const C = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationContract.java';
const B = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const TC = `cd ${W} && ${MVN} -f packages/sdk-java/managed-agent-server/pom.xml -Dtest=ToolPublicationContractTest -Dsurefire.failIfNoSpecifiedTests=false test 2>&1`;
const TB = `cd ${W} && ${MVN} -f packages/sdk-java/runtime-broker/pom.xml -Dtest=RuntimeBrokerServiceTest -Dsurefire.failIfNoSpecifiedTests=false test 2>&1`;
const mutants = [
  ['J1 R2-6: Shell input digest over Jackson toString again', C, TC, `sha256(canonicalText(canonical(input)).getBytes(StandardCharsets.UTF_8))`, `sha256(canonical(input).toString().getBytes(StandardCharsets.UTF_8))`],
  ['J2 R2-6: binding digest over Jackson toString again', C, TC, `return sha256(canonicalText(canonical(parse("binding", binding)))`, `return sha256((canonical(parse("binding", binding)).toString())`],
  ['J3 R2-6: \\u escapes in upper-case hex', C, TC, `result.append(Character.forDigit((c >> shift) & 15, 16));`, `result.append(Character.toUpperCase(Character.forDigit((c >> shift) & 15, 16)));`],
  ['J4 R2-9: UNKNOWN deferred_v3 cancel settled locally again', B, TB, `                                            && !publicationV3\n`, ``],
];
const run = (cmd) => { let out = '', ok = true; try { out = execSync(cmd, { encoding: 'utf8', maxBuffer: 256 << 20, shell: '/bin/bash' }); } catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); } const line = (out.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+(?!,)/g) ?? ['? ' + out.slice(-400)]).at(-1); const failed = [...out.matchAll(/\[ERROR\]\s+(\S+)\s+(?:--|Time)/g)].map((m) => m[1]).slice(0, 3); return { ok, line, failed }; };
for (const cmd of [TC, TB]) { const b = run(cmd); console.log(`baseline ${cmd.includes('runtime-broker') ? 'broker' : 'contract'}: ${b.ok ? 'PASS' : 'FAIL'} ${b.line}`); }
for (const [label, file, cmd, from, to] of mutants) {
  const p = `${W}/${file}`; const src = fs.readFileSync(p, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(p, src.replace(from, to)); const r = run(cmd); fs.writeFileSync(p, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${r.line})${r.ok ? '' : ' ' + r.failed.join(', ')}`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
