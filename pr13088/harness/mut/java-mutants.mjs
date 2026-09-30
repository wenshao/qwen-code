// Java mutants for PR #13088 (exact-string, one hit each). Runs INSIDE the Linux Java 21 container on a local-disk copy.
//   node java-mutants.mjs unit [ids...]      whole managed-agent-server unit suite per mutant (double-fail rule)
//   node java-mutants.mjs apply <id> <tree>  apply one mutant to a tree (for the IT stage)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const S = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const G = `${S}/store/WorkspaceStorageGuard.java`;
const E = `${S}/store/WorkspaceExecutionStore.java`;
const C = `${S}/harness/QwenHostedHarnessConnector.java`;
const V = `${S}/service/WorkspaceRuntimeProvisioner.java`;
export const M = [
  { id: 'J01', what: 'claim: no guard check under the storage row lock', file: E, find: '            if (storageGuard != null) {\n                storageGuard.verifyLocked(binding);\n            }\n', to: '' },
  { id: 'J02', what: 'assertHeld (execute / publisher / control): no guard check', file: E, find: '    public void assertHeld(ContextBinding binding, RuntimeSessionRecord session) {\n        if (storageGuard != null) {\n            storageGuard.verify(binding);\n        }\n', to: '    public void assertHeld(ContextBinding binding, RuntimeSessionRecord session) {\n' },
  { id: 'J03', what: 'authorize (attachment / resolve): no guard check', file: E, find: '        authorizePassiveAttachment(session);\n        if (storageGuard != null) {\n            storageGuard.verify(session.workspace());\n        }\n', to: '        authorizePassiveAttachment(session);\n' },
  { id: 'J04', what: 'submit: no new-work authorization with a cached attachment', file: C, find: '            List<Map<String, Object>> input, String payloadDigest) {\n        requireReadyForNewWork(tenantId, sessionId);\n', to: '            List<Map<String, Object>> input, String payloadDigest) {\n' },
  { id: 'J05', what: 'continueManagedRuntime: no new-work authorization', file: C, find: '            String activationId) {\n        requireReadyForNewWork(tenantId, sessionId);\n', to: '            String activationId) {\n' },
  { id: 'J06', what: 'provisioner: no guard-enabled storage check before provision / ensureResource', file: V, find: '        if (!request.isManagedContext() || !executionStore.verifiedRecoveryEnabled()) {\n            return;\n        }', to: '        if (true) {\n            return;\n        }' },
  { id: 'J07', what: 'verify: marker not compared', file: G, find: '        requireMatching(row, actual, tenantId, storageId);\n        if (!marker(row).equals(readMarker(root))) {\n            throw WorkspaceExecutionStore.unavailable();\n        }\n        Path directory', to: '        requireMatching(row, actual, tenantId, storageId);\n        Path directory' },
  { id: 'J08', what: 'identity: device not compared', file: G, find: "                || !identity.device().equals(row.device()) || !identity.inode().equals(row.inode())", to: "                || !identity.inode().equals(row.inode())" },
  { id: 'J09', what: 'identity: inode not compared', file: G, find: "                || !identity.device().equals(row.device()) || !identity.inode().equals(row.inode())", to: "                || !identity.device().equals(row.device())" },
  { id: 'J10', what: 'identity: host id not compared', file: G, find: "                || !identity.root().equals(row.root()) || !identity.hostId().equals(row.hostId())", to: "                || !identity.root().equals(row.root())" },
  { id: 'J11', what: 'identity: canonical root path not compared', file: G, find: "                || !identity.root().equals(row.root()) || !identity.hostId().equals(row.hostId())", to: "                || !identity.hostId().equals(row.hostId())" },
  { id: 'J12', what: 'verify: saved cwd directory not checked', file: G, find: "            if (!directory.startsWith(root)\n                    || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)\n                    || !directory.toRealPath().equals(directory)) {", to: "            if (false && (!directory.startsWith(root)\n                    || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)\n                    || !directory.toRealPath().equals(directory))) {" },
  { id: 'J13', what: 'verify: a FENCED / in-maintenance row is accepted', file: G, find: "        if (row == null || !\"READY\".equals(row.state()) || row.operationId() != null\n                || row.revision() <= 0) {", to: "        if (row == null || row.revision() <= 0) {" },
  { id: 'J14', what: 'fence: allowed while a holder is present', file: G, find: "                    + \" AND holder_key IS NULL AND binding_id IS NULL\"\n                    + \" AND runtime_generation IS NULL AND runtime_session_id IS NULL\",", to: "                    + \"\"," },
  { id: 'J15', what: 'fence: expected revision not compared', file: G, find: "                    + \" AND mount_state = 'READY' AND mount_revision = ?\"", to: "                    + \" AND mount_state = 'READY' AND mount_revision >= ?\"" },
  { id: 'J16', what: 'fence retry: a different operation may re-enter an existing fence', file: G, find: "                    && current.revision() == revision && operationId.equals(current.operationId())) {\n                return;", to: "                    && current.revision() == revision) {\n                return;" },
  { id: 'J17', what: 'restore-original: root identity and marker not rechecked before reopening', file: G, find: "            requireMatching(row, identity(root), tenantId, storageId);\n            if (!marker(row).equals(readMarker(root))) {\n                throw WorkspaceExecutionStore.unavailable();\n            }\n            int changed = jdbc.update(\"UPDATE managed_workspace_execution_lease\"\n                    + \" SET mount_state = 'READY', mount_revision = mount_revision + 1,\"\n                    + \" mount_operation_id = NULL, mount_completed_operation_id = ?\"\n                    + \" WHERE storage_key = ? AND mount_state = 'FENCED'\"", to: "            int changed = jdbc.update(\"UPDATE managed_workspace_execution_lease\"\n                    + \" SET mount_state = 'READY', mount_revision = mount_revision + 1,\"\n                    + \" mount_operation_id = NULL, mount_completed_operation_id = ?\"\n                    + \" WHERE storage_key = ? AND mount_state = 'FENCED'\"" },
  { id: 'J18', what: 'restore-original: another operation may lift the fence', file: G, find: "                    || row.revision() != revision || !operationId.equals(row.operationId())\n                    || row.holderKey() != null", to: "                    || row.revision() != revision\n                    || row.holderKey() != null" },
  { id: 'J19', what: 'restore-original: completed retry does not revalidate identity / marker', file: G, find: "                    && operationId.equals(row.completedOperationId())) {\n                requireMatching(row, identity(root), tenantId, storageId);\n                if (!marker(row).equals(readMarker(root))) {\n                    throw WorkspaceExecutionStore.unavailable();\n                }\n                return;", to: "                    && operationId.equals(row.completedOperationId())) {\n                return;" },
  { id: 'J20', what: 'register: allowed while a holder is present (first transaction)', file: G, find: "            if (row == null || row.holderKey() != null || row.bindingId() != null\n                    || row.runtimeGeneration() != null || row.runtimeSessionId() != null\n                    || row.tenantId() != null && !tenantId.equals(row.tenantId())", to: "            if (row == null\n                    || row.tenantId() != null && !tenantId.equals(row.tenantId())" },
  { id: 'J21', what: 'register: a completed registration accepts a different operation id', file: G, find: "                if (!operationId.equals(row.completedOperationId())) {\n                    throw WorkspaceExecutionStore.unavailable();\n                }\n                requireMatching(row, identity, tenantId, storageId);\n                return row;", to: "                requireMatching(row, identity, tenantId, storageId);\n                return row;" },
  { id: 'J22', what: 'register: a completed-registration retry does not re-read the marker', file: G, find: "            requireMatching(prepared, identity(root), tenantId, storageId);\n            if (!marker.equals(readMarker(root))) {\n                throw WorkspaceExecutionStore.unavailable();\n            }\n            return;", to: "            return;" },
  { id: 'J23', what: 'register: an existing conflicting marker is accepted (not compared after link)', file: G, find: "            } catch (java.nio.file.FileAlreadyExistsException ignored) {\n                if (!expected.equals(readMarker(root))) {\n                    throw WorkspaceExecutionStore.unavailable();\n                }\n            }", to: "            } catch (java.nio.file.FileAlreadyExistsException ignored) {\n                // mutant\n            }" },
  { id: 'J24', what: 'register: final marker read-back removed', file: G, find: "        if (!expected.equals(readMarker(root))) {\n            throw WorkspaceExecutionStore.unavailable();\n        }\n    }\n\n    private static boolean validId", to: "    }\n\n    private static boolean validId" },
  { id: 'J25', what: 'passive attachment also verifies the physical mount', file: C, find: "            if (passiveManagedRuntimeRecovery) {\n                workspaceExecution.authorizePassiveAttachment(session);\n            } else {", to: "            if (false) {\n                workspaceExecution.authorizePassiveAttachment(session);\n            } else {" },
  { id: 'J26', what: 'passive operations (cancel / stream / rename) attach as new work', file: C, find: "                    !newWork && workspaceExecution.verifiedRecoveryEnabled());", to: "                    false);" },
  { id: 'J27', what: 'enabled guard does not require Linux', file: G, find: "        if (enabled && !\"Linux\".equals(System.getProperty(\"os.name\"))) {", to: "        if (false) {" },
  { id: 'J28', what: 'marker read follows symlinks and has no size bound', file: G, find: "            if (channel.size() > 4096) {\n                throw WorkspaceExecutionStore.unavailable();\n            }", to: "" },
  { id: 'J29', what: 'operation id need not be a canonical UUID', file: G, find: "            return value != null && UUID.fromString(value).toString().equals(value);", to: "            return value != null;" },
  { id: 'J30', what: 'register: final READY commit does not require the prepared operation', file: G, find: "            if (!\"UNVERIFIED\".equals(row.state()) || !operationId.equals(row.operationId())) {\n                throw WorkspaceExecutionStore.unavailable();\n            }\n            int changed", to: "            int changed" },
];
const [mode, ...rest] = process.argv.slice(2);
function apply(tree, m) {
  const f = path.join(tree, m.file); const orig = fs.readFileSync(f, 'utf8');
  const hits = orig.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`${m.id} anchor hits=${hits}`);
  fs.writeFileSync(f, orig.replace(m.find, m.to));
  return () => fs.writeFileSync(f, orig);
}
if (mode === 'check') {
  const tree = rest[0]; let bad = 0;
  for (const m of M) { const orig = fs.readFileSync(path.join(tree, m.file), 'utf8'); const hits = orig.split(m.find).length - 1; if (hits !== 1) { bad += 1; console.log(`${m.id} anchor hits=${hits}`); } }
  console.log(`${M.length} mutants, ${bad} anchor errors`);
} else if (mode === 'apply') {
  apply(rest[1], M.find((m) => m.id === rest[0])); console.log(`applied ${rest[0]}`);
} else if (mode === 'unit') {
  const W = '/m'; const O = '/rig/out/mut-java'; fs.mkdirSync(O, { recursive: true });
  const mvn = (log, extra = []) => {
    const r = spawnSync('mvn', ['-B', '-ntp', '-o', '-Dmaven.repo.local=/m2', '-Dcheckstyle.skip=true', ...extra, 'test'], { cwd: `${W}/packages/sdk-java/managed-agent-server`, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 900000 });
    const text = `${r.stdout}\n${r.stderr}`; fs.writeFileSync(`${O}/${log}.log`, text);
    const total = (text.match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+\s*$/m) ?? ['?'])[0].trim();
    const failed = [...text.matchAll(/\[ERROR\]\s+([A-Za-z0-9_.]+(?:Test|IT)\.[A-Za-z0-9_]+)[^\n]*/g)].map((x) => x[1].split('.').slice(-2).join('.'));
    const compile = /COMPILATION ERROR/.test(text);
    return { code: r.status, total, failed: [...new Set(failed)].slice(0, 6), compile };
  };
  const base = mvn('BASE'); console.log(`BASE exit=${base.code} ${base.total}`);
  if (base.code !== 0) { console.log('BASE is not green; stop'); process.exit(1); }
  const out = [];
  for (const m of M) {
    if (rest.length && !rest.includes(m.id)) continue;
    let undo; try { undo = apply(W, m); } catch (e) { console.log(String(e.message)); out.push({ id: m.id, what: m.what, result: 'anchor-error' }); continue; }
    let verdict; let detail = '';
    try {
      const a = mvn(`${m.id}-1`);
      if (a.compile) verdict = 'COMPILE-ERROR';
      else if (a.code === 0) verdict = 'SURVIVED';
      else { const b = mvn(`${m.id}-2`); verdict = b.code !== 0 ? 'KILLED' : 'FLAKY (failed once, passed on the rerun)'; detail = `${a.total}; ${a.failed.join(', ')}`; }
      if (verdict === 'SURVIVED') detail = a.total;
    } finally { undo(); }
    console.log(`${m.id} ${verdict.padEnd(9)} ${m.what} | ${detail}`);
    out.push({ id: m.id, what: m.what, verdict, detail });
    fs.writeFileSync(`${O}/unit.json`, JSON.stringify(out, null, 1));
  }
}
