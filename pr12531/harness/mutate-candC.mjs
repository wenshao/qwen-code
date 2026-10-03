// Mutation check for candidate C (restrictive-only cut-registration fallback).
// Each mutant rewrites one clause of candC's rule-parser.ts, asserts the rewrite took effect,
// runs the 4 permission suites, records killed/survived, and restores the pristine file.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CORE = '/Users/wenshao/git/verify-pr12531/candC/packages/core';
const FILE = `${CORE}/src/permissions/rule-parser.ts`;
const pristine = fs.readFileSync(FILE, 'utf8');
const SUITES = [
  'src/permissions/mcp-cut-registration.test.ts',
  'src/permissions/mcp-server-rule-collision.test.ts',
  'src/permissions/permission-manager.test.ts',
  'src/permissions/rule-parser.test.ts',
];
const MUTANTS = [
  ['m1 drop fallback in matchesRule', (s) => s.replace(
    /\|\|\s*matchesRestrictiveCutRegistration\(\s*rule\.toolName,\s*canonicalCtxToolName,\s*mcpIdentity,\s*\)\)\);/,
    '));')],
  ['m2 drop fallback in matchesToolPattern', (s) => s.replace(
    /matchesRestrictiveMcpName\(pattern, mcpIdentity\) \|\|\s*matchesRestrictiveCutRegistration\(pattern, toolName, mcpIdentity\)/,
    'matchesRestrictiveMcpName(pattern, mcpIdentity)')],
  ['m3 drop the cut test (any registration)', (s) => s.replace(
    '!toolName.startsWith(registeredServerPrefix) &&', '')],
  ['m4 drop the mcp__ guard (bare `*`)', (s) => s.replace(
    "!pattern.startsWith('mcp__') ||", '')],
  ['m5 cut test on the raw key, not its registered rendering', (s) => s.replace(
    "identity.serverName.replace(/[^A-Za-z0-9_-]/g, '_')", 'identity.serverName')],
  ['m6 fallback also grants (outside `restrictive`)', (s) => s.replace(
    /\|\|\s*matchesAdvertisedExactName\(rule\.toolName, toolAliases, rawMcpToolName\) \|\|/,
    '|| matchesAdvertisedExactName(rule.toolName, toolAliases, rawMcpToolName) || matchesRestrictiveCutRegistration(rule.toolName, canonicalCtxToolName, mcpIdentity) ||')],
  ['m7 drop the wildcard guard', (s) => s.replace(
    "||\n    !pattern.endsWith('*')", '')],
];

const results = [];
try {
  for (const [name, mutate] of MUTANTS) {
    const mutated = mutate(pristine);
    if (mutated === pristine) { results.push({ name, status: 'NOT-APPLIED' }); console.log(`${name}: NOT-APPLIED`); continue; }
    fs.writeFileSync(FILE, mutated);
    const r = spawnSync('npx', ['vitest', 'run', ...SUITES], { cwd: CORE, encoding: 'utf8', env: process.env });
    const out = r.stdout + r.stderr;
    const tests = /Tests\s+(.*)/.exec(out)?.[1]?.trim() ?? '?';
    const failed = [...out.matchAll(/^ FAIL .*?> (.*)$/gm)].map((m) => m[1]).slice(0, 4);
    const status = r.status === 0 ? 'SURVIVED' : 'KILLED';
    results.push({ name, status, tests, failed });
    console.log(`${name}: ${status} (${tests})${failed.length ? '\n   e.g. ' + failed.join('\n   e.g. ') : ''}`);
  }
} finally {
  fs.writeFileSync(FILE, pristine);
}
const back = spawnSync('npx', ['vitest', 'run', ...SUITES], { cwd: CORE, encoding: 'utf8', env: process.env });
console.log(`pristine after restore: exit=${back.status} ${/Tests\s+(.*)/.exec(back.stdout + back.stderr)?.[1]?.trim()}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
