// Where does U+FFFD enter a CJK Shell result? Prints each field's FFFD count
// and context, for a few output shapes.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848c';
const HTTP = Number(process.env.HTTP ?? 18848);
const ARM = process.env.ARM ?? 'r3';
L.openLog(`s10-fffd-${ARM}`);
const CMDS: Record<string, string> = {
  // T4 again: 900 CJK lines (~56 KB, under the 64 KiB buffer) + stderr + exit 5
  CJKERR: 'i=0; while [ $i -lt 900 ]; do echo "第${i}行：托管工作区输出预览需要保留尾部 🙂"; i=$((i+1)); done; echo "错误：链接失败 FINAL-44-TAIL" >&2; exit 5',
  // same output but exit 0 (no error.message path)
  CJKOK: 'i=0; while [ $i -lt 900 ]; do echo "第${i}行：托管工作区输出预览需要保留尾部 🙂"; i=$((i+1)); done; echo "完成 FINAL-45-TAIL"',
  // short CJK failure (< 8 KiB preview, only error.message is cut at 1 KiB)
  CJKSHORT: 'i=0; while [ $i -lt 40 ]; do echo "第${i}行：托管工作区输出预览需要保留尾部"; i=$((i+1)); done; exit 6',
};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const marker = [...JSON.stringify(messages[lastUser]?.content ?? '').matchAll(/\[\[([A-Z0-9_]+)\]\]/g)].at(-1)?.[1] ?? '';
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (CMDS[marker] && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: CMDS[marker] }, marker.toLowerCase())] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `fffd-${ARM}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
let n = 0;
for (const marker of Object.keys(CMDS)) {
  const st = (process.env.LETTERS ?? 'o,p,q').split(',')[n++];
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  fs.mkdirSync(`${L.RIG}/roots3/${st}/child`, { recursive: true });
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  const r = await s.prompt(`[[${marker}]]`);
  L.say(marker, L.summarizeTurn(r));
  for (const e of r.events ?? []) for (const p of e.data?.record?.message?.parts ?? []) {
    if (!p.functionResponse) continue;
    const resp = p.functionResponse.response;
    for (const [field, value] of [['output', resp.output], ['error', resp.error], ['runtimeError.message', resp.runtimeError?.message]] as const) {
      if (typeof value !== 'string') continue;
      const idx = [...value.matchAll(/�/g)].map((m) => m.index!);
      L.say(`${marker} ${field} sample`, JSON.stringify(value.slice(0, 150)) + " ... " + JSON.stringify(value.slice(-160)));
      L.say(`${marker} ${field}`, `chars=${value.length} bytes=${Buffer.byteLength(value)} fffd=${idx.length}${idx.length ? ` at ${idx.join(',')} of ${value.length}; context=${JSON.stringify(value.slice(Math.max(0, idx[0] - 12), idx[0] + 4))}` : ''}`);
    }
  }
}
await h.stop();
process.exit(0);
