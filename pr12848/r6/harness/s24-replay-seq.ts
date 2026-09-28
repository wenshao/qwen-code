// Replay a real-model trial's full Shell call sequence as consecutive rounds of one turn.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848g', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots7';
const SRC = process.env.SRC ?? 'r', ST = process.env.ST ?? 'd2', TAG = process.env.TAG ?? '';
L.openLog(`s24-replay-${SRC}-${TAG}`);
const cmds = fs.readFileSync(`${L.RIG}/run/seq-${SRC}.hex`, 'utf8').trim().split('\n').map((h) => JSON.parse(Buffer.from(h, 'hex').toString()).command as string)
  .map((c) => c.replaceAll(`${L.RIG}/${ROOTS}/${SRC}/child`, `${L.RIG}/${ROOTS}/${ST}/child`));
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown; tool_calls?: unknown[] }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const round = messages.slice(lastUser + 1).filter((m) => m.role === 'assistant' && m.tool_calls?.length).length;
  if (JSON.stringify(messages[lastUser]?.content).includes('[[SEQ]]') && round < cmds.length)
    return { toolCalls: [fakeToolCall('run_shell_command', { command: cmds[round], timeout: 60000 }, `seq-${round}`)] };
  return { content: 'done' };
});
const h = await new L.Harness({ name: `replay-${SRC}-${TAG}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
fs.mkdirSync(`${L.RIG}/${ROOTS}/${ST}/child`, { recursive: true });
fs.writeFileSync(`${L.RIG}/${ROOTS}/${ST}/child/index.html`, '<h1>hello</h1>\n');
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
const r = await s.prompt('[[SEQ]]', 240000);
const M = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
const man = execFileSync(M, ['-uroot', '-prig12831', '-h127.0.0.1', '-P13848', '-N', DB, '-e', `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE kind='managed-tool-result-manifest' AND workspace_id='${ws}' ORDER BY created_at`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean).map((l) => { const m = JSON.parse(l); return `${m.captureStatus}/${m.captureReason}`; });
L.say(`replay ${SRC} (${cmds.length} calls)`, `${L.summarizeTurn(r)}; manifests in order: ${man.join(', ')}`);
await h.stop();
process.exit(0);
