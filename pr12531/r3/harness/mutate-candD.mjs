// Mutation check for candidate D (restrictive registered-prefix fallback: R18-1 cut + F13 own boundary).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CORE = process.env.CORE ?? '/Users/wenshao/git/verify-pr12531/candD/packages/core';
const FILE = `${CORE}/src/permissions/rule-parser.ts`;
const pristine = fs.readFileSync(FILE, 'utf8');
const SUITES = [
  'src/permissions/mcp-cut-registration.test.ts',
  'src/permissions/mcp-server-rule-collision.test.ts',
  'src/permissions/permission-manager.test.ts',
  'src/permissions/rule-parser.test.ts',
];
const MUTANTS = [
  ['d1 drop the F13 own-boundary disjunct', (s) => s.replace(
    /\(!toolName\.startsWith\(registeredServerPrefix\) \|\|\s*prefix\.startsWith\(registeredServerPrefix\)\)/,
    '!toolName.startsWith(registeredServerPrefix)')],
  ['d2 drop the R18-1 cut disjunct', (s) => s.replace(
    /\(!toolName\.startsWith\(registeredServerPrefix\) \|\|\s*prefix\.startsWith\(registeredServerPrefix\)\)/,
    'prefix.startsWith(registeredServerPrefix)')],
  ['d3 any literal prefix of the registered name', (s) => s.replace(
    /\(!toolName\.startsWith\(registeredServerPrefix\) \|\|\s*prefix\.startsWith\(registeredServerPrefix\)\)/,
    'true')],
  ['d4 drop the literal-prefix requirement', (s) => s.replace(
    /toolName\.startsWith\(prefix\) &&\s*\(/, '(')],
  ['d5 own boundary on the raw key, not its rendering', (s) => s.replace(
    "identity.serverName.replace(/[^A-Za-z0-9_-]/g, '_')", 'identity.serverName')],
  ['d6 fallback also grants (outside `restrictive`)', (s) => s.replace(
    /\|\|\s*matchesAdvertisedExactName\(rule\.toolName, toolAliases, rawMcpToolName\) \|\|/,
    '|| matchesAdvertisedExactName(rule.toolName, toolAliases, rawMcpToolName) || matchesRestrictiveRegisteredPrefix(rule.toolName, canonicalCtxToolName, mcpIdentity) ||')],
  ['d7 drop fallback in matchesToolPattern', (s) => s.replace(
    /matchesRestrictiveMcpName\(pattern, mcpIdentity\) \|\|\s*matchesRestrictiveRegisteredPrefix\(pattern, toolName, mcpIdentity\)/,
    'matchesRestrictiveMcpName(pattern, mcpIdentity)')],
  ['d8 drop fallback in matchesRule', (s) => s.replace(
    /\|\|\s*matchesRestrictiveRegisteredPrefix\(\s*rule\.toolName,\s*canonicalCtxToolName,\s*mcpIdentity,\s*\)\)\);/,
    '));')],
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
    const failed = [...out.matchAll(/^ FAIL .*?> (.*)$/gm)].map((m) => m[1]).slice(0, 3);
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
