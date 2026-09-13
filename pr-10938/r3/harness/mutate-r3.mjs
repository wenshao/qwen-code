// Round-3 mutation check for d91a0f7e74 (layer-skipping lane shoulders) + M20 re-run.
// Exact original bytes are written back after every mutant; worktree must end clean.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const WT = '/var/tmp/pr10938-wt';
const WS = `${WT}/packages/web-shell`;
const PEV = `${WS}/client/components/messages/PlanExecutionView.tsx`;
const T = 'client/components/messages/PlanExecutionView.test.tsx';
const DROP = '(nextLayerLeft - 4 - edge.startX) / 2,';
const RISE = '(edge.endX - prevLayerRight - 4) / 2,';
const CORNER = 'const corner = Math.min(\n          EDGE_CORNER,\n          dropShoulder / 2,\n          riseShoulder / 2,\n        );';
const MUTANTS = [
  ['M22 both shoulders back to fixed 24px (the round-2 defect)', [[DROP, 'Number.POSITIVE_INFINITY,'], [RISE, 'Number.POSITIVE_INFINITY,']]],
  ['M23 corner not halved (min(6, shoulder))', [['dropShoulder / 2,\n          riseShoulder / 2,', 'dropShoulder,\n          riseShoulder,']]],
  ['M24 run not halved (shoulder = min(24, run), segment hugs the far side)', [[DROP, 'nextLayerLeft - 4 - edge.startX,'], [RISE, 'edge.endX - prevLayerRight - 4,']]],
  ['M25 drop measured against its own layer', [['layerBounds.get(sourceLayer + 1)', 'layerBounds.get(sourceLayer)']]],
  ['M26 rise measured against its own layer', [['layerBounds.get(targetLayer - 1)', 'layerBounds.get(targetLayer)']]],
  ['M27 corner back to the EDGE_CORNER constant', [[CORNER, 'const corner = EDGE_CORNER;']]],
  ['M28 only the rise fixed (drop keeps 24px)', [[DROP, 'Number.POSITIVE_INFINITY,']]],
  ['M29 only the drop fixed (rise keeps 24px)', [[RISE, 'Number.POSITIVE_INFINITY,']]],
  ['M20 toolUseId dedup dropped (re-run from round 2)', [[/nestedAgentToolsForTool\(tool\)\.filter\(\s*\(\{ tool: nested \}\) => !liveCallIds\.has\(nested\.callId\),\s*\)/, 'nestedAgentToolsForTool(tool)']]],
];
const results = [];
for (const [name, edits] of MUTANTS) {
  const orig = fs.readFileSync(PEV, 'utf8');
  let mutated = orig;
  let applied = true;
  for (const [from, to] of edits) {
    const next = typeof from === 'string' ? (mutated.split(from).length === 2 ? mutated.replace(from, to) : null) : mutated.replace(from, to);
    if (next === null || next === mutated) { applied = false; break; }
    mutated = next;
  }
  if (!applied) { results.push({ name, status: 'NOT-APPLIED' }); console.log(name, 'NOT-APPLIED'); continue; }
  fs.writeFileSync(PEV, mutated);
  let out = '', red = false;
  try { out = execSync(`npx vitest run ${T} 2>&1`, { cwd: WS, encoding: 'utf8', timeout: 300000, env: { ...process.env, PATH: `${WT}/node_modules/.bin:${process.env.PATH}` } }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); red = true; }
  finally { fs.writeFileSync(PEV, orig); }
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (clean.match(/Tests\s+[^\n]+/) || [''])[0].trim();
  const failed = [...new Set([...clean.matchAll(/(?:FAIL|×)\s+[^\n]*?>\s*([^\n]+)/g)].map((m) => m[1].trim().slice(0, 120)))].slice(0, 4);
  const assertion = (clean.match(/AssertionError[^\n]*/) || [null])[0];
  results.push({ name, status: red ? 'KILLED' : 'SURVIVED', summary, failed, assertion: assertion?.slice(0, 220) });
  console.log(`${red ? 'KILLED  ' : 'SURVIVED'} ${name} | ${summary} | ${failed[0] || ''} | ${assertion || ''}`);
}
fs.writeFileSync('/root/git/pr10938-harness/r3/out/mutants-r3.json', JSON.stringify(results, null, 2));
const dirty = execSync('git status --porcelain', { cwd: WT, encoding: 'utf8' });
console.log('worktree clean after restore:', dirty.trim() === '' ? 'yes' : dirty);
