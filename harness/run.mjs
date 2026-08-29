#!/usr/bin/env node
/**
 * Differential runner for the heredoc permission projection (#9417 / #9381).
 *
 *   node harness/run.mjs --arm main=/path/to/main-worktree \
 *                        --arm pr=/path/to/pr-worktree \
 *                        [--fuzz 1500] [--out ./out]
 *
 * Each --arm path must be a qwen-code checkout with packages/core built
 * (`npm run build --workspace @qwen-code/qwen-code-core`).
 *
 * The acceptance bar this measures:
 *   1. no NEW silent auto-approval of a command bash really executes,
 *      relative to the main arm  (security, must be 0)
 *   2. the #9381 shapes auto-allow under a matching prefix rule  (the fix)
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS, PAYLOAD } from './corpus.mjs';
import { generate } from './fuzz.mjs';
import { createSandbox, runOne } from './ground-truth.mjs';

const args = process.argv.slice(2);
const arms = [];
let fuzzCount = 1500;
let outDir = path.resolve('out');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--arm') {
    const [name, dir] = args[++i].split('=');
    arms.push({ name, dir: path.resolve(dir) });
  } else if (args[i] === '--fuzz') fuzzCount = Number(args[++i]);
  else if (args[i] === '--out') outDir = path.resolve(args[++i]);
}
if (arms.length === 0) {
  console.error('usage: node run.mjs --arm <name>=<worktree> [--arm …] [--fuzz N] [--out DIR]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// A realistic permissive-but-guarded config: everything in the corpus that is
// not the payload is allowed, and the payload is explicitly denied. A verdict
// of `allow` on a command that really executes the payload therefore means the
// deny rule was bypassed with no prompt shown at all.
const ALLOW = [
  'cat', 'python', 'python3', 'head', 'tee', 'node', 'perl', 'ruby', 'awk', 'sort',
  'echo', 'bash', 'sh', 'zsh', 'dash', 'nice', 'sudo', 'busybox', 'xargs', 'env',
  'cd', 'true', 'command', 'exec', 'shopt', 'alias', 'hash', 'eval', 'function',
  'unknowncmd',
].map((c) => `Bash(${c} *)`);
const DENY = [`Bash(${PAYLOAD} *)`];

const makeConfig = (allow, deny) => ({
  getPermissionsAllow: () => allow,
  getPermissionsAsk: () => undefined,
  getPermissionsDeny: () => deny,
  getCoreTools: () => undefined,
  getRegistryAllowList: () => allow,
  getProjectRoot: () => '/project',
  getCwd: () => '/project',
  // Rule evaluation only: `auto` routes some commands through the classifier
  // and would measure that instead of the rules.
  getApprovalMode: () => 'default',
});

async function loadArm({ name, dir }) {
  const entry = path.join(dir, 'packages/core/dist/index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`${name}: ${entry} missing — build core in that worktree first`);
  }
  const core = await import(entry);
  const guarded = new core.PermissionManager(makeConfig(ALLOW, DENY));
  guarded.initialize();
  const denyOnly = new core.PermissionManager(makeConfig(undefined, DENY));
  denyOnly.initialize();
  return { name, dir, core, guarded, denyOnly };
}

const loaded = [];
for (const a of arms) loaded.push(await loadArm(a));

// ── phase 1: hand corpus ───────────────────────────────────────────────────
const sandbox = createSandbox(path.join(outDir, 'sandbox'));
const truth = new Map();
for (const { id, command } of CORPUS) truth.set(id, runOne(sandbox, command));

const rows = [];
for (const arm of loaded) {
  const holes = [];
  const denyMisses = [];
  for (const { id, command } of CORPUS) {
    const gt = truth.get(id);
    if (!gt.executesPayload) continue;
    const guarded = await arm.guarded.evaluate({ toolName: 'run_shell_command', command });
    const denyOnly = await arm.denyOnly.evaluate({ toolName: 'run_shell_command', command });
    if (guarded === 'allow') holes.push({ id, command, segments: arm.core.splitCompoundCommand(command) });
    if (denyOnly !== 'deny') denyMisses.push(id);
  }
  // Usability: inert heredocs fed to a known interpreter, under a rule that
  // names that exact interpreter.
  const inert = CORPUS.filter(
    (c) => !truth.get(c.id).executesPayload && /^(cat|python|python3|node|head|tee) /.test(c.command),
  );
  let autoAllowed = 0;
  for (const { command } of inert) {
    const recv = command.split(/\s/)[0];
    const pm = new arm.core.PermissionManager(makeConfig([`Bash(${recv} *)`], undefined));
    pm.initialize();
    if ((await pm.evaluate({ toolName: 'run_shell_command', command })) === 'allow') autoAllowed++;
  }
  rows.push({ arm: arm.name, holes, denyMisses, autoAllowed, inertTotal: inert.length });
}

// ── phase 2: fuzz ──────────────────────────────────────────────────────────
const fuzzCases = generate(fuzzCount);
const fuzzTruth = new Map();
for (const { id, command } of fuzzCases) fuzzTruth.set(id, runOne(sandbox, command));
const executing = fuzzCases.filter((c) => fuzzTruth.get(c.id).executesPayload);

const fuzzRows = [];
for (const arm of loaded) {
  const holes = [];
  for (const { id, command } of executing) {
    if ((await arm.guarded.evaluate({ toolName: 'run_shell_command', command })) === 'allow') {
      holes.push({ id, command, segments: arm.core.splitCompoundCommand(command) });
    }
  }
  fuzzRows.push({ arm: arm.name, holes });
}

// ── report ─────────────────────────────────────────────────────────────────
const baseline = rows[0].arm;
const baseHandIds = new Set(rows[0].holes.map((h) => h.id));
const baseFuzzIds = new Set(fuzzRows[0].holes.map((h) => h.id));

console.log(`\nhand corpus: ${CORPUS.length} commands, bash executes the marker in ${[...truth.values()].filter((t) => t.executesPayload).length}`);
console.table(rows.map((r) => ({
  arm: r.arm,
  'deny rule missed': r.denyMisses.length,
  'denied cmd auto-run, no prompt': r.holes.length,
  [`new vs ${baseline}`]: r.holes.filter((h) => !baseHandIds.has(h.id)).length,
  'inert heredoc auto-allowed': `${r.autoAllowed}/${r.inertTotal}`,
})));

console.log(`\nfuzz: ${fuzzCount} generated commands, bash executes the marker in ${executing.length}`);
console.table(fuzzRows.map((r) => ({
  arm: r.arm,
  'silently auto-approved': r.holes.length,
  [`new vs ${baseline}`]: r.holes.filter((h) => !baseFuzzIds.has(h.id)).length,
  [`fixed vs ${baseline}`]: [...baseFuzzIds].filter((id) => !r.holes.some((h) => h.id === id)).length,
})));

fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ hand: rows, fuzz: fuzzRows }, null, 2));
console.log(`\nfull detail → ${path.join(outDir, 'result.json')}`);

const regressions =
  rows.slice(1).some((r) => r.holes.some((h) => !baseHandIds.has(h.id))) ||
  fuzzRows.slice(1).some((r) => r.holes.some((h) => !baseFuzzIds.has(h.id)));
if (regressions) {
  console.error('\nFAIL: an arm silently auto-approves a command the baseline did not.');
  process.exit(1);
}
console.log('\nPASS: no arm introduces a new silent auto-approval relative to the baseline.');
