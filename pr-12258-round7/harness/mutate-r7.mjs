import fs from 'node:fs'; import { execSync } from 'node:child_process';
const WT = process.argv[2];
const APP = 'packages/web-shell/client/components/messages/McpApp.tsx';
const TOOL = 'packages/core/src/tools/mcp-tool.ts';
const muts = [
 ['core', TOOL, 'M1 drop ceiling branch (R8-1)', "Number.isFinite(configuredTimeoutMs)) ||\n        defaultTimeoutMs === MCP_APP_RESOURCE_TIMEOUT_DEFAULT_MS", "Number.isFinite(configuredTimeoutMs))"],
 ['core', TOOL, 'M2 invert ceiling comparison', 'defaultTimeoutMs === MCP_APP_RESOURCE_TIMEOUT_DEFAULT_MS', 'defaultTimeoutMs !== MCP_APP_RESOURCE_TIMEOUT_DEFAULT_MS'],
 ['web', APP, 'M3 failInitialization: no generation guard', "      if (!active || mountGenerationRef.current !== generation) return;\n      active = false;", "      active = false;"],
 ['web', APP, 'M4 failInitialization: keep oncalltool', "      clearTimeout(readyTimeout);\n      bridge.oncalltool = undefined;\n      appAbort.abort();\n      iframe.removeAttribute('src');", "      clearTimeout(readyTimeout);\n      appAbort.abort();\n      iframe.removeAttribute('src');"],
 ['web', APP, 'M5 failInitialization: no clearTimeout', "      active = false;\n      clearTimeout(readyTimeout);\n      bridge.oncalltool = undefined;\n      appAbort.abort();\n      iframe.removeAttribute('src');", "      active = false;\n      bridge.oncalltool = undefined;\n      appAbort.abort();\n      iframe.removeAttribute('src');"],
 ['web', APP, 'M6 input/result catch back to setError', "        .then(() => {\n          if (active) return bridge.sendToolResult(resource.toolResult);\n        })\n        .catch(failInitialization);", "        .then(() => {\n          if (active) return bridge.sendToolResult(resource.toolResult);\n        })\n        .catch((reason: unknown) => setError(String(reason)));"],
 ['web', APP, 'M7 no active check before sendToolResult', "          if (active) return bridge.sendToolResult(resource.toolResult);", "          return bridge.sendToolResult(resource.toolResult);"],
 ['web', APP, 'M8 sandbox-resource catch back to setError', "          ...(resource.csp ? { csp: resource.csp } : {}),\n        })\n        .catch(failInitialization);", "          ...(resource.csp ? { csp: resource.csp } : {}),\n        })\n        .catch((reason: unknown) => setError(String(reason)));"],
 ['web', APP, 'M9 connect catch back to setError', "        if (active) iframe.src = sandboxUrl;\n      })\n      .catch(failInitialization);", "        if (active) iframe.src = sandboxUrl;\n      })\n      .catch((reason: unknown) => setError(String(reason)));"],
 ['web', APP, 'M10 cleanup keeps oncalltool', "      clearTimeout(readyTimeout);\n      bridge.oncalltool = undefined;\n      appAbort.abort();\n      bridgeRef.current = null;\n      const unload", "      clearTimeout(readyTimeout);\n      appAbort.abort();\n      bridgeRef.current = null;\n      const unload"],
];
const tests = { web: ['packages/web-shell', 'client/components/messages/McpApp.dom.test.tsx client/components/messages/McpApp.test.ts'], core: ['packages/core', 'src/tools/mcp-tool.test.ts'] };
const out = [];
for (const [pkg, file, name, from, to] of muts) {
  const p = `${WT}/${file}`; const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(from).length - 1;
  if (n !== 1) { out.push({ name, status: `PATTERN COUNT ${n}` }); console.log(name, 'PATTERN COUNT', n); continue; }
  fs.writeFileSync(p, orig.replace(from, to));
  let res;
  try { res = execSync(`npx vitest run ${tests[pkg][1]} 2>&1`, { cwd: `${WT}/${tests[pkg][0]}`, encoding: 'utf8', maxBuffer: 1e8 }); }
  catch (e) { res = e.stdout; }
  finally { fs.writeFileSync(p, orig); }
  const line = (res.match(/Tests\s+.*$/m) || ['?'])[0].trim();
  const failed = [...res.matchAll(/^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)].map(m => m[1].trim()).filter(s => !/\.(tsx?)\s*$/.test(s)).slice(0, 4);
  out.push({ name, tests: line, killedBy: failed });
  console.log(name, '->', line, failed.length ? '| ' + failed.slice(0, 2).join(' || ').slice(0, 220) : '');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
