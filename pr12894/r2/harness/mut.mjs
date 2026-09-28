// Revert each round-1 fix in isolation and run the tests that should pin it.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const W = `${process.env.HOME}/git/qwen-code-pr12894-mut`;
const MVN = `${process.env.S}/rig/mvn.sh`;
const T = {
  core: `cd ${W}/packages/core && npx vitest run src/managed-runtime/managed-harness-factory.test.ts 2>&1`,
  cli: `cd ${W}/packages/cli && npx vitest run src/serve/hosted-workspace-tool-turn.test.ts 2>&1`,
  java: `cd ${W} && ${MVN} -o -f packages/sdk-java/managed-agent-server/pom.xml test -Dtest=ToolPublicationStoreTest,ToolPublicationContractTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip 2>&1`,
};
const F = {
  cli: 'packages/cli/src/serve/hosted-workspace-tool-turn.ts',
  core: 'packages/core/src/managed-runtime/managed-harness-factory.ts',
  java: 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationStore.java',
};
const mutants = [
  ['M1 B1 call site: no turn identity', 'cli', F.cli, `commitAwaitRuntimeBatch(bindings, {\n        turnId: this.promptId,\n        promptId: this.promptId,\n      });`, `commitAwaitRuntimeBatch(bindings);`],
  ['M2 B1 relabel: keep previous turnId', 'core', F.core, `...turn,\n                  activationId: this.activation.activationId,`, `activationId: this.activation.activationId,`],
  ['M3 B1 guard: allow relabel of an unfinished turn', 'core', F.core, `      if (\n        turn &&\n        (turn.turnId !== previous.identity.turnId ||`, `      if (\n        turn && false &&\n        (turn.turnId !== previous.identity.turnId ||`],
  ['M4 B2 revert: (Timestamp) cast', 'java', F.java, `Object leaseValue = head.get("writer_lease_until");\n        Timestamp lease = leaseValue instanceof java.time.LocalDateTime local\n                ? Timestamp.valueOf(local) : (Timestamp) leaseValue;`, `Timestamp lease = (Timestamp) head.get("writer_lease_until");`],
  ['M5 B4 revert: plain SELECT on journal_tx', 'java', F.java, `journal_revision = ? FOR UPDATE"`, `journal_revision = ?"`],
];
const run = (kind) => {
  let out = '';
  let ok = true;
  try { out = execSync(T[kind], { encoding: 'utf8', maxBuffer: 64 << 20, shell: '/bin/bash', env: { ...process.env } }); }
  catch (e) { ok = false; out = (e.stdout ?? '') + (e.stderr ?? ''); }
  const line = kind === 'java'
    ? (out.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+(?![\s\S]*Tests run:)/) ?? ['?'])[0]
    : (out.match(/Tests\s+\d+[^\n]*/g) ?? ['?']).at(-1);
  return { ok, line };
};
for (const kind of ['core', 'cli', 'java']) { const r = run(kind); console.log(`baseline ${kind}: ${r.ok ? 'PASS' : 'FAIL'} ${r.line}`); }
for (const [label, kind, file, from, to] of mutants) {
  const path = `${W}/${file}`;
  const src = fs.readFileSync(path, 'utf8');
  if (!src.includes(from)) { console.log(`${label}: anchor not found`); continue; }
  fs.writeFileSync(path, src.replace(from, to));
  const r = run(kind);
  fs.writeFileSync(path, src);
  console.log(`${label}: ${r.ok ? 'SURVIVED' : 'KILLED'} (${kind}: ${r.line})`);
}
execSync(`cd ${W} && git status --short`, { stdio: 'inherit' });
