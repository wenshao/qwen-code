// S15 (round 4): the Runtime worker dies while an MCP tool call runs. With
// ?reconcile=true the Broker asks the original worker; does Hosted fail
// fast, or wait out the 630 s observation window?
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  Harness, RUN, brokerCalls, delay, fakeToolCall, ledger, mcpProfile,
  newSession, randomUUID, result, say, setScript, sql, startBrokerProxy,
  startModel, toolFor, waitUntil,
} from './rig12946-lib.js';

const W = Number(process.env['S15_WS'] ?? 1);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const tag = `wkill-${randomUUID().slice(0, 6)}`;
const out: Record<string, unknown> = { tag };
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));

// The Runtime binding's endpoint port, then the process listening on it,
// accepted only when it is a child of this rig's Spring process.
async function workerFor(sessionId: string): Promise<number | undefined> {
  const rows = await sql(
    'SELECT b.runtime_endpoint AS ep FROM qwen_runtime_session s JOIN qwen_runtime_binding b ON b.binding_id = s.binding_id WHERE s.harness_session_id = ?',
    [sessionId],
  );
  const port = rows.map((r) => new URL(String(r['ep'])).port).find(Boolean);
  out['endpointPort'] = port ?? null;
  if (!port) return undefined;
  const spring = Number(readFileSync(`${RUN}/spring.pid`, 'utf8'));
  let lines = '';
  try {
    lines = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']).toString();
  } catch {}
  const pids = lines.split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1)));
  const mine = pids.filter(
    (p) => Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(p)]).toString().trim()) === spring,
  );
  out['candidateWorkers'] = mine;
  return mine.length === 1 ? mine[0] : undefined;
}

try {
  setScript((ctx) => {
    if (ctx.marker === 'SLOW') {
      if (!ctx.receipts.length)
        return { toolCalls: [fakeToolCall(toolFor(ctx, 'on server http,'), { ms: 20_000, tag }, 's')] };
      return { content: 'SLOW_DONE' };
    }
    return { content: 'TEXT' };
  });
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [['remote']]));
  const run = h.prompt(s.sessionId, 'SLOW', { wait: false });
  await waitUntil(() => ledger().some((e) => e['tag'] === tag && e['phase'] === 'start'), 60_000);
  out['toolStartAt'] = at();
  const pid = await workerFor(s.sessionId);
  out['workerPid'] = pid ?? null;
  if (!pid) throw new Error('worker not found');
  await delay(1500);
  process.kill(pid, 'SIGKILL');
  out['workerKilledAt'] = at();
  const { promptId } = await run;
  const k = brokerCalls.length;
  const samples: string[] = [];
  let ended: number | undefined;
  while (at() < 720) {
    const st = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    const ex = await sql('SELECT execution_state, execution_status FROM qwen_tool_execution WHERE harness_session_id = ?', [s.sessionId]);
    const sample = `active=${st.hasActivePrompt} blocked=${st.recoveryBlocked} exec=${ex.map((r) => `${r['execution_state']}/${r['execution_status']}`).join(',')}`;
    if (samples.at(-1)?.replace(/^[\d.]+s /, '') !== sample) {
      samples.push(`${at()}s ${sample}`);
      say(`${at()}s ${sample}`);
    }
    if (!st.hasActivePrompt) {
      ended = at();
      break;
    }
    await delay(2000);
  }
  out['samples'] = samples;
  out['turnEndedAt'] = ended ?? null;
  out['reconcileStatusReplies'] = brokerCalls
    .slice(k)
    .filter((c) => c.url.includes('reconcile=true'))
    .reduce<Record<string, number>>((a, c) => ((a[String(c.status)] = (a[String(c.status)] ?? 0) + 1), a), {});
  const o = await h.outcome(s.sessionId, promptId);
  out['terminal'] = o.terminal;
  out['status'] = o.status;
  out['serverLedger'] = ledger().filter((e) => e['tag'] === tag).map((e) => `${e['phase']}@${((Number(e['t']) - t0) / 1000).toFixed(1)}`);
  const next = await h.prompt(s.sessionId, 'TEXT_AFTER', { timeout: 60_000 });
  out['nextPrompt'] = { admit: next.admit.status, body: next.admit.json, terminal: next.terminal };
  const d = await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  out['detach'] = { status: d.status, body: d.json };
  out['lease'] = (await sql('SELECT runtime_session_id FROM managed_workspace_execution_lease WHERE runtime_session_id LIKE ?', [`mcp:${s.sessionId}%`])).length;
  out['execution'] = await sql('SELECT execution_state, execution_status FROM qwen_tool_execution WHERE harness_session_id = ?', [s.sessionId]);
} finally {
  result('s15', out);
  await h.close();
  await model.close();
  await proxy.close();
}
