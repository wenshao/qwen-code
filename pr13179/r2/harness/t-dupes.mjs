// VERIFICATION RIG ONLY (PR #13179 round 2): can a real transcript page carry duplicate event ids?
// The bootstrap assigns provider.getTranscript().events verbatim (no dedupe), and the PR's append fast path no
// longer dedupes `current`. This loads the REAL provider module through vite in the head arm's page and reads
// transcript pages (limit 100, as the hook does) continuously while turns stream, then re-reads every Session.
import { createSession, waitTurn, ensureWorkspace, WS, ST, Report, j, submit, steps, sql, sleep } from './lib.mjs';
import { launch, open } from './ui.mjs';
const r = new Report('t-dupes');
ensureWorkspace(WS, `st-${ST}`);
const b = await launch();
const p = await open(b, { arm: 'head', scale: 1 });
await p.page.waitForTimeout(1500);
await p.page.evaluate(async () => {
  const m = await import('/components/managed/java-managed-agent-provider.ts');
  const q = new URLSearchParams(location.search);
  window.__prov = m.createJavaManagedAgentProvider({ baseUrl: location.origin, getHeaders: () => ({ 'X-Qwen-Tenant-Id': 't-ui', 'X-Rig-Actor': q.get('actor') ?? 'alice' }) });
  window.__check = async (sessionId, before) => {
    const t = await window.__prov.getTranscript(sessionId, { limit: 100, ...(before ? { before } : {}) });
    const ids = t.events.map((e) => e.id);
    const seen = new Map();
    for (const e of t.events) seen.set(e.id, [...(seen.get(e.id) ?? []), `${e.type}${e.assembledFromItem ? '*' : ''}`]);
    const dups = [...seen].filter(([, v]) => v.length > 1);
    const sorted = ids.every((x, i) => i === 0 || x >= ids[i - 1]);
    const items = t.events.filter((e) => e.assembledFromItem).length;
    return { n: ids.length, items, raw: ids.length - items, dups: dups.slice(0, 5), dupCount: dups.length, sorted, olderCursor: t.olderCursor, lastEventId: t.lastEventId };
  };
});
r.check('real provider module loaded in the page', await p.page.evaluate(() => typeof window.__check === 'function'));
async function hammer(session, untilDone) {
  let reads = 0, withDup = 0, mixed = 0, example;
  const stop = Date.now() + 120_000;
  while (Date.now() < stop) {
    const x = await p.page.evaluate((s) => window.__check(s), session).catch((e) => ({ error: String(e) }));
    if (!x.error) { reads++; if (x.items && x.raw) mixed++; if (x.dupCount) { withDup++; example ??= x; } }
    if (await untilDone()) break;
    await sleep(30);
  }
  return { reads, withDup, mixed, example };
}
const scenarios = [
  ['streamed 1500 deltas', 'UI_STREAM n=1500 delay=3 tag=DUP'],
  ['streamed 300 paragraphs', 'UI_STREAM n=300 delay=10 para=1 tag=DUQ'],
  ['tool calls (write/read/edit)', steps([['write_file', { file_path: 'dup-a.txt', content: 'one' }], ['read_file', { file_path: 'dup-a.txt' }], ['edit', { file_path: 'dup-a.txt', old_string: 'one', new_string: 'two' }], ['write_file', { file_path: 'dup-b.txt', content: 'x' }]])],
];
const sessions = [];
for (const [label, text] of scenarios) {
  const c = await createSession('public', WS, 'UI_STREAM n=3 delay=0 tag=PRE');
  await waitTurn(c.session);
  sessions.push(c.session);
  await submit(c.session, text);
  let done = false;
  const watcher = waitTurn(c.session, { timeoutMs: 120_000 }).then((t) => { done = t; });
  const h = await hammer(c.session, async () => done);
  await watcher;
  r.check(`${label}: no transcript page with duplicate ids while streaming`, h.withDup === 0, `${h.reads} reads (${h.mixed} mixing item projections with raw tail events), ${h.withDup} with duplicates${h.example ? ' e.g. ' + j(h.example.dups) : ''} turn=${done.status}`);
}
// every Session the rig has, every page (paging with olderCursor as loadOlder does)
const all = sql(`SELECT session_id FROM managed_agent_session`).map((x) => x[0]);
let pagesRead = 0, pagesDup = 0, unsorted = 0;
for (const s of all) {
  let before;
  for (let k = 0; k < 200; k++) {
    const x = await p.page.evaluate(([s, c]) => window.__check(s, c), [s, before]).catch((e) => ({ error: String(e) }));
    if (x.error) break;
    pagesRead++; if (x.dupCount) pagesDup++; if (!x.sorted) unsorted++;
    if (!x.olderCursor) break;
    before = x.olderCursor;
  }
}
r.check(`all ${all.length} Sessions, every page at rest: no duplicate ids`, pagesDup === 0, `${pagesRead} pages, ${pagesDup} with duplicates, ${unsorted} unsorted`);
await b.close();
r.done({ sessions });
