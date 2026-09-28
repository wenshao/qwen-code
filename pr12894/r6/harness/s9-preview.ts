// S9: model-visible Hosted Shell preview for exact-size fixtures (a7c0a391 stderr block).
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'o2j', HTTP = 18894, BPORT = 19894;
const BASE = Number(process.env.ST_BASE ?? 40);
const cases = JSON.parse(process.env.CASES ?? '[]') as Array<{ name: string; cmd: string; marker?: string; code: number; full?: number }>;
L.openLog(`s9-preview-${process.env.LABEL ?? 'run'}`);
let seen = '';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const m = JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[case(\d+)\]\]/);
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (m && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: cases[Number(m[1])].cmd }, `call-case${m[1]}-${Date.now()}`)] };
  const c = receipts.at(-1)?.content as unknown;
  seen = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(c ?? '');
  return { content: 'done' };
});
const h = await new L.Harness({ name: `s9-${process.env.LABEL ?? 'run'}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
for (const [i, c] of cases.entries()) {
  const st = `s${BASE + i}`, ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create();
  seen = '';
  const r = await s.prompt(`[[case${i}]] run`, 300_000);
  let text = seen;
  try { const j = JSON.parse(seen); text = typeof j === 'string' ? j : (j.output ?? j.error ?? JSON.stringify(j)); } catch {}
  const marker = c.marker ?? 'RIG_MARKER';
  const occ = text.split(marker).length - 1;
  const rs = text.indexOf('[Recent stderr]');
  const recent = rs >= 0 ? text.slice(rs) : '';
  const moj = (s: string) => [...s].filter((ch) => ch === '�' || (ch.charCodeAt(0) >= 0x80 && ch.charCodeAt(0) < 0x2e80)).length;
  const lines = [...text.matchAll(/stdout line (\d{6})/g)].map((x) => Number(x[1]));
  L.say(c.name, L.summarizeTurn(r));
  L.say('  model input', `${Buffer.byteLength(text)} B; marker x${occ}; exit ${c.code}: ${new RegExp(`Exit Code: ${c.code}`).test(text)}; omitted-marker: ${/Middle output omitted|CONTENT TRUNCATED/.test(text)}; [Recent stderr]: ${rs >= 0}; odd chars in recent-stderr block: ${moj(recent)}, in whole input: ${moj(text)}; worker path: ${/\.qwen\/tmp|saved to/.test(text)}`);
  if (c.full) L.say('  stdout lines', `shown ${lines.length} of ${c.full}; first ${lines[0]} last ${lines.at(-1)}; contiguous ${lines.every((n, k) => k === 0 || n === lines[k - 1] + 1)}`);
  fs.writeFileSync(`${L.RIG}/out/s9-case${i}-${process.env.LABEL ?? 'run'}.txt`, text);
}
await h.stop();
process.exit(0);
