// VERIFICATION RIG ONLY (PR #13973): drive the real standalone ManagedAgentWebShell (vite from
// the arm's worktree) against the rig's real Spring + Hosted Harness + MySQL. Verdicts come from
// MySQL rows and the scripted model's call log, never from page text alone.
// usage: node ui/scenarios.mjs <arm> [C1,C3,...]
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
const outFile = `${RIG}/results/ui${process.env.R2 ? '-r2' : ''}-${arm}.json`;
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
async function open({ width = 1280, height = 800, query = '', ctx, lang } = {}) {
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
  const url = `http://localhost:${port}/e2e/fixtures/rig-13973.html?presets=${encodeURIComponent(JSON.stringify(PRESETS))}${lang ? `&lang=${lang}` : ''}${query}`;
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

const created = {};
// ---------------- C1: desktop native creation ----------------
if (want('C1')) {
  const m = mk('c1');
  const { page, ctx, net, errors } = await open();
  const appeared = [];
  await page.exposeFunction('__seen', (t) => appeared.push(t));
  await page.evaluate(() => {
    const seen = new Set();
    new MutationObserver(() => {
      const txt = document.body.innerText;
      for (const k of ['Creation is unconfirmed', 'Choose a Workspace', 'could not be confirmed']) if (txt.includes(k) && !seen.has(k)) { seen.add(k); window.__seen(k); }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  check('C1 welcome+composer rendered (no legacy form)', (await page.locator('#managed-workspace-select').count()) === 0 && (await editor(page).count()) === 1, { form: await page.locator('#managed-workspace-select').count() });
  check('C1 send disabled before text', await page.locator('[data-web-shell-composer-submit]').isDisabled(), '');
  await chooseWorkspace(page, 'Project Beta');
  await chooseModel(page, 'Rig Model B');
  await setDir(page, 'docs');
  await typeText(page, `${m} please summarize the docs folder`);
  await shot(page, 'c1-new-task-filled');
  const t0 = Date.now();
  await page.keyboard.press('Enter');
  await waitConversation(page);
  const tConv = Date.now() - t0;
  await waitAnswer(page, m);
  const status = await waitTurnsSettled(m);
  await sleep(800);
  const creates = reqs(net, '/sessions/create');
  const submits = reqs(net, '/turns/submit');
  const sid = creates[0] && net.find((e) => e.dir === 'res' && e.path === '/sessions/create')?.body?.sessionId;
  created.c1 = sid;
  check('C1 exactly one create, zero submit', creates.length === 1 && submits.length === 0, { creates: creates.length, submits: submits.length });
  check('C1 create payload = chosen model/Workspace/dir/first input', creates[0]?.body?.agentId === D.B.agentId && creates[0]?.body?.workspace?.workspaceId === 'W2' && creates[0]?.body?.workspace?.cwdRelative === 'docs' && JSON.stringify(creates[0]?.body?.input) === JSON.stringify([{ type: 'input_text', text: `${m} please summarize the docs folder` }]), creates[0]?.body);
  const row = sid ? sessionRow(sid) : {};
  check('C1 MySQL session pinned to preset B / W2 / docs', row.agent === D.B.agentId && row.ws === 'W2' && row.cwd === 'docs', row);
  check('C1 MySQL one initial Turn, settled COMPLETED', sid && turns(sid).length === 1 && status === 'COMPLETED', { turns: sid ? turns(sid).length : 0, status });
  const calls = await modelCalls(m);
  check('C1 model call routed to rig-model-b with preset B instructions', calls.length === 1 && calls[0].model === 'rig-model-b' && calls[0].preset === 'RIG_PRESET_B', calls.map((c) => [c.model, c.preset]));
  const badge = await page.locator('[data-managed-model]').first().innerText().catch(() => '');
  check('C1 conversation shows model preset label', /Rig Model B/.test(badge), badge);
  check('C1 composer empty after admission', (await editorText(page)) === '', await editorText(page));
  const drafts = await draftKeys(page);
  check('C1 no leftover draft containing the input', !Object.values(drafts).some((v) => String(v).includes(m)), drafts);
  check(process.env.R2 ? 'C1 no transient "unconfirmed" block during a normal create (N2 fix)' : 'C1 transient "unconfirmed" block during a normal create', process.env.R2 ? !appeared.includes('Creation is unconfirmed') : true, { appeared, msToConversation: tConv });
  await page.keyboard.press('Enter');
  await sleep(1500);
  check('C1 Enter on empty composer submits nothing', reqs(net, '/turns/submit').length === 0 && reqs(net, '/sessions/create').length === 1, { submits: reqs(net, '/turns/submit').length });
  await shot(page, 'c1-conversation');
  check('C1 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C2: narrow viewport ----------------
if (want('C2')) {
  const m = mk('c2');
  const { page, ctx, net, errors } = await open({ width: 390, height: 844 });
  await shot(page, 'c2-narrow-new');
  const o1 = await overflow(page);
  const surf = await box(page, '[data-web-shell-composer-surface]');
  check('C2 narrow new task: no horizontal overflow, composer usable width', o1.scrollW <= o1.innerW && surf && surf.w >= 300, { ...o1, surface: surf });
  await chooseWorkspace(page, 'Project Alpha');
  await chooseModel(page, 'Rig Model A');
  await send(page, `${m} narrow first input`);
  await waitConversation(page);
  await waitAnswer(page, m);
  const status = await waitTurnsSettled(m);
  const sid = net.find((e) => e.dir === 'res' && e.path === '/sessions/create')?.body?.sessionId;
  created.c2 = sid;
  const row = sid ? sessionRow(sid) : {};
  const calls = await modelCalls(m);
  check('C2 MySQL session pinned to preset A / W1 / "."', row.agent === D.A.agentId && row.ws === 'W1' && row.cwd === '.', row);
  check('C2 one create, one Turn COMPLETED, model rig-model-a', reqs(net, '/sessions/create').length === 1 && reqs(net, '/turns/submit').length === 0 && status === 'COMPLETED' && calls.length === 1 && calls[0].model === 'rig-model-a', { status, models: calls.map((c) => c.model) });
  // follow-ups to make the conversation long, then check the composer stays visible
  for (let i = 0; i < 6; i++) {
    const mi = `RIG_LONG_c2n${i}${randomBytes(2).toString('hex')}`;
    await send(page, `${mi} more`);
    await waitTurnsSettled(mi);
    await sleep(500);
  }
  await sleep(1500);
  const o2 = await overflow(page);
  const ed = await box(page, '[data-web-shell-composer-surface]');
  const vh = 844;
  check('C2 narrow long conversation: composer visible in viewport, no horizontal overflow', ed && ed.y + ed.h <= vh && ed.y > 0 && o2.scrollW <= o2.innerW, { composer: ed, ...o2 });
  await shot(page, 'c2-narrow-conversation');
  check('C2 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C3: lost create response + reload + retry ----------------
if (want('C3')) {
  const m = mk('c3');
  const { page, ctx, net, errors, url } = await open();
  let lost = 0;
  const serverSaw = [];
  await page.route(`**${WEB}/sessions/create`, async (route) => {
    const resp = await route.fetch();
    serverSaw.push({ status: resp.status(), body: await resp.json().catch(() => null) });
    if (lost++ === 0) return route.abort('failed');
    return route.fulfill({ response: resp });
  });
  await chooseWorkspace(page, 'Project Beta');
  await chooseModel(page, 'Rig Model A');
  await setDir(page, 'src');
  await send(page, `${m} lost response`);
  await page.getByText('Creation is unconfirmed').first().waitFor({ timeout: 20000 });
  await sleep(500);
  await shot(page, 'c3-unconfirmed');
  const disabledWhilePending = await editor(page).count() === 0 || (await page.locator('.cm-content[contenteditable="false"]').count()) > 0;
  check('C3 server committed the first create (response dropped in browser)', serverSaw[0]?.status === 202 && serverSaw[0]?.body?.replayed === false, serverSaw[0]);
  check('C3 composer frozen while unconfirmed', disabledWhilePending, { frozenText: await page.locator('.cm-content').last().innerText().catch(() => null) });
  const pendingStored = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('qwen-managed-workspace-create:')));
  check('C3 pending record persisted in sessionStorage', pendingStored.length === 1, pendingStored.map(([k, v]) => [k, JSON.parse(v)]));
  // reload in the same context, then retry
  await page.reload();
  await page.getByText('Creation is unconfirmed').first().waitFor({ timeout: 20000 });
  await sleep(800);
  await shot(page, 'c3-after-reload');
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  await waitConversation(page);
  await waitAnswer(page, m);
  const status = await waitTurnsSettled(m);
  await sleep(800);
  const creates = reqs(net, '/sessions/create');
  const strip = (b) => { const { requestId, ...rest } = b ?? {}; return JSON.stringify(rest); };
  check('C3 retry reused the original idempotency key and payload', creates.length === 2 && creates[0].body.idempotencyKey === creates[1].body.idempotencyKey && strip(creates[0].body) === strip(creates[1].body), creates.map((c) => c.body));
  check('C3 Java replayed the original admission', serverSaw[1]?.body?.replayed === true && serverSaw[1]?.body?.sessionId === serverSaw[0]?.body?.sessionId && serverSaw[1]?.body?.turnId === serverSaw[0]?.body?.turnId, serverSaw);
  const sids = sessionsWith(m);
  check('C3 MySQL: one Session, one Turn, COMPLETED, preset A in W2/src', sids.length === 1 && turnsWith(m) === 1 && status === 'COMPLETED' && sessionRow(sids[0]).agent === D.A.agentId && sessionRow(sids[0]).cwd === 'src', { sids, turns: turnsWith(m), status, row: sids[0] && sessionRow(sids[0]) });
  check('C3 model called once', (await modelCalls(m)).length === 1, (await modelCalls(m)).length);
  check('C3 composer empty after replayed admission', (await editorText(page)) === '', await editorText(page));
  const drafts = await draftKeys(page);
  check('C3 no draft with the admitted input survives', !Object.values(drafts).some((v) => String(v).includes(m)), drafts);
  await editor(page).click();
  await page.keyboard.press('Enter');
  await sleep(1500);
  check('C3 empty Enter after retry sends nothing', reqs(net, '/sessions/create').length === 2 && reqs(net, '/turns/submit').length === 0, { creates: reqs(net, '/sessions/create').length, submits: reqs(net, '/turns/submit').length });
  check('C3 no page errors', errors.length === 0, errors);
  created.c3 = sids[0];
  await ctx.close();
}

// ---------------- C3b: lost create response -> Abandon -> resend ----------------
if (want('C3b')) {
  const m = mk('c3b');
  const { page, ctx, net, errors } = await open();
  let lost = 0;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await chooseWorkspace(page, 'Project Alpha');
  await chooseModel(page, 'Rig Model A');
  await send(page, `${m} abandon then resend`);
  await page.getByText('Creation is unconfirmed').first().waitFor({ timeout: 20000 });
  const warning = await page.getByText('Abandoning this record').first().innerText().catch(() => '');
  await waitTurnsSettled(m);
  const serverStateAtAbandon = { sessions: sessionsWith(m).length, turns: turnsWith(m), status: sql(`SELECT GROUP_CONCAT(status) FROM managed_agent_turn WHERE input_json LIKE '%${m}%'`), modelCalls: (await modelCalls(m)).length };
  await page.getByRole('button', { name: 'Abandon local confirmation' }).click();
  await sleep(800);
  if (process.env.R2) await page.locator('nav button', { hasText: sessionsWith(m)[0]?.slice(0, 8) ?? 'none' }).first().waitFor({ timeout: 8000 }).catch(() => {});
  const restored = await editorText(page);
  const listedOrphan = await page.locator('nav button', { hasText: sessionsWith(m)[0]?.slice(0, 8) ?? 'none' }).count();
  await shot(page, 'c3b-after-abandon');
  if (process.env.R2) {
    check('C3b abandon: the warning now says the input may already be running and a resend may repeat it (F1 fix)', /may already exist or be running/.test(warning) && /repeat its effects/.test(warning) && !/empty session/.test(warning) && serverStateAtAbandon.turns === 1 && serverStateAtAbandon.modelCalls === 1, { warning, serverStateAtAbandon });
    check('C3b abandon refreshes the list: the admitted Session is listed (F1 fix)', listedOrphan > 0, { listedOrphan });
  } else
  check('C3b abandon: the "empty session" warning is shown while the server already ran the first input', /empty session/.test(warning) && serverStateAtAbandon.turns === 1 && serverStateAtAbandon.modelCalls === 1, { warning, serverStateAtAbandon });
  check('C3b abandon restores the text to the composer', restored === `${m} abandon then resend`, restored);
  await editor(page).click();
  await page.keyboard.press('Enter');
  await page.locator('[data-managed-model]').first().waitFor({ timeout: 30000 });
  await waitTurnsSettled(m);
  await sleep(800);
  const creates = reqs(net, '/sessions/create');
  check('C3b resend after abandon mints a new key -> second Session and second execution', creates.length === 2 && creates[0].body.idempotencyKey !== creates[1].body.idempotencyKey && sessionsWith(m).length === 2 && turnsWith(m) === 2 && (await modelCalls(m)).length === 2, { keys: creates.map((c) => c.body.idempotencyKey), sessions: sessionsWith(m).length, turns: turnsWith(m), modelCalls: (await modelCalls(m)).length, orphanListedBeforeResend: listedOrphan });
  check('C3b no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C4: accepted identity, read-back lost ----------------
if (want('C4')) {
  const m = mk('c4');
  const { page, ctx, net, errors } = await open();
  let getsLost = 0;
  let createDone = false;
  await page.route(`**${WEB}/sessions/create`, async (route) => { const r = await route.fetch(); createDone = true; return route.fulfill({ response: r }); });
  await page.route(`**${WEB}/sessions/get`, async (route) => {
    if (createDone && getsLost === 0) { getsLost++; return route.abort('failed'); }
    return route.continue();
  });
  await chooseWorkspace(page, 'Project Alpha');
  await chooseModel(page, 'Rig Model B');
  await send(page, `${m} readback lost`);
  await page.getByRole('button', { name: 'Retry reading session' }).waitFor({ timeout: 20000 });
  await shot(page, 'c4-retry-read');
  const before = reqs(net, '/sessions/create').length;
  await page.getByRole('button', { name: 'Retry reading session' }).click();
  await waitConversation(page);
  await waitTurnsSettled(m);
  await sleep(800);
  check('C4 read-back retry did not re-send create', before === 1 && reqs(net, '/sessions/create').length === 1, { creates: reqs(net, '/sessions/create').length });
  check('C4 MySQL one Session, one Turn', sessionsWith(m).length === 1 && turnsWith(m) === 1, { sids: sessionsWith(m), turns: turnsWith(m) });
  check('C4 composer empty after read-back', (await editorText(page)) === '', await editorText(page));
  check('C4 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C5: follow-up in an existing Session; lost submit response ----------------
if (want('C5')) {
  const sid = process.env.SID_A ?? created.c1;
  const m1 = mk('c5a');
  const m2 = mk('c5b');
  const { page, ctx, net, errors } = await open({ query: `&session=${sid}` });
  await waitConversation(page);
  await send(page, `${m1} follow up`);
  await waitAnswer(page, m1);
  const s1 = await waitTurnsSettled(m1);
  check('C5 follow-up: one submit, Turn COMPLETED on preset B model', reqs(net, '/turns/submit').length === 1 && s1 === 'COMPLETED' && (await modelCalls(m1))[0]?.model === 'rig-model-b', { submits: reqs(net, '/turns/submit').length, s1 });
  check('C5 composer cleared after follow-up', (await editorText(page)) === '', await editorText(page));
  // lose the response of the next submit
  let lost = 0;
  const serverSaw = [];
  await page.route(`**${WEB}/turns/submit`, async (route) => {
    const r = await route.fetch();
    serverSaw.push({ status: r.status(), body: await r.json().catch(() => null) });
    if (lost++ === 0) return route.abort('failed');
    return route.fulfill({ response: r });
  });
  await send(page, `${m2} lost submit`);
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await sleep(500);
  await shot(page, 'c5-unconfirmed-retry');
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  await waitAnswer(page, m2);
  const s2 = await waitTurnsSettled(m2);
  await sleep(800);
  const subs = reqs(net, '/turns/submit').slice(1);
  check('C5 retry reused key + text; Java replayed', subs.length === 2 && subs[0].body.idempotencyKey === subs[1].body.idempotencyKey && JSON.stringify(subs[0].body.input) === JSON.stringify(subs[1].body.input) && serverSaw[1]?.body?.replayed === true, { serverSaw, keys: subs.map((s) => s.body.idempotencyKey) });
  check('C5 MySQL one Turn for the retried input', turnsWith(m2) === 1 && s2 === 'COMPLETED', { turns: turnsWith(m2), s2 });
  check('C5 composer empty after retried admission', (await editorText(page)) === '', await editorText(page));
  await editor(page).click();
  await page.keyboard.press('Enter');
  await sleep(1500);
  check('C5 empty Enter after retry sends nothing', reqs(net, '/turns/submit').length === 3, { submits: reqs(net, '/turns/submit').length });
  check('C5 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C6: A -> B -> A after a lost response; retry A from B (with reload) ----------------
if (want('C6')) {
  const A = process.env.SID_A ?? created.c1;
  const B = process.env.SID_B ?? created.c2;
  const m = mk('c6');
  const bDraft = `keep this B draft ${randomBytes(2).toString('hex')}`;
  const { page, ctx, net, errors } = await open({ query: `&session=${B}` });
  await waitConversation(page);
  await typeText(page, bDraft);
  await sleep(2600); // composer draft save debounce is 2 s
  await sidebarSelect(page, A);
  await waitConversation(page);
  let lost = 0;
  await page.route(`**${WEB}/turns/submit`, async (route) => { const r = await route.fetch(); if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await send(page, `${m} A input`);
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await sidebarSelect(page, B);
  await waitConversation(page);
  check('C6 B view shows B draft while A is unconfirmed', (await editorText(page)).includes(bDraft), await editorText(page));
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await sleep(800);
  await shot(page, 'c6-retry-a-from-b');
  check('C6 after reload B still shows its draft', (await editorText(page)).includes(bDraft), await editorText(page));
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  const st6 = await waitTurnsSettled(m);
  await sleep(1500);
  check('C6 A input admitted once', turnsWith(m) === 1 && st6 === 'COMPLETED' && sessionsWith(m)[0] === A, { turns: turnsWith(m), st6 });
  const viewAfter = await page.evaluate(() => window.__rig?.sessionId);
  check('C6 after the retry the view returns to A (admitted Session)', viewAfter === A, { viewAfter, A, B });
  await shot(page, 'c6-after-retry');
  await sidebarSelect(page, B);
  await waitConversation(page);
  await sleep(1000);
  check('C6 B draft survives the A admission (back in B)', (await editorText(page)).includes(bDraft), await editorText(page));
  const drafts = await draftKeys(page);
  check('C6 no stored draft still holds the admitted A input', !Object.values(drafts).some((v) => String(v).includes(m)), drafts);
  await sidebarSelect(page, A);
  await waitConversation(page);
  await sleep(1000);
  check('C6 back in A: composer empty', (await editorText(page)) === '', await editorText(page));
  check('C6 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C6w: whitespace-padded saved draft, lost response, reload, retry ----------------
if (want('C6w')) {
  const A = process.env.SID_A ?? created.c1;
  const OTHER = process.env.SID_B ?? created.c2;
  const m = mk('c6w');
  const padded = `   ${m} padded draft   `;
  const { page, ctx, net, errors } = await open({ query: `&session=${A}` });
  await waitConversation(page);
  await editor(page).click();
  await page.keyboard.type(padded);
  await sleep(2600); // let the composer persist the raw draft
  let lost = 0;
  await page.route(`**${WEB}/turns/submit`, async (route) => { const r = await route.fetch(); if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  const sent = reqs(net, '/turns/submit')[0]?.body?.input?.[0]?.text;
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  const s = await waitTurnsSettled(m);
  await sleep(1500);
  const stored = Object.values(await draftKeys(page)).filter((v) => String(v).includes(m));
  await sidebarSelect(page, OTHER);
  await sidebarSelect(page, A);
  await waitConversation(page);
  await sleep(1200);
  const back = await editorText(page);
  await shot(page, 'c6w-back-in-a');
  check('C6w submitted text is trimmed; admitted once', sent === padded.trim() && turnsWith(m) === 1 && s === 'COMPLETED', { sent, turns: turnsWith(m), s });
  check('C6w padded saved draft removed after the reloaded retry; A composer empty on return', stored.length === 0 && back === '', { stored, back });
  check('C6w no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C6p: padded A draft, lost response, retry from B after reload ----------------
if (want('C6p')) {
  const A = process.env.SID_A ?? created.c1;
  const B = process.env.SID_B ?? created.c2;
  const m = mk('c6p');
  const padded = `  ${m} padded A  `;
  const { page, ctx, net, errors } = await open({ query: `&session=${A}` });
  await waitConversation(page);
  await editor(page).click();
  await page.keyboard.type(padded);
  await sleep(2600);
  let lost = 0;
  await page.route(`**${WEB}/turns/submit`, async (route) => { const r = await route.fetch(); if (lost++ === 0) return route.abort('failed'); return route.fulfill({ response: r }); });
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await sidebarSelect(page, B);
  await page.reload();
  await page.getByRole('button', { name: 'Retry the same request' }).waitFor({ timeout: 20000 });
  await sleep(800);
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  const s = await waitTurnsSettled(m);
  await sleep(1500);
  const stored = Object.values(await draftKeys(page)).filter((v) => String(v).includes(m));
  await sidebarSelect(page, B);
  await sidebarSelect(page, A);
  await waitConversation(page);
  await sleep(1200);
  const back = await editorText(page);
  await shot(page, 'c6p-back-in-a');
  check('C6p padded A admitted once from the B view', turnsWith(m) === 1 && s === 'COMPLETED', { turns: turnsWith(m), s });
  check('C6p padded A draft removed; A composer empty on return', stored.length === 0 && back === '', { stored, back });
  check('C6p no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C5d: Discard puts the unconfirmed text back into the composer ----------------
if (want('C5d')) {
  const A = process.env.SID_A ?? created.c1;
  const m = mk('c5d');
  const { page, ctx, net, errors } = await open({ query: `&session=${A}` });
  await waitConversation(page);
  await page.route(`**${WEB}/turns/submit`, async (route) => { await route.fetch(); return route.abort('failed'); });
  await send(page, `${m} to discard`);
  await page.getByRole('button', { name: 'Discard this request' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Discard this request' }).click();
  await sleep(1000);
  const text = await editorText(page);
  const enabled = (await page.locator('.cm-content[contenteditable="true"]').count()) > 0;
  await shot(page, 'c5d-after-discard');
  check('C5d Discard restores the text into an editable composer', text === `${m} to discard` && enabled, { text, enabled });
  await waitTurnsSettled(m);
  check('C5d (server had already admitted the discarded request)', turnsWith(m) === 1, { turns: turnsWith(m) });
  check('C5d no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C7: cancel a running Turn, then continue ----------------
if (want('C7')) {
  const sid = process.env.SID_B ?? created.c2;
  const hold = `RIG_HOLD_c7${randomBytes(2).toString('hex')}`;
  const m = mk('c7');
  const { page, ctx, net, errors } = await open({ query: `&session=${sid}` });
  await waitConversation(page);
  await send(page, `${hold} long running`);
  const cancelBtn = page.getByRole('button', { name: /Cancel turn/ });
  await cancelBtn.first().waitFor({ timeout: 20000 });
  await sleep(1500);
  const cb = await box(page, 'button:has-text("Cancel turn")');
  await shot(page, 'c7-running-cancel');
  check('C7 cancel control visible while running', cb && cb.y > 0 && cb.y < 800, cb);
  await cancelBtn.first().click();
  const s = await waitTurnsSettled(hold);
  await control('/release');
  check('C7 MySQL Turn CANCELLED', s === 'CANCELLED', s);
  await sleep(1000);
  await send(page, `${m} after cancel`);
  await waitAnswer(page, m);
  const s2 = await waitTurnsSettled(m);
  check('C7 continuation after cancel completes', s2 === 'COMPLETED', s2);
  check('C7 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C8: literal bang / question mark; no daemon-only affordances ----------------
if (want('C8')) {
  const sid = process.env.SID_A ?? created.c1;
  const m = mk('c8');
  const { page, ctx, net, errors } = await open({ query: `&session=${sid}` });
  await waitConversation(page);
  await editor(page).click();
  await page.keyboard.type('!');
  await sleep(300);
  const afterBang = await editorText(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('?');
  await sleep(300);
  const afterQ = await editorText(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('/');
  await sleep(500);
  const slashMenu = await page.locator('[data-web-shell-slash-menu], [role=listbox]').count();
  await page.keyboard.press('Backspace');
  check('C8 "!" and "?" stay literal at an empty composer', afterBang === '!' && afterQ === '?', { afterBang, afterQ });
  check('C8 no slash menu, attach button or shell toggle', slashMenu === 0 && (await page.locator('[data-web-shell-upload-input]').count()) === 0 && (await page.locator('button[aria-label*="hell" i]').count()) === 0, { slashMenu });
  await send(page, `!echo ${m}? literal`);
  await waitAnswer(page, m);
  await waitTurnsSettled(m);
  const calls = await modelCalls(m);
  check('C8 model received the literal "!" text', calls.length === 1 && calls[0].lastUserText.includes(`!echo ${m}? literal`), calls[0]?.lastUserText.slice(-80));
  check('C8 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------------- C9: real Java refusals on first input ----------------
if (want('C9')) {
  const { page, ctx, net, errors } = await open();
  // (a) no Workspace chosen
  const t1 = `no workspace ${randomBytes(2).toString('hex')}`;
  await chooseModel(page, 'Rig Model A');
  await send(page, t1);
  await sleep(1200);
  check('C9a no Workspace: "Choose a Workspace", no request, text kept', reqs(net, '/sessions/create').length === 0 && (await page.getByText('Choose a Workspace').count()) > 0 && (await editorText(page)) === t1, { creates: reqs(net, '/sessions/create').length, text: await editorText(page) });
  await shot(page, 'c9a-choose-workspace');
  // (b) invalid directory -> Java 400 invalid_cwd
  await chooseWorkspace(page, 'Project Alpha');
  await setDir(page, '../escape');
  await page.keyboard.press('End');
  await editor(page).click();
  await page.keyboard.press('Enter');
  await sleep(2500);
  const r1 = net.filter((e) => e.dir === 'res' && e.path === '/sessions/create').at(-1);
  check('C9b invalid dir: Java refuses, path error shown, draft kept, no pending', r1?.status === 400 && (await editorText(page)) === t1 && (await page.getByText('Creation is unconfirmed').count()) === 0, { status: r1?.status, code: r1?.body?.error?.code ?? r1?.body?.code, alert: await page.locator('[role=alert]').allInnerTexts(), text: await editorText(page) });
  await shot(page, 'c9b-invalid-dir');
  await setDir(page, '.');
  check('C9 no page errors', errors.length === 0, errors);
  await ctx.close();
  // (c) preset whose model the server does not allow -> 409 agent_definition_unsupported
  {
    const presetsX = [...PRESETS, { agentId: D.X.agentId, label: 'Rig Model X (unlisted)' }];
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page2 = await ctx2.newPage();
    const net2 = [];
    page2.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('/sessions/create')) net2.push({ status: r.status(), body: await r.json().catch(() => null) }); });
    await page2.goto(`http://localhost:${port}/e2e/fixtures/rig-13973.html?presets=${encodeURIComponent(JSON.stringify(presetsX))}`);
    await page2.locator('.cm-content').first().waitFor();
    await sleep(1500);
    await chooseWorkspace(page2, 'Project Alpha');
    await chooseModel(page2, 'Rig Model X');
    const t2 = `unlisted model ${randomBytes(2).toString('hex')}`;
    await send(page2, t2);
    await sleep(2500);
    check('C9c unlisted model: Java 409, error shown, draft kept, no pending', net2[0]?.status === 409 && (await editorText(page2)) === t2 && (await page2.getByText('Creation is unconfirmed').count()) === 0, { res: net2[0], alert: await page2.locator('[role=alert]').allInnerTexts(), text: await editorText(page2) });
    await shot(page2, 'c9c-unlisted-model');
    await ctx2.close();
  }
}

out.finished = new Date().toISOString();
out.created = created;
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
const fails = out.checks.filter((c) => !c.ok);
console.log(`\nSUMMARY ${arm}: ${out.checks.length - fails.length}/${out.checks.length} passed`);
await browser.close();
