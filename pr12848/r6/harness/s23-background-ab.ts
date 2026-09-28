// Same background-job commands, one fresh Session each; compare worker bundles.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'p848g';
const HTTP = Number(process.env.HTTP ?? 18848);
const ROOTS = process.env.ROOTS ?? 'roots7';
const TAG = process.env.TAG ?? 'x';
const LETTERS = (process.env.LETTERS ?? 'v,w,x,y').split(',');
const PORT = Number(process.env.PORT ?? 18791);
L.openLog(`s23-background-ab-${TAG}`);
const CMDS: Record<string, string> = process.env.MINIMAL ? {
  PLAIN_BG: 'sleep 20 > /dev/null 2>&1 & echo ok',
  CD_AND_BG: 'cd . && sleep 20 > /dev/null 2>&1 & echo ok',
  GROUPED_BG: '(cd . && sleep 20 > /dev/null 2>&1) & echo ok',
  CD_THEN_BG: 'cd . ; sleep 20 > /dev/null 2>&1 & echo ok',
} : process.env.EXACT ? {
  R_EXACT: `nohup ruby -run -e httpd . --port=${PORT} --bind-address=127.0.0.1 > server.log 2>&1 & disown; sleep 3; echo "--- pgrep ---"; pgrep -fl "port=${PORT}"; echo "--- listening ---"; lsof -nP -iTCP:${PORT} -sTCP:LISTEN; echo "--- log ---"; cat server.log`,
  S_EXACT: `nohup ruby -run -e httpd . --port=${PORT + 1} --bind-address=127.0.0.1 > /tmp/qwen_s23_${PORT + 1}.log 2>&1 & echo "spawned pid $!"; sleep 3; echo "--- listening? ---"; lsof -nP -iTCP:${PORT + 1} -sTCP:LISTEN 2>/dev/null || echo "(nothing listening)"; echo "--- log ---"; cat /tmp/qwen_s23_${PORT + 1}.log`,
  NOLSOF: `nohup ruby -run -e httpd . --port=${PORT + 2} --bind-address=127.0.0.1 > server.log 2>&1 & disown; sleep 3; echo done`,
  LSOFONLY: `sleep 20 > /dev/null 2>&1 & sleep 1; lsof -nP -iTCP:${PORT + 3} -sTCP:LISTEN 2>/dev/null || echo none`,
} : {
  RUBY_REDIRECT: `nohup ruby -run -e httpd . --port=${PORT} --bind-address=127.0.0.1 > server.log 2>&1 & sleep 1.5; curl -s http://127.0.0.1:${PORT}/index.html | head -c 20; echo`,
  RUBY_REDIRECT_STDIN: `nohup ruby -run -e httpd . --port=${PORT + 1} --bind-address=127.0.0.1 > server.log 2>&1 < /dev/null & sleep 1.5; curl -s http://127.0.0.1:${PORT + 1}/index.html | head -c 20; echo`,
  SLEEP_REDIRECT: 'sleep 20 > /dev/null 2>&1 & echo started',
  SLEEP_REDIRECT_STDIN: 'sleep 20 < /dev/null > /dev/null 2>&1 & echo started',
};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = (JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[([A-Z_]+)\]\]/) ?? [])[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (key && CMDS[key] && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: CMDS[key], timeout: 60000 }, `${key}-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `bg-ab-${TAG}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const M = `${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`;
for (const [i, key] of Object.keys(CMDS).entries()) {
  const st = LETTERS[i];
  const ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const dir = `${L.RIG}/${ROOTS}/${st}/child`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/index.html`, '<h1>hello</h1>\n');
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), L.storeConnection(h, ws, HTTP));
  await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  const r = await s.prompt(`[[${key}]]`, 120000);
  const man = execFileSync(M, ['-uroot', '-prig12831', '-h127.0.0.1', '-P13848', '-N', DB, '-e', `SELECT CAST(inline_bytes AS CHAR) FROM qwen_managed_session_resource WHERE kind='managed-tool-result-manifest' AND workspace_id='${ws}' ORDER BY created_at DESC LIMIT 1`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const m = man ? JSON.parse(man) : null;
  L.say(key, `${L.summarizeTurn(r)}; manifest ${m ? `${m.captureStatus}/${m.captureReason} ${JSON.stringify(m.contents.map((c: any) => `${c.streamId}:${c.state}:${c.byteLength}`))}` : 'none'}`);
}
// stop the background jobs these commands started (verified command lines only)
const ps = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
for (const line of ps) {
  const m = line.trim().match(/^(\d+)\s+(.*)$/);
  if (!m) continue;
  if (new RegExp(`httpd \\. --port=(${PORT}|${PORT + 1}|${PORT + 2})`).test(m[2])) {
    try { process.kill(Number(m[1])); L.say('cleanup', `stopped ${m[1]} ${m[2].slice(0, 60)}`); } catch {}
  }
}
await h.stop();
process.exit(0);
