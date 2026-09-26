// Mutation matrix over packages/core/src/tools/mcp-client.ts at PR head; runs the PR's own test file per mutant.
import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';

const W = '/Users/wenshao/git/wt12500-head';
const F = `${W}/packages/core/src/tools/mcp-client.ts`;
const ORIG = fs.readFileSync(F, 'utf8');
const R = '/Users/wenshao/git/rig12500-run';

const MUTANTS = [
  ['M1', 'drop pooled McpClient onerror guard', 'if (this.isDisconnecting || isBenignMcpMethodNotFound(error)) {', 'if (this.isDisconnecting) {'],
  ['M2', 'drop standalone connectAndDiscover guard', "      if (isBenignMcpMethodNotFound(error)) {\n        return;\n      }\n      debugLogger.error(`MCP ERROR (${mcpServerName}):`", "      if (false) {\n        return;\n      }\n      debugLogger.error(`MCP ERROR (${mcpServerName}):`"],
  ['M3', 'accept any HTTP status', '    !LEGACY_MCP_METHOD_NOT_FOUND_STATUSES.has(status)\n', '    false\n'],
  ['M4', 'accept a missing status', '    status === undefined ||\n    !LEGACY_MCP_METHOD_NOT_FOUND_STATUSES.has(status)', '    (status !== undefined && !LEGACY_MCP_METHOD_NOT_FOUND_STATUSES.has(status))'],
  ['M5', 'add 503 to the allowlist', 'new Set([400, 404, 405, 422, 501]);', 'new Set([400, 404, 405, 422, 501, 503]);'],
  ['M6', 'drop the jsonrpc === "2.0" check', "return payload.jsonrpc === '2.0' && payload.error?.code === -32601;", 'return payload.error?.code === -32601;'],
  ['M7', 'any error code counts', "return payload.jsonrpc === '2.0' && payload.error?.code === -32601;", "return payload.jsonrpc === '2.0' && payload.error?.code !== undefined;"],
  ['M8', 'substring match instead of JSON parse', "    const payload = JSON.parse(responseText.slice(jsonStart)) as {", "    if (responseText.includes('-32601')) return true;\n    const payload = JSON.parse(responseText.slice(jsonStart)) as {"],
  ['M9', 'drop ^ anchor on legacy SSE pattern', '/^Error POSTing to endpoint(?: \\(HTTP (\\d{3})\\))?:\\s*([\\s\\S]*)$/u', '/Error POSTing to endpoint(?: \\(HTTP (\\d{3})\\))?:\\s*([\\s\\S]*)$/u'],
  ['M10', 'read status from anywhere in the message', "  const embeddedStatus = legacySseResponse?.[1];", "  const embeddedStatus = legacySseResponse?.[1] ?? (error instanceof Error ? /\\(HTTP (\\d{3})\\)/u.exec(error.message)?.[1] : undefined);"],
  ['M11', 'isMethodNotFound: drop transport short-circuit', '  if (isLegacyMcpTransportError(error)) return false;\n', ''],
  ['M12', 'revert GET SSE fallback to [400, 404]', 'new Set([400, 404, 422, 501]);', 'new Set([400, 404]);'],
];

const only = process.argv.slice(2);
const results = [];
try {
  for (const [id, label, find, repl] of MUTANTS) {
    if (only.length && !only.includes(id)) continue;
    const n = ORIG.split(find).length - 1;
    if (n !== 1) {
      results.push({ id, label, error: `pattern occurs ${n}x` });
      console.log(id, 'SKIP pattern occurs', n);
      continue;
    }
    fs.writeFileSync(F, ORIG.replace(find, repl));
    const out = `${R}/mut-${id}.json`;
    spawnSync('npx', ['vitest', 'run', 'src/tools/mcp-client.test.ts', '--coverage.enabled=false', '--reporter=json', `--outputFile=${out}`], {
      cwd: `${W}/packages/core`, encoding: 'utf8', timeout: 300000,
    });
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    const failed = j.testResults.flatMap((f) => f.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
    const row = { id, label, total: j.numTotalTests, failed: j.numFailedTests, killedBy: failed.slice(0, 3) };
    results.push(row);
    console.log(`${id.padEnd(4)} ${label.padEnd(44)} ${j.numFailedTests > 0 ? 'KILLED ' : 'SURVIVED'} ${j.numFailedTests}/${j.numTotalTests}  ${failed[0] ?? ''}`);
  }
} finally {
  fs.writeFileSync(F, ORIG);
  console.log('restored; git diff:', execFileSync('git', ['-C', W, 'diff', '--stat', '--', 'packages/core/src/tools/mcp-client.ts'], { encoding: 'utf8' }).trim() || 'clean');
  fs.writeFileSync(`${R}/mutation-results.json`, JSON.stringify(results, null, 1));
}
