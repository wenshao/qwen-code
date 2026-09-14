// R6-1: the SDK daemon-MCP serve-bridge answer collector.
// Real `qwen serve` daemon + the shipped `qwen-serve-mcp` stdio MCP server +
// a real MCP client. A background agent completes in the MIDDLE of the
// foreground answer's stream.
import * as O from './obs.mjs';
import fs from 'node:fs';

const WT = O.ARM === 'pre'
  ? '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4pre'
  : '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4';
const NM = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4/node_modules';
const { Client } = await import(`${NM}/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { StdioClientTransport } = await import(`${NM}/@modelcontextprotocol/sdk/dist/esm/client/stdio.js`);

const label = `${O.ARM}-sdk`;
const out = { arm: O.ARM, label, steps: [] };
const step = (m, x) => { out.steps.push({ t: O.rel(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 300) : ''); };

await O.mockRun(label);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`${WT}/packages/sdk-typescript/dist/daemon-mcp/serve-bridge/bin.js`],
  env: {
    ...process.env,
    QWEN_DAEMON_URL: O.BASE,
    QWEN_DAEMON_TOKEN: O.TOKEN,
    QWEN_WORKSPACE_CWD: O.cfg.ws,
  },
  stderr: 'pipe',
});
const client = new Client({ name: 'pr11636-round4-probe', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
step('mcp connected');
const tools = (await client.listTools()).tools.map((t) => t.name);
out.tools = tools;
step('tools', { n: tools.length, has: ['session_create', 'prompt'].filter((x) => tools.includes(x)) });

const created = await client.callTool({ name: 'session_create', arguments: { cwd: O.cfg.ws, approval_mode: 'yolo' } });
const createdText = created.content?.[0]?.text ?? '';
out.created = createdText.slice(0, 300);
const sid = (createdText.match(/"session_id"\s*:\s*"([^"]+)"/) ?? createdText.match(/"sessionId"\s*:\s*"([^"]+)"/))?.[1];
out.sid = sid;
step('session_create', { sid, raw: createdText.replace(/\s+/g, ' ').slice(0, 180) });

const t0 = Date.now();
const res = await client.callTool({ name: 'prompt', arguments: { prompt: '[[S:collide]] answer at length while a probe runs', session_id: sid } });
const text = res.content?.[0]?.text ?? '';
out.promptMs = Date.now() - t0;
out.promptRaw = text;
let parsed;
try { parsed = JSON.parse(text); } catch { parsed = { response: text }; }
const answer = String(parsed.response ?? '');
out.answer = answer;
out.checks = {
  hasHead: answer.includes('FOREGROUND-HEAD-MARKER'),
  hasTail: answer.includes('FOREGROUND-TAIL-MARKER'),
  containsBackgroundProse: /Background agent "/.test(answer),
  stopReason: parsed.stop_reason,
  answerChars: answer.length,
  elapsedMs: out.promptMs,
};
step('prompt result', out.checks);

await O.sleep(6000);
out.mock = (await O.mockLog()).map((r) => ({ seq: r.seq, kind: r.kind, scenario: r.scenario, step: r.step, notifs: r.notifs, reply: String(r.reply).slice(0, 60) }));
try { await client.close(); } catch {}
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({ arm: O.ARM, ...out.checks }, null, 1));
console.log('--- answer as the MCP caller sees it ---');
console.log(answer.replace(/\s+/g, ' ').slice(0, 700));
process.exit(0);
