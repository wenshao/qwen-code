// VERIFICATION RIG ONLY (PR #13351): drive one midstream-cut scenario on one arm and record the durable outcome.
// usage: ARM=head|base node scenario.mjs <sc> [cuts=k] [hold=wait|<ms>] [ws=ws-a|none] [second=1] [tag=x]
//   hold=wait (default): the cut is released only once the partial text is visible on the public feed
//   (durably published), so every run exercises the post-publication case the PR is about.
import fs from 'node:fs';
import { ARM, RIG, createSession, submit, allEvents, eventText, turnRows, dbEvents, journal, modelEntries, release, ensureWorkspace, api, sleep, j } from './lib.mjs';

const sc = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split('=')));
const cuts = args.cuts ?? '1';
const hold = args.hold ?? 'wait';
const ws = args.ws === 'none' ? undefined : (args.ws ?? 'ws-a');
const id = `${ARM}-${sc}-${args.tag ?? ''}${Date.now().toString(36)}`;
if (ws) ensureWorkspace(ws, `st-${ws.slice(3)}`);

const prompt = `MSR id=${id} sc=${sc} cuts=${cuts} hold=${hold} delay=${args.delay ?? 400}. Reply with the scripted answer.`;
const startedAt = Date.now();
const c = await createSession(prompt, { workspace: ws });
if (c.status !== 202) {
  console.log(`RESULT arm=${ARM} sc=${sc} id=${id} create=${c.status} ${j(c.json).slice(0, 300)}`);
  process.exit(1);
}
const session = c.session;
const live = [];
let after = 0;
let releasedFor = 0;
let terminal;
const partialRe = sc === 'toolcut' ? /PREFACE_BEFORE_TOOL/ : /PARTIAL|MP-4|partial-\d\.6/;
const deadline = Date.now() + Number(args.timeout ?? 120_000);
while (!terminal && Date.now() < deadline) {
  const r = await api('GET', `/v1/agents/sessions/${session}/events?after=${after}&limit=100`);
  for (const e of r.json.data ?? []) {
    live.push({ ...e, observedAtMs: Date.now() - startedAt });
    after = Math.max(after, e.sequence);
    if (e.terminal) terminal = e;
  }
  // Release one held cut per newly visible partial (a cut attempt that published text).
  const visiblePartials = live.filter((e) => e.type === 'item.output_text.delta' && partialRe.test(eventText(e))).length;
  const toolcutVisible = sc === 'toolcut' && live.some((e) => partialRe.test(eventText(e)));
  if (hold === 'wait' && (visiblePartials > releasedFor || (toolcutVisible && releasedFor === 0))) {
    releasedFor = Math.max(visiblePartials, 1);
    const rr = await release(id);
    live.push({ type: '__rig.cut_released', released: rr.released, observedAtMs: Date.now() - startedAt });
  }
  await sleep(100);
}
await sleep(1500);

let second;
if (args.second === '1' && terminal) {
  const s = await submit(session, `MSR id=${id}-2 sc=plain. Second turn.`);
  let t2;
  const d2 = Date.now() + 60_000;
  let a2 = after;
  while (!t2 && Date.now() < d2) {
    const r = await api('GET', `/v1/agents/sessions/${session}/events?after=${a2}&limit=100`);
    for (const e of r.json.data ?? []) {
      a2 = Math.max(a2, e.sequence);
      if (e.terminal) t2 = e;
    }
    await sleep(150);
  }
  await sleep(1000);
  second = { submit: s.status, terminal: t2?.type, requests: modelEntries(`${id}-2`) };
}

const final = await allEvents(session);
const deltas = final.filter((e) => e.type === 'item.output_text.delta');
const firstTurn = final.filter((e) => !second || e.sequence <= (terminal?.sequence ?? Infinity));
const visibleText = firstTurn.filter((e) => e.type === 'item.output_text.delta').map(eventText).join('');
const liveText = live.filter((e) => e.type === 'item.output_text.delta').map(eventText).join('');
const items = await api('GET', `/v1/agents/sessions/${session}/items?limit=100`);
const transcript = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: session });
const requests = modelEntries(id);
const res = {
  arm: ARM,
  sc,
  id,
  session,
  cuts: Number(cuts),
  hold,
  workspace: ws ?? null,
  terminal: terminal?.type ?? 'none',
  terminalData: terminal?.data ?? null,
  visibleText,
  liveText,
  eventTypes: firstTurn.map((e) => e.type),
  deltas: deltas.map((e) => ({ seq: e.sequence, text: eventText(e), item: e.item_id ?? e.data?.item_id ?? null })),
  reconciled: final.filter((e) => e.type === 'stream.reconciled').length,
  items: items.json,
  transcript: transcript.json,
  modelRequests: requests,
  turns: turnRows(session),
  dbEvents: dbEvents(session),
  journal: (() => {
    try {
      return journal(session);
    } catch (e) {
      return String(e);
    }
  })(),
  live,
  second,
};
fs.mkdirSync(`${RIG}/results`, { recursive: true });
const file = `${RIG}/results/${id}.json`;
fs.writeFileSync(file, JSON.stringify(res, null, 2));
const reqs = requests.filter((e) => e.n !== undefined);
console.log(
  `RESULT arm=${ARM} sc=${sc} cuts=${cuts} ws=${ws ?? 'none'} terminal=${res.terminal} visible=${j(visibleText.length > 120 ? visibleText.slice(0, 60) + `…(${visibleText.length})` : visibleText)} reconciled=${res.reconciled} ` +
    `attempts=${reqs.map((e) => `r${e.round}a${e.attempt}:${e.bodySha.slice(0, 8)}${e.continuationShaped ? '+cont' : ''}`).join(',')} turn=${j(res.turns.at(-1))}` +
    (second ? ` second=${second.terminal} secondHistoryHasPartial=${second.requests.map((e) => e.historyHasPartial).join('/')}` : '') +
    ` file=${file}`,
);
