// FG6d's question for Shell: cancel a running Hosted Shell call. What settles, what keeps running,
// and are the Session and Workspace usable afterwards?
import fs from 'node:fs';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const DB = process.env.DB ?? 'p848n', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots13';
const LETTERS = (process.env.LETTERS ?? 'p,q,r,s').split(',');
L.openLog(`s31-shell-cancel-${process.env.ARM ?? ''}`);
const CMDS: Record<string, string> = {
  RUN: 'echo started; sleep 30; echo late > late.txt',
  GROUP_BG: '(while true; do echo tick >> ticks.txt; sleep 0.2; done) & echo started; sleep 30; echo late > late.txt',
  COMPOUND_BG: 'cd . && sleep 60 > /dev/null 2>&1 & echo started; sleep 30; echo late > late.txt',
  SETSID_BG: "perl -MPOSIX -e 'POSIX::setsid(); sleep 5; open(my $f, \">\", \"escaped.txt\"); print $f \"escaped\\n\"' > /dev/null 2>&1 & echo started; sleep 30; echo late > late.txt",
};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (receipts.length) return { content: 'ok' };
  const key = (text.match(/\[\[([A-Z_]+)\]\]/) ?? [])[1];
  if (key === 'ECHO') return { toolCalls: [fakeToolCall('run_shell_command', { command: 'echo alive >> alive.txt' }, `echo-${Date.now()}`)] };
  if (key && CMDS[key]) return { toolCalls: [fakeToolCall('run_shell_command', { command: CMDS[key], timeout: 60000 }, `${key}-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `cancel-${process.env.ARM ?? ''}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const exec = (pid: string) => L.sql(DB, `SELECT execution_state, IFNULL(execution_status,'-'), IFNULL(LEFT(CAST(result_json AS CHAR),60),'-') FROM qwen_tool_execution WHERE runtime_session_id='${pid}'`).map((r: string[]) => r.join(' ')).join(' ; ');
for (const [i, key] of Object.keys(CMDS).entries()) {
  const st = LETTERS[i], ws = `ws-${st}`, dir = `${L.RIG}/${ROOTS}/${st}/child`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['late.txt', 'ticks.txt', 'escaped.txt', 'alive.txt']) fs.rmSync(`${dir}/${f}`, { force: true });
  const sessionId = await L.createWorkspaceSession(HTTP, ws);
  const s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
  await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  const sub = await s.submit(`[[${key}]]`);
  for (let t = 0; t < 300 && !exec(sub.promptId).startsWith('EXECUTING'); t++) await L.sleep(100);
  await L.sleep(2000);
  const t0 = Date.now();
  const c = await s.cancel();
  const idle = await s.waitIdle(90000);
  const ms = Date.now() - t0;
  const ev = (await s.transcript()).filter((e: any) => e.promptId === sub.promptId);
  const term = ev.filter((e: any) => e.type.startsWith('turn_')).map((e: any) => `${e.type}(${e.data?.stopReason ?? ''})`).join(',') || '<none>';
  const resp = ev.flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => p.functionResponse.response)[0];
  const man = L.sql(DB, `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE kind='managed-tool-result-manifest' AND session_id='${sessionId}' ORDER BY created_at DESC LIMIT 1`)[0]?.[0];
  const m = man ? JSON.parse(man) : null;
  L.say(key, `cancel ${c.status}; idle after ${ms} ms; terminal ${term}; recoveryBlocked=${idle.recoveryBlocked}; receipt ${resp ? `${resp.executionStatus}:${resp.capture?.captureStatus ?? '-'}/${resp.capture?.deliveryStatus ?? '-'}` : 'none'}; execution ${exec(sub.promptId)}; manifest ${m ? `${m.captureStatus}/${m.captureReason} ${JSON.stringify(m.contents.map((x: any) => `${x.streamId}:${x.state}:${x.byteLength}`))}` : 'none'}`);
  const ticks0 = fs.existsSync(`${dir}/ticks.txt`) ? fs.statSync(`${dir}/ticks.txt`).size : -1;
  await L.sleep(35000);
  const ticks1 = fs.existsSync(`${dir}/ticks.txt`) ? fs.statSync(`${dir}/ticks.txt`).size : -1;
  L.say(`${key} after 35 s`, `late.txt ${fs.existsSync(`${dir}/late.txt`) ? 'WRITTEN' : 'absent'}; escaped.txt ${fs.existsSync(`${dir}/escaped.txt`) ? 'WRITTEN' : 'absent'}; ticks.txt ${ticks0 < 0 ? 'n/a' : ticks1 > ticks0 ? `GREW ${ticks0}->${ticks1}` : `stopped at ${ticks1} B`}`);
  const n = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await n.create({ toolProfile: 'hosted-workspace-shell/1' });
  const r = await n.prompt('[[ECHO]]', 60000);
  await s.detach();
  const cold = await s.load({ toolProfile: 'hosted-workspace-shell/1' });
  L.say(`${key} afterwards`, `new Session in Workspace: ${L.summarizeTurn(r)}; detach + load ${cold.status}`);
}
await h.stop();
process.exit(0);
