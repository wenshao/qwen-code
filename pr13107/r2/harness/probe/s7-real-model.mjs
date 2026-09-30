// VERIFICATION RIG ONLY (PR #13107): the PR's end-to-end test plan with a real model (no scripted replies).
// "start the Java server with Workspace files and an approval mode of default, create a Workspace-bound Session,
//  and ask for a file write ... allowing it should let the Turn continue, and denying it should give the model a refusal."
// usage: DB=<db> node s7-real-model.mjs <allow|deny>
import { createSession, ensureWorkspace, listActions, waitTurn, readWs, executions, api, sql, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, selectSession, waitCard, shot, card, calls, text, option } from './ui.mjs';
assertIdle();
const [choice = 'allow'] = process.argv.slice(2);
const R = new Report(`s7-real-model-${choice}`);
ensureWorkspace(WS, `st-${ST}`);
const file = `real-${choice}-${Date.now().toString(36)}.md`;
const prompt = `Create a file named ${file} in the current directory whose only content is the single line: reviewed by the session owner. Do not read or list anything first. When the tool result comes back, reply with one short sentence saying what happened.`;
const browser = await launch();
const ui = await open(browser, { arm: 'head' });
await sleep(800);
const c = await createSession('web', WS, prompt);
const S = c.session;
R.check('create a Workspace Session with a natural-language file-write request', c.status === 202, `session=${S}`);
await selectSession(ui.page, S);
const seen = [];
let answered = 0;
for (;;) {
  const turn = sql(`SELECT status FROM managed_agent_turn WHERE session_id='${S}'`)[0]?.[0];
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(turn)) break;
  const list = await listActions('web', S);
  const a = list.json.data?.find((x) => x.state === 'requested' && !seen.includes(x.actionId));
  if (a && (await card(ui.page).count()) === 1) {
    seen.push(a.actionId);
    await sleep(400);
    answered += 1;
    R.check(`approval ${answered}: the real model's ${a.toolName} call waits on a card in the panel`, true, `card="${await text(card(ui.page))}" call=${a.functionCallId}`);
    R.check(`approval ${answered}: nothing ran yet`, readWs(ST, `child/${file}`) === null, `file=${readWs(ST, `child/${file}`)} executions=${executions(S)}`);
    if (answered === 1) await shot(ui.page, `s7-real-${choice}-1-pending`);
    await option(ui.page, choice).click();
  }
  if (answered > 6) break;
  await sleep(250);
}
const t = await waitTurn(S, { timeoutMs: 120_000 });
R.check('the Turn completes', t.status === 'COMPLETED', `status=${t.status} ${t.error}`);
await sleep(2500);
R.check('at least one approval was asked and answered from the panel', answered >= 1 && calls(ui.net, '/actions/respond').every((r) => r.status === 202), `approvals=${answered} responds=${calls(ui.net, '/actions/respond').length}`);
const content = readWs(ST, `child/${file}`);
if (choice === 'allow') R.check('allow: the file exists with the requested line', typeof content === 'string' && /reviewed by the session owner/.test(content), `content=${j(content)}`);
else R.check('deny: the file does not exist and no tool ran', content === null && executions(S) === 0, `content=${j(content)} executions=${executions(S)}`);
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: S, limit: 100 });
const final = tr.json.items?.filter((i) => i.role === 'assistant').flatMap((i) => i.content.map((p) => p.text)).join(' ');
R.note("the model's final answer", (final ?? '').slice(0, 400));
const plain = (v) => v.replace(/[`*_"'“”]/g, '').replace(/\s+/g, ' ').trim();
R.check('the panel shows the final answer', plain(await ui.page.locator('section').first().innerText()).includes(plain(final ?? '').slice(0, 40)), plain(final ?? '').slice(0, 40));
await shot(ui.page, `s7-real-${choice}-2-after`);
R.note('console errors', j(ui.consoleErrors));
await browser.close();
R.done({ session: S });
process.exit(0);
