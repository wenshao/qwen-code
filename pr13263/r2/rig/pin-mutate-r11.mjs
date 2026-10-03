// R1-1 cross-check: real-model-only reverts against the WHOLE script test file.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const WT = '/Users/wenshao/git/pr13263-head';
const M = '/Users/wenshao/git/pr13263-rig/pinmut';
const target = path.join(M, 'scripts/run-managed-agent-server-e2e.ts');
const head = readFileSync(path.join(WT, 'scripts/run-managed-agent-server-e2e.ts'), 'utf8');
const replace = (t, a, b) => { const n = t.split(a).length - 1; if (n !== 1) throw new Error(`anchor ${n}: ${a.slice(0, 80)}`); return t.replace(a, () => b); };
const auditStart = head.indexOf('    const executions = runMysql(');
const auditEnd = head.indexOf('    const replay = await fetch(');
if (auditStart < 0 || auditEnd < auditStart) throw new Error('audit block');
const mutants = {
  'Q0 head (control)': head,
  'Q1 tenantHeaders actor re-gated (M3 at runtime)': replace(head, '    [trustedActorHeader]: trustedActor,\n  };', '    ...(workspaceTurns ? { [trustedActorHeader]: trustedActor } : {}),\n  };'),
  'Q2 sideEffect back under workspace (M4b at runtime)': replace(head, 'const sideEffect = path.join(workspaceMount, sideEffectName);', 'const sideEffect = path.join(workspace, sideEffectName);'),
  'Q3 execution audit deleted': head.slice(0, auditStart) + head.slice(auditEnd),
  'Q4 real-model create unbound (no workspace)': replace(head, '      workspace: { workspace_id: boundWorkspaceId },\n      metadata: { title: \'Real model cold Runtime E2E\' },', '      metadata: { title: \'Real model cold Runtime E2E\' },'),
};
const out = [];
for (const [name, text] of Object.entries(mutants)) {
  writeFileSync(target, text);
  const r = spawnSync(path.join(M, 'node_modules/.bin/vitest'), ['run', '--config', 'scripts/tests/vitest.config.ts', 'scripts/tests/managed-agent-server-e2e.test.js'], { cwd: M, encoding: 'utf8', env: { ...process.env, CI: '1' } });
  const o = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const m = o.match(/Tests\s+([^\n]+)/);
  const line = `${name}\t${m ? m[1].trim() : 'INVALID'}`;
  out.push(line); console.log(line);
}
writeFileSync('/Users/wenshao/git/pr13263-rig/r2/pin-mutants-r11.txt', out.join('\n') + '\n');
