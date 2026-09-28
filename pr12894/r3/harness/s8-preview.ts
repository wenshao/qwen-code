// S8: what the model receives from the Hosted Shell preview for text outputs around the 32/64 KiB limits.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'o2h', HTTP = 18894, BPORT = 19894;
const BASE = Number(process.env.ST_BASE ?? 40);
L.openLog(`s8-preview-${process.env.LABEL ?? 'run'}`);
const cases = [
  { name: 'ascii 1500 lines (~49 KB, between 32 and 64 KiB)', cmd: `sh ${L.RIG}/buildlog.sh 1500`, lines: 1500, err: 'ERROR: build failed at step 7', code: 3 },
  { name: 'ascii 3000 lines (~107 KB)', cmd: `sh ${L.RIG}/buildlog.sh 3000`, lines: 3000, err: 'ERROR: build failed at step 7', code: 3 },
  { name: 'ascii 30000 lines (~1.1 MB)', cmd: `sh ${L.RIG}/buildlog.sh 30000`, lines: 30000, err: 'ERROR: build failed at step 7', code: 3 },
  { name: 'CJK 4000 lines (~160 KB UTF-8)', cmd: `${L.NODE22} ${L.RIG}/cjklog.mjs 4000`, cjk: 4000, err: '错误：链接失败', code: 2 },
];
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
const h = await new L.Harness({ name: `s8-${process.env.LABEL ?? 'run'}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
for (const [i, c] of cases.entries()) {
  const st = `s${BASE + i}`, ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create();
  seen = '';
  const r = await s.prompt(`[[case${i}]] run`, 300_000);
  const text = (() => { try { const j = JSON.parse(seen); return typeof j === 'string' ? j : JSON.stringify(j); } catch { return seen; } })();
  const nums = [...text.matchAll(c.cjk ? /第(\d+)个模块/g : /compiling module (\d+) of/g)].map((x) => Number(x[1]));
  const dup = nums.length - new Set(nums).size;
  const gaps: string[] = [];
  for (let k = 1; k < nums.length; k++) if (nums[k] !== nums[k - 1] + 1) gaps.push(`${nums[k - 1]}->${nums[k]}`);
  const total = c.lines ?? c.cjk;
  L.say(c.name, `${L.summarizeTurn(r)}`);
  L.say('  model input', `${Buffer.byteLength(text)} B; error line: ${text.includes(c.err)}; exit code ${c.code}: ${new RegExp(`Exit Code: ${c.code}`).test(text)}; worker path: ${/\.qwen\/tmp|saved to/.test(text)}; U+FFFD: ${(text.match(/�/g) ?? []).length}`);
  L.say('  lines', `first ${nums[0]} last ${nums.at(-1)} of ${total}; shown ${nums.length}; duplicates ${dup}; gaps ${gaps.slice(0, 4).join(', ') || 'none'}${gaps.length > 4 ? ` (+${gaps.length - 4})` : ''}`);
  const markers = (text.match(/\[[^\]]*omitted[^\]]*\]|\[[^\]]*TRUNCATED[^\]]*\]|Shell output preview:|complete raw output is retained[^.]*\./gi) ?? []).map((x) => x.slice(0, 90));
  L.say('  markers', markers.join(' | ') || 'none');
  fs.writeFileSync(`${L.RIG}/out/s8-case${i}-${process.env.LABEL ?? 'run'}.txt`, text);
}
await h.stop();
process.exit(0);
