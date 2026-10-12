// VERIFICATION RIG ONLY (PR #13973): one-line mutants of the PR's new logic, each run against the
// PR's 8 focused test files in an isolated worktree (src-mut). Baseline first.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const W = '/Users/wenshao/pr13973-rig/src-mut/packages/web-shell';
const C = `${W}/client`;
const FILES = ['components/ChatEditor.test.tsx', 'components/WorkspaceSelector.test.tsx', 'components/managed/ManagedSessionsPage.test.tsx', 'components/managed/WorkspaceBindingCreator.test.tsx', 'components/managed/java-managed-agent-provider.test.ts', 'components/managed/managed-development-options.test.ts', 'hooks/useComposerCore.dom.test.tsx', 'ManagedAgentWebShell.test.tsx'];
const M = [
  ['M1 provider: accept a first-input admission without turnId', 'components/managed/java-managed-agent-provider.ts', 'if (!result.sessionId || (request.text !== undefined && !result.turnId))', 'if (!result.sessionId)'],
  ['M2 creator: skip read-back agentId (model) check', 'components/managed/WorkspaceBindingCreator.tsx', 'session.agentId !== attempt.agentId) ||', 'false) ||'],
  ['M3 creator: never clear the editor after admission', 'components/managed/WorkspaceBindingCreator.tsx', 'if (acceptedCommit.current) acceptedCommit.current();', 'if (false) acceptedCommit.current();'],
  ['M4 creator: no "Choose a Workspace" error on first input', 'components/managed/WorkspaceBindingCreator.tsx', "if (text !== undefined) setError(t('managed.workspaceChoose'));", ';'],
  ['M5 creator: Abandon does not restore the first input', 'components/managed/WorkspaceBindingCreator.tsx', 'if (initial) editor.current?.setText(initial.text);', ';'],
  ['M6 page: do not clear stored drafts after admission', 'components/managed/ManagedSessionsPage.tsx', 'if (draft !== undefined) clearComposerDraftIfMatches(draftKey, draft);', ';'],
  ['M7 page: clear the visible editor regardless of owning Session', 'components/managed/ManagedSessionsPage.tsx', 'selection.current === attempt.sessionId &&', 'true &&'],
  ['M8 page: drop draftText capture', 'components/managed/ManagedSessionsPage.tsx', 'draftText: composerRef.current?.getText(),', 'draftText: undefined,'],
  ['M9 page: Discard does not put text back into the editor', 'components/managed/ManagedSessionsPage.tsx', 'composerRef.current?.setText(pending.text);', ';'],
  ['M10 page: Retry button does nothing', 'components/managed/ManagedSessionsPage.tsx', 'onClick={() => void submit()}', 'onClick={() => undefined}'],
  ['M11 composer: "!" toggles shell even when disabled', 'hooks/useComposerCore.ts', 'insert === \'!\' &&\n            shellModeEnabledRef.current &&', 'insert === \'!\' &&\n            true &&'],
  ['M12 composer: "?" swallowed without a handler', 'hooks/useComposerCore.ts', 'insert === \'?\' &&\n            onToggleShortcutsRef.current &&', 'insert === \'?\' &&\n            true &&'],
  ['M13 composer: global "!" keydown toggles shell when disabled', 'hooks/useComposerCore.ts', "event.key === '!' &&\n        shellModeEnabledRef.current &&", "event.key === '!' &&\n        true &&"],
  ['M14 editor: shell toolbar button shown when disabled', 'components/ChatEditor.tsx', '{shellModeEnabled && (core.shellMode || !showAddMenuAction) && (', '{(core.shellMode || !showAddMenuAction) && ('],
  ['M15 selector: alwaysVisible ignored', 'components/WorkspaceSelector.tsx', '!alwaysVisible &&', 'true &&'],
  ['M16 standalone: no scoped shell frame/theme class', 'ManagedAgentWebShell.tsx', '${shellStyles.app} ', ''],
  ['M17 dev options: duplicate preset agentIds accepted', 'components/managed/managed-development-options.ts', 'new Set(modelPresets.map((item) => item.agentId)).size !==', 'modelPresets.length !=='],
];
function run() {
  const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.config.ts', ...FILES], { cwd: W, encoding: 'utf8', maxBuffer: 64 << 20 });
  const txt = r.stdout + r.stderr;
  const tests = (txt.match(/Tests\s+([^\n]+)/) ?? [])[1] ?? '?';
  return { exit: r.status, tests: tests.replace(/\x1b\[[0-9;]*m/g, '').trim() };
}
const results = [];
const base = run();
console.log('BASELINE', JSON.stringify(base));
if (base.exit !== 0) process.exit(1);
for (const [name, file, from, to] of M) {
  const p = `${C}/${file}`;
  const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { console.log(`SKIP ${name}: pattern count ${n}`); results.push({ name, skipped: n }); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  const r = run();
  fs.writeFileSync(p, orig);
  const killed = r.exit !== 0;
  console.log(`${killed ? 'KILLED ' : 'SURVIVED'} ${name} :: ${r.tests}`);
  results.push({ name, killed, ...r });
}
fs.writeFileSync('/Users/wenshao/pr13973-rig/results/mutants.json', JSON.stringify({ base, results }, null, 2));
const k = results.filter((r) => r.killed).length;
console.log(`MUTANTS killed ${k}/${results.filter((r) => r.skipped === undefined).length}`);
