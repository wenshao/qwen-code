// S21b (round 8, R3-10 fix): a raw resource_read that never answers.
// Which routes answer while it is dispatched, and what is left when it ends?
//   S21_SERVER=plain (default timeoutMs 600 s) | short (timeoutMs 5000)
//   S21_WAIT_S  how long to wait for the operation POST to return (default 70)
import {
  Harness, delay, effects, leaseHeld, mcpProfile, newSession, randomUUID,
  result, setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const W = Number(process.env['S21_WS'] ?? 14);
const SERVER = process.env['S21_SERVER'] ?? 'plain';
const WAIT_S = Number(process.env['S21_WAIT_S'] ?? 70);
const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
const out: Record<string, unknown> = { server: SERVER, W };
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1);
const code = (r: { status: number; json: any }) =>
  `${r.status}:${r.json?.code ?? r.json?.state ?? ''}${r.json?.error?.code ? `/${r.json.error.code}` : ''}`;
try {
  const s = await newSession(W);
  await h.open(s.sessionId, s.workspaceId, mcpProfile(W, [[SERVER]]));
  out['warm'] = (await h.prompt(s.sessionId, 'TEXT_0')).terminal?.map((x: any) => x.stopReason);
  const op = randomUUID();
  const url = `/session/${s.sessionId}/mcp/operations/${op}`;
  const pending = h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`,
    { operationId: op, serverId: SERVER, request: { kind: 'resource_read', uri: 'mem://slow' } }, 'POST', 700_000);
  let returned: Record<string, unknown> | undefined;
  pending.then((r) => { returned = { post: code(r), at: at() }; }, (e) => { returned = { post: `fetch-error:${e?.cause?.code ?? e?.name}`, at: at() }; });
  const probe = async (label: string, burst = false) => {
    const r: Record<string, unknown> = { at: at() };
    if (burst) {
      const three = await Promise.all([h.call(s.sessionId, url), h.call(s.sessionId, url), h.call(s.sessionId, url)]);
      r['statusBurst3'] = three.map(code).sort();
    }
    r['opStatus'] = code(await h.call(s.sessionId, url));
    r['sessionStatus'] = (await h.call(s.sessionId, `/session/${s.sessionId}/status`)).json;
    r['newRawOp'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/mcp/operations`,
      { operationId: randomUUID(), serverId: SERVER, request: { kind: 'resource_read', uri: 'mem://text' } }));
    r['prompt'] = code((await h.prompt(s.sessionId, `TEXT_${label}`, { wait: false })).admit);
    r['detach'] = code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {}));
    return r;
  };
  await delay(3000);
  out['t3s'] = await probe('t3s', true);
  out['cancel'] = { result: code(await h.call(s.sessionId, `${url}/cancel`, {})), at: at() };
  out['afterCancel'] = await probe('afterCancel');
  const deadline = Date.now() + WAIT_S * 1000;
  // Poll the operation (reachable during dispatch since 06c1df7f) until it
  // leaves `running`; the POST itself may hit the client's 300 s header timeout.
  const samples: string[] = [];
  let left = false;
  while (Date.now() < deadline) {
    await delay(returned ? 1000 : 10_000);
    const polled = code(await h.call(s.sessionId, url));
    if (samples.at(-1)?.split('@')[0] !== polled) samples.push(`${polled}@${at()}`);
    if (!polled.startsWith('200:running') && !polled.startsWith('409')) { left = true; break; }
  }
  out['statusSamples'] = samples;
  out['opReturned'] = returned ?? `not by ${at()} s`;
  if (left) {
    await delay(1000);
    out['afterEnd'] = await probe('afterEnd');
    if (String((out['afterEnd'] as any).prompt).startsWith('202')) await delay(3000);
    out['afterEnd2'] = { detach: code(await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {})), at: at() };
  } else {
    out['t_end'] = await probe('t_end');
  }
  out['serverLedger'] = effects((e) => e['uri'] === 'mem://slow').map((e) => `${e['server']}:${e['phase']}`);
  out['lease'] = await leaseHeld(W);
  out['sessionId'] = s.sessionId;
} finally {
  result(`s21b-${SERVER}`, out);
  await h.close();
  await model.close();
  await proxy.close();
}
