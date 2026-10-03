// VERIFICATION RIG ONLY (PR #13112): one mutant at a time in wt-mut; Java mutants run the unit lane, then the Hosted IT
// if the unit lane did not kill them; web-shell mutants run the two managed client test files.
// usage: node mutate.mjs [id ...]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const RIG = '/Users/wenshao/pr13112-rig';
const W = `${RIG}/${process.env.MUT_TREE ?? "wt-mut"}`;
const P = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const SVC = `${P}/service/ManagedAgentService.java`;
const STORE = `${P}/store/ManagedAgentStore.java`;
const REG = `${P}/store/ManagedWorkspaceRegistry.java`;
const COORD = `${P}/service/HarnessCoordinator.java`;
const BRK = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const BREC = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBindingRecord.java';
const PROV = 'packages/web-shell/client/components/managed/java-managed-agent-provider.ts';
const PAGE = 'packages/web-shell/client/components/managed/ManagedSessionsPage.tsx';
const M = [
  { id: 'F5a', what: "broker: LOST binding refused by drain again (pre-8953b8ff)", file: BRK,
    from: "        if (!saved.getRequest().isManagedContext() || !provisioner.supportsDrainedStop()\n                || saved.getState() == RuntimeBindingRecord.State.OPERATOR_RECOVERY",
    to: "        if (!saved.getRequest().isManagedContext() || !provisioner.supportsDrainedStop()\n                || saved.getState() == RuntimeBindingRecord.State.LOST\n                || saved.getState() == RuntimeBindingRecord.State.OPERATOR_RECOVERY" },
  { id: 'F5b', what: "broker: LOST drain skips the unsettled-resources check", file: BRK,
    from: "        if (lost && (sessionRepository.countActiveByBinding(",
    to: "        if (Boolean.FALSE && lost && (sessionRepository.countActiveByBinding(" },
  { id: 'F5c', what: "record: LOST may become RELEASED without a drain receipt", file: BREC,
    from: "                && !(replacement.state == State.RELEASED && replacement.drainReceipt != null))",
    to: "                && !(replacement.state == State.RELEASED))" },
  { id: 'F5d', what: "broker: a LOST binding is moved to DRAINING", file: BRK,
    from: "                .withState(lost ? RuntimeBindingRecord.State.LOST : RuntimeBindingRecord.State.DRAINING,",
    to: "                .withState(RuntimeBindingRecord.State.DRAINING," },
  { id: 'S2', what: "store: FAILED receipt re-attempt skips the open-operation check", file: STORE,
    from: "            if (\"FAILED\".equals(command.status())) {\n                requireNoOpenOperation(tenantId, sessionId);",
    to: "            if (\"FAILED\".equals(command.status())) {" },
  { id: 'K3', what: "service: drop the opt-in check", file: SVC,
    from: "        if (session.workspace() == null || !harness.isWorkspaceFilesAvailable()) {",
    to: "        if (session.workspace() == null) {" },
];

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const env = { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` };
if (!process.env.MUT_TREE) { console.error('set MUT_TREE'); process.exit(2); }
const want = process.argv.slice(2);
const out = `${RIG}/out/mut`;
fs.mkdirSync(out, { recursive: true });
const ledger = `${out}/${process.env.MUT_LEDGER ?? 'LEDGER.txt'}`;
for (const m of M) {
  if (want.length && !want.includes(m.id)) continue;
  const f = `${W}/${m.file}`;
  const orig = fs.readFileSync(f, 'utf8');
  const n = orig.split(m.from).length - 1;
  if (n !== 1) { fs.appendFileSync(ledger, `${m.id} NOT-APPLIED matches=${n} ${m.what}\n`); console.log(`${m.id} NOT-APPLIED matches=${n}`); continue; }
  fs.writeFileSync(f, orig.replace(m.from, m.to));
  const start = Date.now();
  let verdict = 'SURVIVED', by = '';
  try {
    if (m.file.endsWith('.java')) {
      const mod = m.file.includes('/runtime-broker/') ? 'runtime-broker' : 'managed-agent-server';
      const u = run('mvn', ['-B', '-ntp', '-o', `-Dmaven.repo.local=${RIG}/${process.env.MUT_M2 ?? "m2-mut"}`, '-f', `${W}/packages/sdk-java/${mod}/pom.xml`, 'test'], { env });
      fs.writeFileSync(`${out}/${m.id}-unit.log`, u.stdout + u.stderr);
      const failed = [...new Set((u.stdout.match(/^\[ERROR\]   [A-Za-z]+\.[A-Za-z]+(:\d+)?/gm) ?? []).map((s) => s.replace('[ERROR]   ', '')))];
      if (u.status !== 0) { verdict = 'KILLED'; by = `unit: ${failed.slice(0, 4).join(', ') || 'build/compile failure'}`; }
      else if (mod === 'runtime-broker') { by = 'runtime-broker unit 0 failures (Hosted IT not applicable: it uses the installed broker)'; }
      else {
        const it = run(`${RIG}/it.sh`, [process.env.MUT_TREE ?? 'wt-mut', `${process.env.MUT_TAG ?? 'mut'}-${m.id}`, process.env.MUT_M2 ?? 'm2-mut', 'HostedPublicWorkspaceIT'], { env });
        const line = it.stdout.trim();
        if (!/exit=0 /.test(line)) {
          const log = fs.readFileSync(`${RIG}/out/it/${process.env.MUT_TAG ?? 'mut'}-${m.id}.log`, 'utf8');
          const where = (log.match(/HostedPublicWorkspaceIT\.java:\d+/g) ?? []).slice(0, 2).join(' ');
          verdict = 'KILLED'; by = `Hosted IT (${where || line.slice(0, 80)})`;
        } else by = 'unit 0 failures; Hosted IT green';
      }
    } else {
      const t = run(`${W}/node_modules/.bin/vitest`, ['run', '--config', 'vitest.config.ts', 'client/components/managed/java-managed-agent-provider.test.ts', 'client/components/managed/ManagedSessionsPage.test.tsx'], { cwd: `${W}/packages/web-shell`, env });
      fs.writeFileSync(`${out}/${m.id}-vitest.log`, t.stdout + t.stderr);
      const failedNames = [...new Set((t.stdout.match(/FAIL .*? > .*$/gm) ?? []).map((s) => s.slice(0, 140)))];
      if (t.status !== 0) { verdict = 'KILLED'; by = `vitest: ${failedNames.slice(0, 2).join(' | ') || 'exit ' + t.status}`; }
      else by = 'vitest green';
    }
  } finally {
    fs.writeFileSync(f, orig);
  }
  const line = `${m.id} ${verdict} ${Math.round((Date.now() - start) / 1000)}s  ${m.what}  -- ${by}`;
  fs.appendFileSync(ledger, line + '\n');
  console.log(line);
}
