// S13: R2-6 probe. The fake model sends run_shell_command arguments whose JSON
// canonical form differs between Jackson's default writer and JSON.stringify
// (raw control characters, DEL, U+2028/U+2029, a lone surrogate, exponent-form
// numbers). Each case runs in its own Session on the O2 path.
// env: DB, ST_BASE, LABEL
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o2n';
const HTTP = 18894, BPORT = 19894, PROXY = 18895, CTRL = 'http://127.0.0.1:18896';
const BASE = Number(process.env.ST_BASE ?? 40);
const LABEL = process.env.LABEL ?? 'run';
L.openLog(`s13-${LABEL}`);
const cases: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'plain ASCII (control)', args: { command: 'echo plain-ok', description: 'plain' } },
  { name: 'raw U+0001 in command', args: { command: "printf 'a\u0001b'; echo; echo ctl-ok", description: 'ctl' } },
  { name: 'raw ESC (U+001B) in command', args: { command: "printf '\u001b[31mred\u001b[0m\\n'; echo esc-ok", description: 'esc' } },
  { name: 'raw DEL (U+007F) in command', args: { command: "printf 'x\u007fy'; echo; echo del-ok", description: 'del' } },
  { name: 'U+2028 / U+2029 in description', args: { command: 'echo sep-ok', description: 'line para end' } },
  { name: 'lone surrogate in description', args: { command: 'echo sur-ok', description: 'half \ud800 char' } },
  { name: 'CJK + emoji in command', args: { command: 'echo 中文-😀-ok', description: '中文 😀' } },
  { name: 'timeout 150000.5 (fraction)', args: { command: 'echo frac-ok', description: 'frac', timeout: 150000.5 } },
  { name: 'timeout 1e21 (exponent form in JS)', args: { command: 'echo exp-ok', description: 'exp', timeout: 1e21 } },
];
const VALIDATION: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: 'timeout 900000 (above the 600000 schema maximum)', args: { command: 'echo long-ok', description: 'long build', timeout: 900000 } },
  { name: 'timeout 0', args: { command: 'echo zero-ok', timeout: 0 } },
  { name: 'is_background: false', args: { command: 'echo fg-ok', description: 'fg', is_background: false } },
  { name: 'unsupported key directory', args: { command: 'echo dir-ok', directory: '.' } },
];
if (process.env.CASESET === 'validation') cases.splice(0, cases.length, ...VALIDATION);
if (process.env.CASESET === 'sleep') cases.splice(0, cases.length, { name: 'sleep 3 then echo', args: { command: 'sleep 3; echo slept' } }, { name: 'sleep 1 then echo', args: { command: 'sleep 1; echo slept1' } }, { name: 'build step with sleep 5', args: { command: 'echo build; sleep 5; echo done' } });
if (process.env.CASESET === 'surrogate') cases.splice(0, cases.length, { name: 'lone surrogate in description', args: { command: 'echo sur-ok', description: 'half \ud800 char' } }, { name: 'lone surrogate in command', args: { command: 'echo half-\udc00-ok', description: 'x' } }, { name: 'paired surrogates (emoji) in description', args: { command: 'echo pair-ok', description: 'ok \ud83d\ude00' } });
let seen = '';
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const m = JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[case(\d+)\]\]/);
  const receipts = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (m && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', cases[Number(m[1])].args, `call-${LABEL}-${m[1]}`)] };
  const c = receipts.at(-1)?.content as unknown;
  seen = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(c ?? '');
  return { content: 'done' };
});
const h = await new L.Harness({ name: `s13-${LABEL}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
for (const [i, c] of cases.entries()) {
  const st = `s${BASE + i}`, ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  const s = new L.HSession(h, await L.createWorkspaceSession(HTTP, ws), { ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
  await s.create();
  seen = '';
  const t0 = Date.now();
  const r = await s.prompt(`[[case${i}]] run`, 120_000).catch((e: any) => ({ terminal: [], err: String(e) }));
  const refused = (await (await fetch(`${CTRL}/ledger?since=${t0}`)).json()).filter((e: any) => typeof e.status === 'number' && e.status >= 400).map((e: any) => `${e.method} ${String(e.url).replace(/.*\/v1\/sessions\/[^/]+/, '')} -> ${e.status}`);
  const st2 = await s.status().catch(() => ({}));
  L.say(c.name, `${L.summarizeTurn(r)}; blocked=${(st2 as any).recoveryBlocked}`);
  L.say('  model saw', JSON.stringify(seen.slice(0, 150)));
  if (refused.length) L.say('  4xx/5xx', refused.slice(0, 4));
}
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|conflict|refus/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 12));
await h.stop();
process.exit(0);
