// VERIFICATION RIG ONLY (PR #13973): drive the real standalone ManagedAgentWebShell (vite from
// the arm's worktree) against the rig's real Spring + Hosted Harness + MySQL. Verdicts come from
// MySQL rows and the scripted model's call log, never from page text alone.
// Round 2 (head 5c90f489): F1 Abandon copy + list refresh, N2 recovery controls only after settle.
// usage: node ui/scenarios-r2.mjs <arm> [F1a,F1b,...]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13973-rig/src-merge/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13973-rig';
const [arm, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',') : null;
const want = (c) => !only || only.includes(c);
const st = JSON.parse(fs.readFileSync(`${RIG}/state/serve-merge.json`, 'utf8'));
const port = Number(process.env.PORT) || { merge: 5973, main: 5974, head: 5975 }[arm];
const WEB = '/api/agent/web-shell/v1';
const D = st.definitions;
const PRESETS = [{ agentId: D.A.agentId, label: 'Rig Model A' }, { agentId: D.B.agentId, label: 'Rig Model B' }];
const outFile = `${RIG}/results/r2-${arm}.json`;
const out = fs.existsSync(outFile) && only ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { arm, started: new Date().toISOString(), checks: [] };
if (only) out.checks = out.checks.filter((c) => !only.includes(c.name.split(' ')[0]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail) => {
  out.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
};
const sql = (q) => {
  const r = spawnSync(`${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`, ['--protocol=tcp', '-h127.0.0.1', '-P23973', '-uroot', '--batch', '--skip-column-names', st.db, '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const sessionRow = (sid) => {
  const [agent, ws, cwd, creator] = sql(`SELECT agent_id, workspace_id, cwd_relative, creator_actor_key FROM managed_agent_session WHERE session_id='${sid}'`).split('\t');
  return { agent, ws, cwd, creator };
};
const turns = (sid) => sql(`SELECT CONCAT(status, '|', input_json) FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at`).split('\n').filter(Boolean);
const turnsWith = (marker) => Number(sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE input_json LIKE '%${marker}%'`));
const sessionsWith = (marker) => sql(`SELECT DISTINCT session_id FROM managed_agent_turn WHERE input_json LIKE '%${marker}%'`).split('\n').filter(Boolean);
async function waitTurnsSettled(marker, ms = 60000) {
  const end = Date.now() + ms;
  let s = '';
  while (Date.now() < end) {
    s = sql(`SELECT GROUP_CONCAT(status) FROM managed_agent_turn WHERE input_json LIKE '%${marker}%'`);
    if (s && s.split(',').every((x) => /^(COMPLETED|FAILED|CANCELLED)$/.test(x))) return s;
    await sleep(250);
  }
  return s;
}
const control = (p) => fetch(`http://127.0.0.1:${st.controlPort}${p}`).then((r) => r.json());
const modelCalls = async (marker) => (await control('/model')).filter((c) => c.turnCall && c.marker === marker);
const mk = (tag) => `RIG_TEXT_${tag}${randomBytes(2).toString('hex')}`;
const rev = (s) => s.split('').reverse().join('');

const browser = await chromium.launch({ headless: true });
async function open({ width = 1280, height = 800, query = '', ctx, lang, legacy = false } = {}) {
  ctx ??= await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const net = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith(WEB)) return;
    const e = { t: Date.now(), dir: 'req', path: u.pathname.slice(WEB.length) };
    try { e.body = JSON.parse(r.postData() ?? 'null'); } catch {}
    net.push(e);
  });
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith(WEB) || u.pathname.endsWith('/events/stream')) return;
    const e = { t: Date.now(), dir: 'res', path: u.pathname.slice(WEB.length), status: r.status() };
    try { e.body = await r.json(); } catch {}
    net.push(e);
  });
  page.on('requestfailed', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith(WEB)) net.push({ t: Date.now(), dir: 'failed', path: u.pathname.slice(WEB.length), err: r.failure()?.errorText });
  });
  const url = legacy ? `http://localhost:${port}/e2e/fixtures/rig-13973-legacy.html` : `http://localhost:${port}/e2e/fixtures/rig-13973.html?presets=${encodeURIComponent(JSON.stringify(PRESETS))}${lang ? `&lang=${lang}` : ''}${query}`;
  await page.goto(url);
  await page.locator('.cm-content, #managed-workspace-select').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  return { page, ctx, net, errors, url };
}
const reqs = (net, path) => net.filter((e) => e.dir === 'req' && e.path === path);
const shot = (page, name) => page.screenshot({ path: `${RIG}/fig/raw/${arm}-${name}.png` });
const editor = (page) => page.locator('.cm-content[contenteditable="true"]').last();
async function chooseWorkspace(page, name) {
  await page.click('button[aria-label="Workspace"]');
  await page.locator('[role=menuitemradio]', { hasText: name }).first().click();
  await sleep(300);
}
async function chooseModel(page, label) {
  await page.click('[data-web-shell-model-button]');
  await page.locator('[data-web-shell-toolbar-popover] button', { hasText: label }).first().click();
  await sleep(300);
}
async function setDir(page, dir) {
  await page.locator('details summary').first().click();
  await page.fill('#managed-workspace-cwd', dir);
  await page.locator('details summary').first().click();
}
async function typeText(page, text) {
  await editor(page).click();
  await page.keyboard.type(text);
}
async function send(page, text) {
  await typeText(page, text);
  await page.keyboard.press('Enter');
}
const editorText = (page) => page.locator('.cm-content').last().evaluate((e) => { const c = e.cloneNode(true); c.querySelectorAll('.cm-placeholder, .cm-widgetBuffer').forEach((n) => n.remove()); return c.innerText.replace(/[\u200b\u00a0]/g, ' ').trim(); }).catch(() => '<none>');
const draftKeys = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => /draft/i.test(k)).map((k) => [k, localStorage.getItem(k)])));
const overflow = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, bodyScrollW: document.body.scrollWidth }));
const box = async (page, sel) => { const b = await page.locator(sel).last().boundingBox(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
async function waitConversation(page, ms = 30000) {
  await page.locator('[data-managed-model]').first().waitFor({ timeout: ms });
}
async function waitAnswer(page, marker, ms = 30000) {
  // The reply names the reversed marker, so the user bubble cannot satisfy it.
  await page.getByText(rev(marker), { exact: false }).first().waitFor({ timeout: ms });
}
const sidebarSelect = async (page, sid) => {
  await page.locator('nav button', { hasText: sid.slice(0, 8) }).first().click();
  await sleep(1200);
};


// ---- round-2 helpers ----
const UNCONF = 'Creation is unconfirmed';
const ABANDON = 'Abandon local confirmation';
const listed = (page, sid) => page.locator('nav button', { hasText: sid.slice(0, 8) }).count();
async function waitListed(page, sid, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await listed(page, sid)) > 0) return Date.now(); await sleep(150); }
  return 0;
}
// Non-waiting probes: every read is guarded by count() so a missing element returns null at once
// (Playwright's default 30 s auto-wait would otherwise sample the page long after the moment).
const peek = async (loc, fn) => ((await loc.count()) > 0 ? fn(loc).catch(() => null) : null);
const snapshot = async (page) => ({
  t: Date.now(),
  unconfirmed: await page.getByText(UNCONF).count(),
  abandonBtn: await page.getByRole('button', { name: ABANDON }).count(),
  retryBtn: await page.getByRole('button', { name: /^Retry/ }).count(),
  editorDisabled: (await page.locator('.cm-content[contenteditable="false"]').count()) > 0,
  editorText: await peek(page.locator('.cm-content').last(), () => editorText(page)),
  workspaceChip: await peek(page.locator('button[aria-label="Workspace"]').first(), (l) => l.innerText({ timeout: 500 })),
  legacySelect: await peek(page.locator('#managed-workspace-select').first(), (l) => l.innerText({ timeout: 500 })),
  legacySelectDisabled: await peek(page.locator('#managed-workspace-select').first(), (l) => l.isDisabled({ timeout: 500 })),
  legacyCreateDisabled: await peek(page.getByRole('button', { name: 'Create session' }).first(), (l) => l.isDisabled({ timeout: 500 })),
  conversation: (await page.locator('[data-managed-model]').count()) > 0,
});
const warningText = (page) => page.getByText('Abandoning this record').first().innerText().catch(() => '');
const observeUnconfirmed = async (page) => {
  const appeared = [];
  await page.exposeFunction('__seen2', (t) => appeared.push(t));
  await page.evaluate(() => {
    const seen = new Set();
    new MutationObserver(() => {
      const txt = document.body.innerText;
      for (const k of ['Creation is unconfirmed', 'Abandon local confirmation']) if (txt.includes(k) && !seen.has(k)) { seen.add(k); window.__seen2(k); }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return appeared;
};

// ---------------- F1a: direct input, lost create -> warning copy -> Abandon -> list refresh ----------------
if (want('F1a')) {
  const m = mk('f1a');
  const { page, ctx, net, errors } = await open();
  let sid; let lost = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); try { sid = (await r.json()).sessionId; } catch {} if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await chooseWorkspace(page, 'Project Beta');
  await chooseModel(page, 'Rig Model A');
  await send(page, `${m} write a summary file`);
  await page.getByText(UNCONF).first().waitFor({ timeout: 20000 });
  const status = await waitTurnsSettled(m);
  const warning = await warningText(page);
  const before = { listed: await listed(page, sid), queries: reqs(net, '/sessions/query').length, sessions: sessionsWith(m).length, turns: turnsWith(m), status, modelCalls: (await modelCalls(m)).length };
  await shot(page, 'f1a-before-abandon');
  check('F1a server state when the unconfirmed block shows: 1 Session, 1 Turn run, 1 model call', before.sessions === 1 && before.turns === 1 && before.modelCalls === 1 && status === 'COMPLETED', before);
  check('F1a warning describes possibly running input and repeat effects (not "empty session")', /A session with this input may already exist or be running\./.test(warning) && /does not cancel it/.test(warning) && /may repeat its effects/.test(warning) && !/empty session/.test(warning), warning);
  check('F1a admitted Session is not listed before Abandon', before.listed === 0, before);
  const tAb = Date.now();
  await page.getByRole('button', { name: ABANDON }).click();
  const tListed = await waitListed(page, sid);
  await sleep(1500);
  const after = { listed: await listed(page, sid), msToListed: tListed ? tListed - tAb : null, queries: reqs(net, '/sessions/query').length, text: await editorText(page), editorEnabled: (await page.locator('.cm-content[contenteditable="true"]').count()) > 0, unconfirmed: await page.getByText(UNCONF).count() };
  await shot(page, 'f1a-after-abandon');
  check('F1a Abandon refreshes the Session list and the admitted Session appears', after.listed > 0 && after.queries > before.queries, { before: before.queries, after });
  check('F1a Abandon restores the draft into an enabled composer, block gone', after.text === `${m} write a summary file` && after.editorEnabled && after.unconfirmed === 0, after);
  const sideEffects = net.filter((e) => e.dir === 'req' && /cancel|delete|turns\/submit/.test(e.path)).map((e) => e.path);
  check('F1a Abandon sends no cancel/delete/submit and creates nothing', sideEffects.length === 0 && reqs(net, '/sessions/create').length === 1 && sessionsWith(m).length === 1, { sideEffects, creates: reqs(net, '/sessions/create').length });
  // The listed Session opens and shows the already-run first input.
  let shown = 0;
  if (after.listed > 0) {
    await page.locator('nav button', { hasText: sid.slice(0, 8) }).first().click();
    await page.getByText(rev(m)).first().waitFor({ timeout: 20000 }).catch(() => {});
    shown = await page.getByText(rev(m)).count();
    await shot(page, 'f1a-open-orphan');
  }
  check('F1a opening the listed Session shows the already-run input and its answer', shown > 0, { shown });
  check('F1a no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- F1z: zh-CN copy of the new warning ----------------
if (want('F1z')) {
  const m = mk('f1z');
  const { page, ctx, errors } = await open({ lang: 'zh' });
  let lost = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await page.click('button[aria-label="工作区"], button[aria-label="Workspace"]');
  await page.locator('[role=menuitemradio]', { hasText: 'Project Beta' }).first().click();
  await sleep(300);
  await send(page, `${m} zh`);
  await page.getByText('放弃记录不会').first().waitFor({ timeout: 20000 });
  const txt = await page.getByText('放弃记录不会').first().innerText();
  await waitTurnsSettled(m);
  await shot(page, 'f1z-zh-warning');
  check('F1z zh-CN shows the input-specific warning', /包含该输入的会话可能已存在或仍在运行/.test(txt) && /可能重复执行/.test(txt) && !/原空会话/.test(txt), txt);
  check('F1z no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- F1c: accepted identity, read-back lost -> Abandon ----------------
if (want('F1c')) {
  const m = mk('f1c');
  const { page, ctx, net, errors } = await open();
  let sid; let createDone = false; let getsLost = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); try { sid = (await r.json()).sessionId; } catch {} createDone = true; return route.fulfill({ response: r }); });
  await page.route(`**${WEB}/sessions/get`, async (route) => { if (createDone && getsLost === 0) { getsLost++; return route.abort('failed'); } return route.continue(); });
  await chooseWorkspace(page, 'Project Alpha');
  await send(page, `${m} readback lost then abandon`);
  await page.getByRole('button', { name: 'Retry reading session' }).waitFor({ timeout: 20000 });
  await waitTurnsSettled(m);
  const warning = await warningText(page);
  const shownId = await page.getByText(sid ?? 'none').count();
  check('F1c read-back lost: block shows the accepted Session id and the input warning', shownId > 0 && /may already exist or be running/.test(warning), { sid, shownId, warning });
  await page.getByRole('button', { name: ABANDON }).click();
  const tListed = await waitListed(page, sid);
  await sleep(800);
  check('F1c Abandon lists the accepted Session; draft restored; still 1 create', tListed > 0 && (await editorText(page)) === `${m} readback lost then abandon` && reqs(net, '/sessions/create').length === 1 && sessionsWith(m).length === 1, { listed: tListed > 0, text: await editorText(page), creates: reqs(net, '/sessions/create').length });
  check('F1c no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- F1d: legacy empty-only provider, lost create -> legacy copy -> Abandon -> list ----------------
if (want('F1d')) {
  const { page, ctx, net, errors } = await open({ legacy: true });
  let sid; let lost = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); try { sid = (await r.json()).sessionId; } catch {} if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await page.click('#managed-workspace-select');
  await page.locator('[role=option]', { hasText: 'Project Beta' }).first().click();
  await sleep(300);
  await page.getByRole('button', { name: 'Create session' }).click();
  await page.getByText(UNCONF).first().waitFor({ timeout: 20000 });
  const warning = await warningText(page);
  const body = reqs(net, '/sessions/create')[0]?.body;
  check('F1d legacy lost create keeps the empty-session warning (input=[])', /original empty session may still exist/.test(warning) && !/this input/.test(warning) && Array.isArray(body?.input) && body.input.length === 0, { warning, input: body?.input });
  await shot(page, 'f1d-legacy-before-abandon');
  const q0 = reqs(net, '/sessions/query').length;
  await page.getByRole('button', { name: ABANDON }).click();
  const tListed = await waitListed(page, sid);
  await sleep(800);
  await shot(page, 'f1d-legacy-after-abandon');
  check('F1d legacy Abandon also refreshes the list: the empty Session appears; form back', tListed > 0 && reqs(net, '/sessions/query').length > q0 && (await page.locator('#managed-workspace-select').count()) === 1, { listed: tListed > 0, queries: [q0, reqs(net, '/sessions/query').length], sid });
  check('F1d no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- N2a: normal creates with a held response: no recovery UI while in flight ----------------
if (want('N2a')) {
  const HOLD = 2500;
  const res = [];
  for (let i = 0; i < 3; i++) {
    const m = mk(`n2a${i}`);
    const { page, ctx, net, errors } = await open();
    const appeared = await observeUnconfirmed(page);
    let releasedAt = 0; let mid;
    await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); await sleep(HOLD); releasedAt = Date.now(); return route.fulfill({ response: r }); });
    await chooseWorkspace(page, 'Project Beta');
    await send(page, `${m} held create`);
    await sleep(1200);
    mid = await snapshot(page);
    if (i === 0) await shot(page, 'n2a-in-flight');
    await waitConversation(page);
    await waitTurnsSettled(m);
    await sleep(600);
    res.push({ i, mid, appeared: [...appeared], creates: reqs(net, '/sessions/create').length, sessions: sessionsWith(m).length, turns: turnsWith(m), text: await editorText(page), errors });
    await ctx.close();
  }
  check('N2a 3 held creates: no "unconfirmed"/Abandon at any time; composer disabled with the text while in flight', res.every((r) => r.appeared.length === 0 && r.mid.unconfirmed === 0 && r.mid.abandonBtn === 0 && r.mid.retryBtn === 0 && r.mid.editorDisabled && /held create/.test(r.mid.editorText)), res.map((r) => ({ appeared: r.appeared, mid: r.mid })));
  check('N2a each create admitted once, 1 Turn, composer empty after', res.every((r) => r.creates === 1 && r.sessions === 1 && r.turns === 1 && r.text === '' && r.errors.length === 0), res.map((r) => ({ creates: r.creates, sessions: r.sessions, turns: r.turns, text: r.text, errors: r.errors })));
}

// ---------------- N2b: direct input, lost create -> reload -> Retry held in flight ----------------
if (want('N2b')) {
  const m = mk('n2b');
  const { page, ctx, net, errors } = await open();
  let n = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => {
    const k = n++;
    const r = await route.fetch();
    if (k === 0) return route.abort('failed');
    await sleep(3000);
    return route.fulfill({ response: r });
  });
  await chooseWorkspace(page, 'Project Beta');
  await chooseModel(page, 'Rig Model B');
  await send(page, `${m} retry in flight`);
  await page.getByText(UNCONF).first().waitFor({ timeout: 20000 });
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request' }).first().waitFor({ timeout: 20000 });
  await sleep(800);
  const afterReload = await snapshot(page);
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).click();
  await sleep(1200);
  const mid = await snapshot(page);
  await shot(page, 'n2b-retry-in-flight');
  await waitConversation(page);
  await waitTurnsSettled(m);
  await sleep(800);
  const creates = reqs(net, '/sessions/create');
  check('N2b during the retry: block hidden, composer disabled showing the pending input and Workspace', mid.unconfirmed === 0 && mid.abandonBtn === 0 && mid.editorDisabled && /retry in flight/.test(mid.editorText) && /Project Beta|W2/.test(mid.workspaceChip ?? ''), { afterReload, mid });
  check('N2b retry replays the same key; 1 Session, 1 Turn; composer empty', creates.length === 2 && creates[0].body.idempotencyKey === creates[1].body.idempotencyKey && sessionsWith(m).length === 1 && turnsWith(m) === 1 && (await editorText(page)) === '', { keys: creates.map((c) => c.body.idempotencyKey), sessions: sessionsWith(m).length, turns: turnsWith(m), text: await editorText(page) });
  check('N2b no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- N2c: legacy, lost create -> reload -> Retry held in flight ----------------
if (want('N2c')) {
  const { page, ctx, net, errors } = await open({ legacy: true });
  let n = 0; let sid;
  await page.route(`**${WEB}/sessions/create`, async (route) => {
    const k = n++;
    const r = await route.fetch();
    try { sid = (await r.json()).sessionId; } catch {}
    if (k === 0) return route.abort('failed');
    await sleep(3000);
    return route.fulfill({ response: r });
  });
  await page.click('#managed-workspace-select');
  await page.locator('[role=option]', { hasText: 'Project Beta' }).first().click();
  await sleep(300);
  await page.getByRole('button', { name: 'Create session' }).click();
  await page.getByText(UNCONF).first().waitFor({ timeout: 20000 });
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).waitFor({ timeout: 20000 });
  await sleep(800);
  const afterReload = { ...(await snapshot(page)), pendingText: await page.getByText('W2 /').first().innerText().catch(() => null) };
  const tClick = Date.now();
  const timeline = [];
  page.on('request', (r) => { if (r.url().includes('/sessions/')) timeline.push({ t: Date.now() - tClick, req: new URL(r.url()).pathname.split('/').pop() }); });
  page.on('response', (r) => { if (r.url().includes('/sessions/')) timeline.push({ t: Date.now() - tClick, res: new URL(r.url()).pathname.split('/').pop(), status: r.status() }); });
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).click();
  const samples = [];
  let mid;
  for (let i = 0; i < 6; i++) {
    await sleep(400);
    const snap = await snapshot(page);
    samples.push({ t: Date.now() - tClick, ...snap });
    if (i === 1) { mid = snap; await shot(page, 'n2c-legacy-retry-in-flight'); }
  }
  console.log('N2c timeline', JSON.stringify(timeline));
  console.log('N2c samples', JSON.stringify(samples.map((x) => ({ t: x.t, unconfirmed: x.unconfirmed, sel: x.legacySelect, createDisabled: x.legacyCreateDisabled, editor: x.editorText }))));
  await editor(page).waitFor({ timeout: 30000 });
  await sleep(1000);
  const creates = reqs(net, '/sessions/create');
  const row = sid ? sessionRow(sid) : {};
  check('N2c legacy retry in flight: the form re-renders (all controls disabled) instead of the pending block', mid.unconfirmed === 0 && mid.legacySelect !== null && mid.legacyCreateDisabled === true, { afterReload, mid });
  check('N2c legacy retry: same key, Session bound to the pending Workspace W2', creates.length === 2 && creates[0].body.idempotencyKey === creates[1].body.idempotencyKey && row.ws === 'W2', { keys: creates.map((c) => c.body.idempotencyKey), row, formShowedDuringRetry: mid.legacySelect });
  check('N2c no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- N2d: first create whose response never arrives; reload recovers ----------------
if (want('N2d')) {
  const m = mk('n2d');
  const { page, ctx, net, errors } = await open();
  let n = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { if (n++ === 0) { await route.fetch(); await new Promise(() => {}); } return route.continue(); });
  await chooseWorkspace(page, 'Project Alpha');
  await send(page, `${m} hung create`);
  await sleep(8000);
  const mid = { ...(await snapshot(page)), serverTurns: turnsWith(m) };
  await shot(page, 'n2d-hung-create');
  check('N2d hung create (server admitted): no recovery controls while in flight, composer disabled', mid.unconfirmed === 0 && mid.abandonBtn === 0 && mid.retryBtn === 0 && mid.editorDisabled && mid.serverTurns === 1, mid);
  await page.unroute(`**${WEB}/sessions/create`);
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).waitFor({ timeout: 20000 }).catch(() => {});
  const afterReload = await snapshot(page);
  check('N2d reload shows the unconfirmed block with Retry/Abandon and the input warning', afterReload.unconfirmed > 0 && afterReload.retryBtn > 0 && afterReload.abandonBtn > 0 && /may already exist or be running/.test(await warningText(page)), afterReload);
  await page.getByRole('button', { name: 'Retry the same request', exact: true }).click();
  await waitConversation(page);
  await waitTurnsSettled(m);
  await sleep(800);
  const creates = reqs(net, '/sessions/create');
  check('N2d retry replays the same key; 1 Session, 1 Turn', creates.length === 2 && creates[0].body.idempotencyKey === creates[1].body.idempotencyKey && sessionsWith(m).length === 1 && turnsWith(m) === 1, { keys: creates.map((c) => c.body.idempotencyKey), sessions: sessionsWith(m).length, turns: turnsWith(m) });
  check('N2d no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
const failed = out.checks.filter((c) => !c.ok);
console.log(`\n${arm}: ${out.checks.length - failed.length}/${out.checks.length} passed`);
