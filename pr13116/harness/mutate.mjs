// VERIFICATION RIG ONLY (PR 13116). Applies exactly one production mutation to a
// rig worktree, or restores it. Every edit must match its anchor exactly once,
// otherwise the script exits non-zero, so a mutation that did not apply can
// never be counted as a survivor.
// usage: node mutate.mjs <worktree dir> <mutant id | restore | list>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [, , tree, id] = process.argv;
const MAIN = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent';
const PROPS = `${MAIN}/config/ManagedAgentProperties.java`;
const CONN = `${MAIN}/harness/QwenHostedHarnessConnector.java`;
const RBE = 'com.alibaba.qwen.code.runtimebroker.RuntimeBrokerException';
const AUTH = 'workspaceExecution.authorize(session);';
const PUT = 'attachments.put(key, attached);';

const wrap = (handler) => [[AUTH, `try { ${AUTH} } ${handler}`]];
export const MUTANTS = {
  P1: { file: PROPS, what: '@PostConstruct removed from validateWorkspaceFiles (issue #13047 AC3)',
    edits: [['    @PostConstruct\n    void validateWorkspaceFiles()', '    void validateWorkspaceFiles()']] },
  P2: { file: PROPS, what: 'isolation-class clause removed from the G0 predicate',
    edits: [['|| !"session".equals(runtimeBroker.getIsolationClass())', '']] },
  C1: { file: CONN, what: 'catch-and-ignore RuntimeBrokerException around the recheck (issue #13048 AC3)',
    edits: wrap(`catch (${RBE} ignored) { }`) },
  C2: { file: CONN, what: 'catch-and-ignore any RuntimeException around the recheck',
    edits: wrap('catch (RuntimeException ignored) { }') },
  C3: { file: CONN, what: 'any failure remapped to unavailable() (bot R1-2 mutant i)',
    edits: wrap('catch (RuntimeException e) { throw com.alibaba.qwen.code.managedagent.store.WorkspaceExecutionStore.unavailable(); }') },
  C4: { file: CONN, what: 'refusal rethrown with same status/code/retryable, new message (bot R1-2 mutant ii)',
    edits: wrap(`catch (${RBE} e) { throw new ${RBE}(e.getStatusCode(), e.getCode(), "Hosted Workspace refused this session", e.isRetryable()); }`) },
  C5: { file: CONN, what: 'recheck moved after the attachment is created/loaded and cached (bot R1-1 mutant A)',
    edits: [[`            ${AUTH}\n`, ''], [`        ${PUT}\n`, `        ${PUT}\n        if (session.workspace() != null) { ${AUTH} }\n`]] },
  C6: { file: CONN, what: 'refusal rewrapped as IllegalStateException (coordinator would retry it)',
    edits: wrap(`catch (${RBE} e) { throw new IllegalStateException(e.getMessage(), e); }`) },
  C7: { file: CONN, what: 'refusal made retryable',
    edits: wrap(`catch (${RBE} e) { throw new ${RBE}(e.getStatusCode(), e.getCode(), e.getMessage(), true); }`) },
  C8: { file: CONN, what: 'refusal status changed 409 -> 503',
    edits: wrap(`catch (${RBE} e) { throw new ${RBE}(503, e.getCode(), e.getMessage(), e.isRetryable()); }`) },
  C9: { file: CONN, what: 'recheck deleted',
    edits: [[`            ${AUTH}\n`, '']] },
};

if (id === 'list') {
  for (const [k, v] of Object.entries(MUTANTS)) console.log(`${k}\t${v.what}`);
  process.exit(0);
}
if (id === 'restore') {
  execFileSync('git', ['-C', tree, 'checkout', '--', MAIN], { stdio: 'inherit' });
  const dirty = execFileSync('git', ['-C', tree, 'status', '--porcelain', '--', MAIN]).toString().trim();
  if (dirty) { console.error(`restore left changes:\n${dirty}`); process.exit(2); }
  console.log(`restored ${path.basename(tree)} (production tree clean)`);
  process.exit(0);
}
const m = MUTANTS[id];
if (!m) { console.error(`unknown mutant ${id}`); process.exit(2); }
const file = path.join(tree, m.file);
let src = readFileSync(file, 'utf8');
let edits = m.edits;
// main after #13088 (afb911a3): createOrLoad authorizes in an else-branch next to the passive
// path, and requireReadyForNewWork has a second authorize(session). Anchor on createOrLoad's.
if (m.file === CONN && src.includes('workspaceExecution.authorizePassiveAttachment(session);')) {
  const TAIL = '\n            }\n        }\n        AttachmentKey key';
  if (id === 'C5') {
    edits = [['            } else {\n                ' + AUTH + '\n            }\n', '            }\n'],
      [`        ${PUT}\n`, `        ${PUT}\n        if (session.workspace() != null && !passiveManagedRuntimeRecovery) { ${AUTH} }\n`]];
  } else if (id === 'C9') {
    edits = [['            } else {\n                ' + AUTH + '\n            }\n', '            }\n']];
  } else {
    edits = m.edits.map(([from, to]) => [from + TAIL, to + TAIL]);
  }
}
for (const [from, to] of edits) {
  const n = src.split(from).length - 1;
  if (n !== 1) { console.error(`${id}: anchor ${JSON.stringify(from)} matched ${n} times, expected 1`); process.exit(3); }
  src = src.replace(from, to);
}
writeFileSync(file, src);
const stat = execFileSync('git', ['-C', tree, 'diff', '--numstat', '--', MAIN]).toString().trim();
console.log(`applied ${id} (${m.what}) -> ${stat.replace(/\s+/g, ' ')}`);
