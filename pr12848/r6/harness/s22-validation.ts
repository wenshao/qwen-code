// a6dcb87b: R1-4 specific Shell refusal messages and R1-7 string "false" for is_background.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848g';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots7';
const ST = process.env.ST ?? 'q';
L.openLog(`s22-validation-${process.env.ARM ?? ''}`);
const CASES: Record<string, Record<string, unknown>> = {
  TIMEOUT: { command: 'echo t >> v.txt', timeout: 900000 },
  UNKNOWN: { command: 'echo u >> v.txt', directory: 'sub' },
  DESC: { command: 'echo d >> v.txt', description: 42 },
  EMPTY: { command: '   ' },
  BGTRUE: { command: 'echo b >> v.txt', is_background: 'true' },
  BGFALSE: { command: 'echo f >> v.txt', is_background: 'false' },
  BGFALSEUPPER: { command: 'echo F >> v.txt', is_background: 'FALSE' },
  BGBOOLFALSE: { command: 'echo g >> v.txt', is_background: false },
};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = (JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[([A-Z]+)\]\]/) ?? [])[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (key && CASES[key] && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', CASES[key], `${key}-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: 'validation', modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const dir = `${L.RIG}/${ROOTS}/${ST}/child`;
fs.mkdirSync(dir, { recursive: true });
const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
await s.create({ toolProfile: 'hosted-workspace-shell/1' });
for (const key of Object.keys(CASES)) {
  const before = fs.existsSync(`${dir}/v.txt`) ? fs.readFileSync(`${dir}/v.txt`, 'utf8') : '';
  const r = await s.prompt(`[[${key}]]`);
  const resp = (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => p.functionResponse.response)[0] ?? {};
  const after = fs.existsSync(`${dir}/v.txt`) ? fs.readFileSync(`${dir}/v.txt`, 'utf8') : '';
  L.say(key, `${L.summarizeTurn(r)}; ran=${after.length > before.length}; ${resp.executionStatus ? `status=${resp.executionStatus}` : `refusal=${JSON.stringify(resp.error ?? '').slice(0, 140)}`}`);
}
await h.stop();
process.exit(0);
