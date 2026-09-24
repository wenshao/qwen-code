import fs from 'node:fs'; import { execSync } from 'node:child_process';
const WT = process.cwd() + '/wt-r5';
const muts = [
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M1 limit 2→100', 'activeAppToolCalls < 2', 'activeAppToolCalls < 100'],
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M2 release does not start next', '          next();\n', '\n'],
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M3 cancel keeps waiter in set', '      waitingAppToolCalls.delete(start);\n      reject', '      reject'],
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M4 no throwIfAborted after acquire', '          signal.throwIfAborted();\n', '\n'],
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M5 slot never released', '          releaseSlot?.();\n', '\n'],
 ['web', 'packages/web-shell/client/components/messages/McpApp.tsx', 'M6 per-card instead of page-wide (reset counter per mount)', '    const appAbort = new AbortController();\n', '    const appAbort = new AbortController();\n    activeAppToolCalls = 0;\n'],
 ['core', 'packages/core/src/tools/mcp-tool.ts', 'M7 App path honours guard again', 'if (!this.onAppResult && this.cliConfig?.getToolInvocationGuard?.())', 'if (this.cliConfig?.getToolInvocationGuard?.())'],
];
const tests = { web: ['packages/web-shell', 'client/components/messages/McpApp.dom.test.tsx'], core: ['packages/core', 'src/tools/mcp-tool.test.ts'] };
const out = [];
for (const [pkg, file, name, from, to] of muts) {
  const p = `${WT}/${file}`; const orig = fs.readFileSync(p, 'utf8');
  if (!orig.includes(from)) { out.push({ name, status: 'PATTERN NOT FOUND' }); continue; }
  const mutated = orig.replace(from, to); if (mutated === orig) { out.push({ name, status: 'NO CHANGE' }); continue; }
  fs.writeFileSync(p, mutated);
  let res;
  try { res = execSync(`npx vitest run ${tests[pkg][1]} 2>&1`, { cwd: `${WT}/${tests[pkg][0]}`, encoding: 'utf8', maxBuffer: 1e8 }); }
  catch (e) { res = e.stdout; }
  fs.writeFileSync(p, orig);
  const line = (res.match(/Tests\s+.*$/m) || ['?'])[0];
  const failed = [...res.matchAll(/(?:×|FAIL)\s+(.*?)(?:\s+\d+ms)?$/gm)].map(m => m[1]).filter(s => !s.includes('.tsx') && !s.includes('.ts ')).slice(0, 4);
  out.push({ name, tests: line.trim(), killedBy: failed });
  console.log(name, '->', line.trim());
}
fs.writeFileSync('r5/mutation.json', JSON.stringify(out, null, 1));
