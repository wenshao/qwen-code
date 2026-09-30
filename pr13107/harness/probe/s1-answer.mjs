// VERIFICATION RIG ONLY (PR #13107): the PR's end-to-end test plan, driven through the real Managed panel.
// The page is already open on the Session when the approval is raised, so the card has to arrive through the
// Session event stream (action.updated -> actions/query), not through a page load.
// usage: DB=<db> node s1-answer.mjs <allow|deny> [lang]
import { api, ensureWorkspace, createSession, listActions, waitTurn, readWs, executions, actionRow, opRow, finalText, modelEntries, Report, sleep, j, one, written, assertIdle , WS, ST } from './lib.mjs';
import { launch, open, selectSession, waitCard, waitNoCard, shot, card, calls, text, option } from './ui.mjs';

const [choice = 'allow', lang = 'en'] = process.argv.slice(2);
assertIdle();
const R = new Report(`s1-answer-${choice}${lang === 'en' ? '' : '-' + lang}`);
ensureWorkspace(WS, `st-${ST}`);
const file = `s1-${choice}-${Date.now().toString(36)}.txt`;
const browser = await launch();
const ui = await open(browser, { arm: 'head', lang });
await sleep(1000);
// The model waits 7 s before it asks for the tool, so the page is subscribed first.
const c = await createSession('web', WS, `UI_WRITE name=${file} content=approved-by-owner delay=7000`);
R.check('create a Workspace Session with a file-write request (WebShell adapter)', c.status === 202, `HTTP ${c.status} session=${c.session}`);
const S = c.session;
await selectSession(ui.page, S);
const before = calls(ui.net, '/actions/query').length;
const noCardYet = (await card(ui.page).count()) === 0;
R.check('page is on the Session before the approval exists: no card', noCardYet, `actions/query so far=${before}`);
const w = await waitCard(ui.page, { timeoutMs: 45_000 });
R.check('the approval card appears without a reload (stream-driven)', w.ok, `after ${w.ms} ms`);
await sleep(600);
const list = await listActions('web', S);
const action = list.json.data?.find((a) => a.state === 'requested');
R.check('service has exactly one requested permission Action', list.json.data?.filter((a) => a.state === 'requested').length === 1, j(action));
const cardText = await text(card(ui.page));
R.check('card names the tool', /write_file|Write/i.test(cardText ?? ''), `card text: ${cardText}`);
const buttons = await card(ui.page).locator('[data-option-id]').allInnerTexts();
R.note('card buttons', j(buttons.map((b) => b.replace(/\s+/g, ' ').trim())));
const section = (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
const toolFacts = () => `tool_call Items=${one(`SELECT COUNT(*) FROM managed_agent_item WHERE session_id='${S}' AND item_type='tool_call'`)} item.tool_call.updated events=${one(`SELECT COUNT(*) FROM managed_agent_event WHERE session_id='${S}' AND event_type='item.tool_call.updated'`)}`;
R.check('[PR claim] the service has a tool row (tool_call Item) for the card to attach to', !toolFacts().startsWith('tool_call Items=0'), toolFacts());
R.check('[PR claim] the owner can see the call arguments (the content to be written) before answering', section.includes(written('approved-by-owner')), section.slice(0, 600));
const turn = one(`SELECT turn_id FROM managed_agent_turn WHERE session_id='${S}'`);
R.check('Action turnId is the public Turn ID and functionCallId is the tool call ID', action?.turnId === turn && !!action?.functionCallId, `turnId=${action?.turnId} db=${turn} functionCallId=${action?.functionCallId}`);
R.check('nothing ran while waiting: file absent, 0 tool executions', readWs(ST, `child/${file}`) === null && executions(S) === 0, `file=${readWs(ST, `child/${file}`)} executions=${executions(S)}`);
await shot(ui.page, `s1-${choice}-${lang}-1-pending`);

const button = option(ui.page, choice);
R.check(`the card offers a "${choice}" button`, (await button.count()) === 1, j(buttons));
const t0 = Date.now();
await button.click();
const gone = await waitNoCard(ui.page, { timeoutMs: 20_000 });
R.check('the card leaves after the answer', gone.ok, `after ${gone.ms} ms`);
const t = await waitTurn(S, { timeoutMs: 60_000 });
R.check('the Turn continues and completes', t.status === 'COMPLETED', `status=${t.status} ${t.error} ${Date.now() - t0} ms after the click`);
await sleep(2500);
const responds = calls(ui.net, '/actions/respond');
const req = responds[0]?.req;
R.check('exactly one actions/respond call, HTTP 202', responds.length === 1 && responds[0].status === 202, `calls=${responds.length} status=${responds[0]?.status}`);
R.check('respond body: optionId, revisions from the Action, idempotency key "<actionId>:<optionId>"', req?.response?.optionId === choice && req?.response?.inputRevision === action.inputRevision && req?.response?.policyRevision === action.policyRevision && req?.idempotencyKey === `${action.actionId}:${choice}` && req?.actionId === action.actionId, j(req));
const row = actionRow(action.actionId);
R.check('Action is decided in the database', row?.[0] === 'decided', j(row));
const op = responds[0]?.res?.operationId;
await sleep(500);
R.check('the action_response operation completed', opRow(op)?.[0] === 'COMPLETED', j(opRow(op)));
const content = readWs(ST, `child/${file}`);
const final = await finalText(S);
if (choice === 'allow') {
  R.check('allow: the file was written in the selected Workspace directory', content === written('approved-by-owner'), `content=${j(content)}`);
  R.check('allow: exactly one tool execution', executions(S) === 1, `executions=${executions(S)}`);
} else {
  R.check('deny: the file was not written and no tool ran', content === null && executions(S) === 0, `content=${j(content)} executions=${executions(S)}`);
  R.check('deny: the model received a refusal as the tool result', /den|refus|not approved|declin/i.test(final ?? ''), final ?? '');
}
R.note('final assistant text', final ?? '');
R.note('tool rows projected for this Session after the Turn finished', toolFacts());
const after = (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
R.check('the panel shows the final answer of the Turn', after.includes('UI_DONE'), after.slice(-500));
R.check('no approval error is shown', !/could not be sent|未能发送/.test(after), '');
R.note('actions/query calls made by the page in this scenario', String(calls(ui.net, '/actions/query').length));
R.note('browser console errors', j(ui.consoleErrors));
await shot(ui.page, `s1-${choice}-${lang}-2-after`);
await browser.close();
R.done({ session: S, action: action?.actionId, file });
process.exit(0);
