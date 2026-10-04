// Adds the Monitor scenarios (ce04b2112f) to l19-executor.mjs.
import fs from 'node:fs';

const file = new URL('./l19-executor.mjs', import.meta.url);
let s = fs.readFileSync(file, 'utf8');
const rep = (a, b) => {
  if (s.split(a).length !== 2) throw new Error(`anchor ${a.slice(0, 60)}`);
  s = s.replace(a, () => b);
};
rep(
  "    const state = { hash: { stdout: createHash('sha256'), stderr: createHash('sha256') }, stored: 0, inflight: 0, maxInflight: 0, writes: 0 };",
  "    const state = { hash: { stdout: createHash('sha256'), stderr: createHash('sha256') }, stored: 0, inflight: 0, maxInflight: 0, writes: 0, stdout: [], stdoutBytes: 0 };",
);
rep(
  '      state.hash[request.streamId].update(request.bytes);',
  "      state.hash[request.streamId].update(request.bytes);\n      if (request.streamId === 'stdout' && state.stdoutBytes < 64 * 1024 * 1024) { state.stdout.push(Buffer.from(request.bytes)); state.stdoutBytes += request.bytes.byteLength; }",
);
rep(
  "import { ManagedShellRuntime } from '@armcli/serve/managed-shell-runtime.js';",
  "import { ManagedShellRuntime } from '@armcli/serve/managed-shell-runtime.js';\nimport { ManagedMonitorRuntime } from '@armcli/serve/managed-monitor-runtime.js';",
);
rep(
  'async function start(sessionId, callId, command) {\n  const input = { command, is_background: true };',
  "async function start(sessionId, callId, command, kind = 'background') {\n  const input = kind === 'monitor' ? { command, is_monitor: true } : { command, is_background: true };",
);
rep('  const unitName = `qwen-bg-${callId}`;', "  const unitName = `${kind === 'monitor' ? 'qwen-mon' : 'qwen-bg'}-${callId}`;");
rep('  const entry = registry.entries.get(unitName);', "  const physical = kind === 'monitor' ? executor.monitorRegistry.physical : registry;\n  const entry = physical.entries.get(unitName);");
rep('    completion: registry.receipt(unitName),', '    completion: physical.receipt(unitName),');

const scenarios = String.raw`// f. Monitor watches through the executor (ce04b2112f): is the captured
//    output the command's stdout, byte for byte?
const monitorRoute = new ManagedMonitorRuntime(executor.monitorRegistry);
const CJK = '中文测试行，用于验证多字节字符在管道块边界被切开时的行为。';
for (const [name, command, expected] of [
  ['monUtf8', ` + "`yes '${CJK}' | head -n 30000`" + String.raw`, null],
  ['monShape', "printf 'first\\n\\nthird\\nlast-without-newline'", 'first\n\nthird\nlast-without-newline'],
  ['monSlowShape', "printf 'first\\n\\nthird\\n'; sleep 3; printf 'last-without-newline'", 'first\n\nthird\nlast-without-newline'],
]) {
  if (!want(name)) continue;
  const s = await start(` + '`s-${name}`, `l19-${name.toLowerCase()}`' + String.raw`, command, 'monitor');
  if (!s.started) { out[name] = { startError: s.startError }; continue; }
  const receipt = await s.completion;
  const text = Buffer.concat(captures.get(s.callId).stdout).toString('utf8');
  const lines = text.split('\n');
  out[name] = {
    receipt: receipt?.evidence ?? null,
    capturedBytes: Buffer.byteLength(text),
    ...(expected === null
      ? { lines: lines.filter(Boolean).length, linesWithReplacementChar: lines.filter((l) => l.includes('�')).length }
      : { captured: JSON.stringify(text), expected: JSON.stringify(expected), identical: text === expected }),
    status: (await monitorRoute.control(` + '`s-${name}`' + String.raw`, { kind: 'monitor-status', operationId: 'op', sessionKey: { tenantId: 't', sessionId: 's' }, targetOperationId: s.callId }).catch((e) => ({ state: e.message }))).state,
    holdAfter: executor.hasActiveSession(` + '`s-${name}`' + String.raw`),
  };
}
`;
rep('console.log(`[RESULT] ${JSON.stringify(out)}`);', scenarios + 'console.log(`[RESULT] ${JSON.stringify(out)}`);');
fs.writeFileSync(file, s);
console.log('patched');
