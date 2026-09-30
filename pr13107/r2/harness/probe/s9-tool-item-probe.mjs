// VERIFICATION RIG ONLY (PR #13107): if the Hosted Harness did publish a tool call, would its arguments reach
// the page? The tap rewrites one real Harness SSE frame (an agent_message_chunk carrying a marker) into a
// tool_call session update with rawInput/input, keeping the frame id. Everything after that is the real
// Java projector, store, WebShell adapter and page.
// usage: DB=<db> node s9-tool-item-probe.mjs
import { api, createSession, ensureWorkspace, waitTurn, sql, setTapRules, tapEntries, Report, sleep, j, assertIdle, WS, ST } from './lib.mjs';
import { launch, open, shot } from './ui.mjs';
assertIdle();
const R = new Report('s9-tool-item-probe');
ensureWorkspace(WS, `st-${ST}`);
const marker = `UI_TOOLCALL_PROBE_${Date.now().toString(36)}`;
const secret = `PROBE-ARGUMENT-BYTES-${Date.now().toString(36)}`;
setTapRules([{ match: '^NEVER$', action: 'sse-tool-call', times: 1, marker, toolCallId: 'probe-call-1', rawInput: { file_path: 'probe.txt', content: secret } }]);
const c = await createSession('web', WS, `UI_ECHO say=${marker}`);
const S = c.session;
const t = await waitTurn(S, { timeoutMs: 60_000 });
await sleep(1500);
setTapRules([]);
const rewritten = tapEntries().filter((e) => e.fault === 'sse-tool-call' && e.frame.includes(secret));
R.check('the tap turned one real Harness frame into a tool_call update with arguments', rewritten.length === 1, rewritten[0]?.frame.slice(0, 300) ?? 'no rewrite');
const events = sql(`SELECT event_type, data_json FROM managed_agent_event WHERE session_id='${S}' AND event_type='item.tool_call.updated'`);
const items = sql(`SELECT item_type, attributes_json FROM managed_agent_item WHERE session_id='${S}' AND item_type='tool_call'`);
R.check('Java projected it: one item.tool_call.updated event and one tool_call Item', events.length === 1 && items.length === 1, `events=${events.length} items=${items.length} turn=${t.status}`);
R.note('stored event data', events[0]?.[1] ?? '');
R.note('stored Item attributes', items[0]?.[1] ?? '');
R.check('the stored event and Item keep the call arguments', (events[0]?.[1] ?? '').includes(secret) && (items[0]?.[1] ?? '').includes(secret), `argument bytes in event=${(events[0]?.[1] ?? '').includes(secret)} item=${(items[0]?.[1] ?? '').includes(secret)}`);
const tr = await api('POST', '/api/agent/web-shell/v1/transcript/query', { sessionId: S, limit: 100 });
const tool = tr.json.items?.find((i) => i.type === 'tool_call');
R.note('WebShell transcript tool_call Item', j(tool));
R.check('the WebShell transcript Item carries an input the page could show', !!tool && ('input' in (tool.attributes ?? {}) || 'rawInput' in (tool.attributes ?? {})), `attribute keys=${j(Object.keys(tool?.attributes ?? {}))}`);
const browser = await launch();
const ui = await open(browser, { arm: 'head', session: S });
await sleep(4000);
const section = (await ui.page.locator('section').first().innerText()).replace(/\n+/g, ' | ');
R.note('panel text for this Session', section.slice(0, 500));
R.check('the panel shows the probe call arguments', section.includes(secret), '');
await shot(ui.page, 's9-tool-item-probe');
await browser.close();
R.done({ session: S });
process.exit(0);
