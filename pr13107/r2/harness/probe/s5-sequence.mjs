// VERIFICATION RIG ONLY (PR #13107): several approvals in one Turn.
//   files  : write_file -> edit -> read_file in three model rounds (one approval per mutating call)
//   batch  : ONE assistant message with three write_file calls; allow, deny, allow
//   many N : ONE assistant message with N write_file calls, all allowed (N > 20 crosses the first Action page)
// usage: DB=<db> node s5-sequence.mjs <files|batch|many> [N]
import { ensureWorkspace, createSession, listActions, waitTurn, readWs, executions, finalText, sql, Report, sleep, j, assertIdle , WS, ST } from './lib.mjs';
import { launch, open, selectSession, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

const [mode = 'files', nArg = '22'] = process.argv.slice(2);
assertIdle();
const R = new Report(`s5-sequence-${mode}`);
ensureWorkspace(WS, `st-${ST}`);
const stamp = Date.now().toString(36);
const browser = await launch();
const ui = await open(browser, { arm: 'head' });
await sleep(800);

// Waits for a card whose Action differs from `not`, returns the requested Action behind it.
async function nextCard(S, not, timeoutMs = 40_000) {
  const start = Date.now();
  for (;;) {
    const list = await listActions('web', S, { limit: 100 });
    const a = list.json.data?.find((x) => x.state === 'requested' && !not.includes(x.actionId));
    if (a && (await card(ui.page).count()) === 1) return { a, ms: Date.now() - start, firstPage: (await listActions('web', S)).json.data?.some((x) => x.actionId === a.actionId) };
    if (Date.now() - start > timeoutMs) return { timeout: true };
    await sleep(120);
  }
}
const expandedRow = async () => (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');

let marker;
let plan; // [ [expectTool, textOnlyInTheCallArguments, choice, file], ... ]
const cards = [];
if (mode === 'files') {
  const f = `s5f-${stamp}.txt`;
  marker = `UI_FILES name=${f} delay=5000`;
  plan = [
    ['write_file', '"before"', 'allow', f],
    ['edit', '"after"', 'allow', f],
  ];
} else if (mode === 'batch') {
  const names = ['a', 'b', 'c'].map((x) => `s5b-${stamp}-${x}.txt`);
  marker = `UI_BATCH names=${names.join(',')} delay=5000`;
  plan = [
    ['write_file', `batch-${names[0]}`, 'allow', names[0]],
    ['write_file', `batch-${names[1]}`, 'deny', names[1]],
    ['write_file', `batch-${names[2]}`, 'allow', names[2]],
  ];
} else {
  const n = Number(nArg);
  const names = Array.from({ length: n }, (_, i) => `s5m-${stamp}-${String(i).padStart(2, '0')}.txt`);
  marker = `UI_BATCH names=${names.join(',')} delay=5000`;
  plan = names.map((x) => ['write_file', `batch-${x}`, 'allow', x]);
}
const c = await createSession('web', WS, marker);
const S = c.session;
R.check('create the Session', c.status === 202, `session=${S} ${marker.slice(0, 90)}`);
await selectSession(ui.page, S);

const seen = [];
let shots = 0;
let onFirstPage = 0;
for (const [i, [tool, arg, choice]] of plan.entries()) {
  const n = await nextCard(S, seen);
  if (n.timeout) {
    R.check(`approval ${i + 1}: a card appears`, false, 'timeout');
    break;
  }
  seen.push(n.a.actionId);
  if (n.firstPage) onFirstPage += 1;
  // let the card re-render on the new Action
  await sleep(350);
  const cardText = (await text(card(ui.page))) ?? '';
  const verbose = mode !== 'many' || i < 2 || i >= plan.length - 2 || i === 20;
  const ok = n.a.toolName === tool;
  if (verbose || !ok) R.check(`approval ${i + 1}: requested Action is ${tool}; card shown`, ok, `action=${n.a.actionId.slice(-8)} call=${n.a.functionCallId} card="${cardText.slice(0, 120)}"`);
  if (mode !== 'many') {
    const row = await expandedRow();
    cards.push(cardText);
    R.check(`approval ${i + 1}: the card says the arguments are unavailable`, /Tool arguments are unavailable for this approval|此项审批的工具参数暂不可见/.test(row), `card="${cardText}"`);
    R.note(`approval ${i + 1}: are this call's arguments (${arg}) visible?`, row.includes(arg) ? 'yes' : 'no');
    await shot(ui.page, `s5-${mode}-${i + 1}-${choice}`);
  } else if ((i === 0 || i === 20) && shots < 2) {
    shots += 1;
    await shot(ui.page, `s5-many-${i + 1}`);
  }
  await option(ui.page, choice).click();
}
const t = await waitTurn(S, { timeoutMs: 120_000 });
R.check('the Turn completes after the last answer', t.status === 'COMPLETED', `status=${t.status} ${t.error}`);
await sleep(2500);
R.check('the card is gone at the end', (await card(ui.page).count()) === 0, '');
const states = sql(`SELECT state, COUNT(*) FROM managed_agent_action WHERE session_id='${S}' GROUP BY state`);
R.note('Actions by state', j(states));
const responds = calls(ui.net, '/actions/respond');
R.check('one answer per approval, all accepted', responds.length === plan.length && responds.every((r) => r.status === 202), `responds=${responds.length} statuses=${j([...new Set(responds.map((r) => r.status))])}`);
R.check('every answer targeted a different Action', new Set(responds.map((r) => r.req.actionId)).size === plan.length, '');
if (mode === 'files') {
  const f = plan[0][3];
  R.check('write then edit both ran: file content is "after"', readWs(ST, `child/${f}`) === 'after', `content=${j(readWs(ST, `child/${f}`))} executions=${executions(S)}`);
} else if (mode === 'batch') {
  R.note('the three cards of the batch are identical', new Set(cards).size === 1 ? 'yes' : 'no');
  const got = plan.map(([, , , f]) => readWs(ST, `child/${f}`) !== null);
  R.check('allow / deny / allow: first and third written, second not', j(got) === '[true,false,true]', j(got));
} else {
  const written = plan.filter(([, , , f]) => readWs(ST, `child/${f}`) !== null).length;
  R.check(`all ${plan.length} approvals were answerable from the panel (${plan.length} files written)`, written === plan.length, `written=${written}`);
  R.check('every pending Action was on the first page of actions/query (limit 20)', onFirstPage === plan.length, `${onFirstPage}/${plan.length}`);
}
R.note('final assistant text', ((await finalText(S)) ?? '').slice(0, 400));
R.note('actions/query calls by the page', String(calls(ui.net, '/actions/query').length));
R.note('console errors', j(ui.consoleErrors));
await shot(ui.page, `s5-${mode}-done`);
await browser.close();
R.done({ session: S });
process.exit(0);
