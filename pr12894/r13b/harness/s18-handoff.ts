// S18: clean Session hand-off between hosts. Harness A (this Mac) runs a Shell
// turn and detaches; Harness B (REMOTE_HARNESS_HOST, via REMOTE_HARNESS_NAMES
// matching "-B$") loads the Session and runs a turn; then back to A.
// env: DB, ST, TAG, LOCAL=1 for the local capture path
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o3a', HTTP = 18894, BPORT = 19894, PROXY = 18895;
const ST = process.env.ST ?? 's30';
const TAG = process.env.TAG ?? `s18-${Date.now()}`;
L.openLog(`s18-${TAG}`);
let n = 0;
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const text = JSON.stringify(messages[lastUser]?.content ?? '');
  const tools = messages.slice(lastUser + 1).filter((x) => x.role === 'tool');
  if (!tools.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo ${TAG}-turn-${++n}; uname -s; head -c 300000 /dev/zero | tr '\\0' x; echo; echo end-${n} >&2` }, `call-${TAG}-${n}`)] };
  const last = JSON.stringify(tools.at(-1)?.content ?? '');
  return { content: `done ${text.match(/turn (\d)/)?.[1]} saw-own-output=${last.includes(`${TAG}-turn-${n}`)} history-tools=${messages.filter((m) => m.role === 'tool').length}` };
});
const proxy = await L.startBrokerProxy(`http://127.0.0.1:${BPORT}`);
const ws = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${ST}`);
const sessionId = await L.createWorkspaceSession(HTTP, ws);
const conn = (h: any) => ({ ...L.storeConnection(h, ws, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
const hosts: any[] = [];
process.on('exit', () => { for (const x of hosts) try { x.child?.kill('SIGKILL'); } catch {} });
const start = async (name: string) => { const h = await new L.Harness({ name, modelUrl: model.baseUrl, brokerUrl: proxy.url }).start(); hosts.push(h); return h; };
const A = await start(`s18-${TAG}-A`);
const s = new L.HSession(A, sessionId, conn(A));
L.say('create on A', `${(await s.create()).status} (${A.remote ?? 'this Mac'}) path=${process.env.LOCAL === '1' ? 'local capture' : 'O2 publication'}`);
const turn = async (label: string, i: number) => {
  const r = await s.prompt(`[[${TAG}]] turn ${i}`, 180_000).catch((e: any) => ({ terminal: [], err: String(e) }));
  L.say(label, `${L.summarizeTurn(r)}; answer=${JSON.stringify(L.assistantText(r.events ?? [])).slice(0, 120)}`);
};
await turn('turn 1 on A', 1);
L.say('detach A', `${(await s.detach()).status}`);
const B = await start(`s18-${TAG}-B`);
(s as any).h = B; (s as any).connection = conn(B);
L.say('load on B', `${(await s.load()).status} (${B.remote ?? 'this Mac'})`);
await turn('turn 2 on B', 2);
L.say('detach B', `${(await s.detach()).status}`);
(s as any).h = A; (s as any).connection = conn(A);
L.say('load on A again', `${(await s.load()).status}`);
await turn('turn 3 on A', 3);
const pubs = L.publications(DB, sessionId);
L.say('publications', pubs.map((p: any) => `${p.id.slice(0, 8)} ${p.state}/${p.phase}`));
const journal = L.sql(DB, `SELECT CAST(record_bytes AS CHAR) FROM qwen_managed_session_journal_tx WHERE session_id='${sessionId}' ORDER BY journal_revision`).map((x: string[]) => x[0]).join('\n');
const kc: Record<string, number> = {};
for (const k of (journal.match(/"kind":"[a-z._]+"/g) ?? []).map((k) => k.slice(8, -1))) kc[k] = (kc[k] ?? 0) + 1;
L.say('journal', kc);
L.say('harness logs', hosts.map((h) => `${h.name}: ${h.log().split('\n').filter((l: string) => /fail|block|error|conflict/i.test(l)).length} error lines`));
for (const h of hosts) await h.stop();
process.exit(0);
