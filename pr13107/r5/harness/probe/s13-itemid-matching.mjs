// VERIFICATION RIG ONLY (PR #13107): does the approval card still find its tool row after #13037 re-keyed
// Managed tool rows by itemId? (flagged by the /resolve bot in issuecomment-5926984338)
// A real pending Action; the transcript response gains one tool_call Item for that call, shaped like Java's
// materializeTool output (itemId item_tool_<uuid>, attributes toolCallId/title/kind/status/name). Variant
// "with-input" adds attributes.input, which Java does not carry today (R2-1) but the follow-up would add.
// Round 5 arms: prev = 24b26f107d (round-4 head, R4-1 present), head = 9fedb263a0 (R4-1 fix landed as 19c606bd5f).
// usage: DB=<db> node s13-itemid-matching.mjs
import { randomUUID } from 'node:crypto';
import { createSession, ensureWorkspace, waitPending, listActions, respond, waitTurn, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, waitCard, shot, card } from './ui.mjs';

assertIdle();
const R = new Report('s13-itemid-matching');
ensureWorkspace(WS, `st-${ST}`);
const c = await createSession('web', WS, `UI_WRITE name=s13-${Date.now().toString(36)}.txt content=s13`);
const S = c.session;
const A = (await waitPending(S, { surface: 'web' })).action;
R.note('pending Action', `turnId=${A.turnId} functionCallId=${A.functionCallId}`);
const browser = await launch();
const NOTICE = /Tool arguments are unavailable for this approval/;
const results = {};
for (const variant of ['java-shape', 'with-input']) {
  for (const arm of ['prev', 'head']) {
    const ui = await open(browser, { arm });
    await ui.page.route('**/api/agent/web-shell/v1/transcript/query', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const seq = (body.lastSequence ?? 0) + 1000;
      const attributes = { toolCallId: A.functionCallId, title: 'WriteFile', kind: 'tool_call', status: 'pending', name: 'write_file' };
      if (variant === 'with-input') attributes.input = { file_path: 'probe.txt', content: 'INJECTED-ARGUMENT-BYTES' };
      body.items = [
        ...(body.items ?? []),
        { itemId: `item_tool_${randomUUID()}`, sessionId: S, turnId: A.turnId, type: 'tool_call', role: 'assistant', status: 'in_progress', content: [], attributes, firstSequence: seq, lastSequence: seq, createdAt: Date.now(), updatedAt: Date.now() },
      ];
      return route.fulfill({ response, json: body });
    });
    await ui.page.evaluate((s) => window.__rig.select(s), S);
    await waitCard(ui.page);
    await sleep(800);
    const cardText = (await card(ui.page).innerText()).replace(/\s+/g, ' ');
    const section = (await ui.page.locator('section').first().innerText()).replace(/\s+/g, ' ');
    const r = {
      notice: NOTICE.test(cardText),
      argsOnCard: cardText.includes('INJECTED-ARGUMENT-BYTES'),
      toolRowInTranscript: /WriteFile/.test(section.replace(cardText, '')),
    };
    results[`${variant}/${arm}`] = r;
    R.note(`${variant} · ${arm}`, j(r));
    await shot(ui.page, `s13-${variant}-${arm}`);
    await ui.context.close();
  }
}
R.check('[with-input] 24b26f107d (round-4 head): the itemId row is not matched; the card says arguments are unavailable', !results['with-input/prev'].argsOnCard && results['with-input/prev'].notice, j(results['with-input/prev']));
R.check('[with-input] 9fedb263a0 (head, 19c606bd5f): the card finds its row again and shows the arguments', results['with-input/head'].argsOnCard && !results['with-input/head'].notice, j(results['with-input/head']));
R.check('[java-shape] both arms show the notice (Java carries no input today)', results['java-shape/prev'].notice && results['java-shape/head'].notice, j({ prev: results['java-shape/prev'], head: results['java-shape/head'] }));
await browser.close();
const l = await listActions('public', S);
if (l.json.data?.[0]) await respond('public', S, l.json.data[0], 'deny', { key: `s13-cleanup-${Date.now()}` });
R.note('cleanup', j(await waitTurn(S)));
R.done({ session: S });
process.exit(0);
