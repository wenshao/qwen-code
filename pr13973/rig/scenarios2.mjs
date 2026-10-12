// VERIFICATION RIG ONLY (PR #13973), part 2: ordinary Web Shell host (PR dev entry), ordinary
// composer defaults, the legacy empty-only provider against real Java, a hung submit, zh/light.
// usage: node ui/scenarios2.mjs <arm> [O1,O2,L1,C10,Z1]
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
const outFile = `${RIG}/results/ui2-${arm}.json`;
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
const turnsOf = (sid) => Number(sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`));
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
function track(page) {
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
    const e = { t: Date.now(), dir: 'res', path: u.pathname.slice(WEB.length), status: r.status(), headers: r.request().headers() };
    try { e.body = await r.json(); } catch {}
    net.push(e);
  });
  return { net, errors };
}
const reqs = (net, path) => net.filter((e) => e.dir === 'req' && e.path === path);
const shot = (page, name) => page.screenshot({ path: `${RIG}/fig/raw/${arm}-${name}.png` });
const editor = (page) => page.locator('.cm-content:visible').last();
const editorText = (page) => page.locator('.cm-content:visible').last().evaluate((e) => { const c = e.cloneNode(true); c.querySelectorAll('.cm-placeholder, .cm-widgetBuffer').forEach((n) => n.remove()); return c.innerText.replace(/[​ ]/g, ' ').trim(); }).catch(() => '<none>');
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
async function send(page, text) {
  await editor(page).click({ force: true });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
const box = async (loc) => { const b = await loc.boundingBox(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };
const overflow = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth }));

// ---------- O1: ordinary Web Shell host via the PR's dev entry; long conversation ----------
if (want('O1')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const { net, errors } = track(page);
  await page.goto(`http://localhost:${port}/?token=${st.daemonToken}&managedProvider=java&managedWorkspace=1&tenant=${st.tenant}&lang=en`);
  await sleep(5000);
  await page.click('button[aria-label="Managed Agents"]');
  await editor(page).waitFor({ timeout: 20000 });
  await sleep(1500);
  const m = mk('o1');
  await chooseWorkspace(page, 'Project Alpha');
  await chooseModel(page, 'Rig Model B');
  await send(page, `${m} ordinary host first input`);
  await page.locator('[data-managed-model]').first().waitFor({ timeout: 30000 });
  const s0 = await waitTurnsSettled(m);
  const sid = sessionsWith(m)[0];
  const row = sid ? sessionRow(sid) : {};
  const createReq = reqs(net, '/sessions/create')[0];
  const actorHeader = net.find((e) => e.dir === 'res' && e.path === '/sessions/create')?.headers?.['x-qwen-actor-id'];
  check('O1 dev entry: env presets + X-Qwen-Actor-Id reach Java (creator=alice, preset B, W1)', row.creator === 'alice' && row.agent === D.B.agentId && row.ws === 'W1' && actorHeader === 'alice' && s0 === 'COMPLETED', { row, actorHeader, s0, agentId: createReq?.body?.agentId });
  for (let i = 0; i < 8; i++) {
    const mi = `RIG_LONG_o1n${i}${randomBytes(2).toString('hex')}`;
    for (let k = 0; k < 50 && (await page.locator('.cm-content[contenteditable="false"]:visible').count()) > 0; k++) await sleep(200);
    await send(page, `${mi} more`);
    await waitTurnsSettled(mi);
  }
  for (let k = 0; k < 50 && (await page.locator('.cm-content[contenteditable="false"]:visible').count()) > 0; k++) await sleep(200);
  check('O1 long conversation: all 9 Turns admitted once each', turnsOf(sid) === 9, { turns: turnsOf(sid) });
  const comp = await box(page.locator('[data-web-shell-composer-surface]:visible').last());
  const o = await overflow(page);
  const scrollable = await page.evaluate(() => [...document.querySelectorAll('*')].some((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.textContent.includes('Line 40 of a long answer')));
  check('O1 composer stays inside the viewport; transcript scrolls; no horizontal overflow', comp && comp.y + comp.h <= 900 && comp.y > 400 && scrollable && o.scrollW <= o.innerW, { comp, ...o, scrollable });
  await shot(page, 'o1-ordinary-long');
  // a running Turn: progress + cancel visible
  const hold = `RIG_HOLD_o1${randomBytes(2).toString('hex')}`;
  await send(page, `${hold} hold`);
  const cancel = page.getByRole('button', { name: /Cancel turn/ }).first();
  await cancel.waitFor({ timeout: 20000 });
  await sleep(1200);
  const cb = await box(cancel);
  check('O1 running Turn: cancel control visible within the viewport', cb && cb.y + cb.h <= 900, cb);
  await shot(page, 'o1-ordinary-running');
  await cancel.click();
  const sc = await waitTurnsSettled(hold);
  await control('/release');
  check('O1 cancel settles CANCELLED', sc === 'CANCELLED', sc);
  check('O1 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------- O2: ordinary daemon composer keeps its defaults ('!' shell mode, '?' help) ----------
if (want('O2')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const { errors } = track(page);
  await page.goto(`http://localhost:${port}/?token=${st.daemonToken}&lang=en`);
  await editor(page).waitFor({ timeout: 30000 });
  await sleep(2500);
  await editor(page).click({ force: true });
  await page.keyboard.type('!');
  await sleep(500);
  const shellPrefix = await page.locator('[class*="shellPrefix"]').count();
  const textAfterBang = await editorText(page);
  await page.keyboard.press('Backspace');
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(300);
  const shellAfterExit = await page.locator('[class*="shellPrefix"]').count();
  const dialogsBefore = await page.locator('[role=dialog]').count();
  await editor(page).click({ force: true });
  await page.keyboard.type('?');
  await sleep(700);
  const dialogsAfter = await page.locator('[role=dialog]').count();
  const textAfterQ = await editorText(page);
  check('O2 ordinary composer: "!" enters shell mode, "?" opens help (unchanged defaults)', shellPrefix === 1 && textAfterBang === '' && dialogsAfter > dialogsBefore && textAfterQ === '', { shellPrefix, textAfterBang, shellAfterExit, dialogsBefore, dialogsAfter, textAfterQ });
  check('O2 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------- L1: legacy empty-only provider (createSession removed) against real Java ----------
if (want('L1')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const { net, errors } = track(page);
  await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13973-legacy.html`);
  await page.locator('#managed-workspace-select').waitFor({ timeout: 30000 });
  await sleep(1500);
  check('L1 legacy provider keeps the separate creation form (no composer on new task)', (await page.locator('.cm-content').count()) === 0 && (await page.locator('#managed-workspace-select').count()) === 1, '');
  await page.click('#managed-workspace-select');
  await page.locator('[role=option]', { hasText: 'Project Beta' }).first().click();
  await sleep(300);
  await page.getByRole('button', { name: 'Create session' }).click();
  await editor(page).waitFor({ timeout: 30000 });
  await sleep(1500);
  const cr = reqs(net, '/sessions/create')[0]?.body;
  const sid = net.find((e) => e.dir === 'res' && e.path === '/sessions/create')?.body?.sessionId;
  check('L1 legacy create sends input=[] and admits a Session with zero Turns', cr && Array.isArray(cr.input) && cr.input.length === 0 && sid && turnsOf(sid) === 0 && sessionRow(sid).agent === 'qwen-code', { input: cr?.input, sid, turns: sid && turnsOf(sid), agent: sid && sessionRow(sid).agent });
  await sleep(1500); await shot(page, 'l1-legacy-empty-session');
  const m = mk('l1');
  await send(page, `${m} first input after empty create`);
  await page.getByText(rev(m)).first().waitFor({ timeout: 30000 });
  const s = await waitTurnsSettled(m);
  check('L1 first input goes through turns/submit on the standard composer', reqs(net, '/turns/submit').length === 1 && s === 'COMPLETED' && turnsOf(sid) === 1 && (await editorText(page)) === '', { submits: reqs(net, '/turns/submit').length, s, text: await editorText(page) });
  check('L1 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------- C10: a submit whose response never arrives (triage question 4) ----------
if (want('C10')) {
  const sid = process.env.C10_SID;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const { net, errors } = track(page);
  const presets = encodeURIComponent(JSON.stringify(PRESETS));
  await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13973.html?presets=${presets}&session=${sid}`);
  await page.locator('[data-managed-model]').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  let hung = 0;
  await page.route(`**${WEB}/turns/submit`, async (route) => {
    if (hung++ === 0) { await route.fetch(); await new Promise(() => {}); }
    return route.continue();
  });
  const m = mk('c10');
  await send(page, `${m} hung response`);
  await sleep(8000);
  const state = {
    retry: await page.getByRole('button', { name: 'Retry the same request' }).count(),
    editorDisabled: (await page.locator('.cm-content[contenteditable="false"]:visible').count()) > 0,
    unconfirmed: await page.getByText('The request outcome is unconfirmed').count(),
    progress: await page.locator('[role=status]').allInnerTexts(),
    serverTurns: turnsWith(m),
  };
  await shot(page, 'c10-hung-submit');
  check('C10 hung response: composer disabled, no Retry while the request is in flight (server already admitted)', state.editorDisabled && state.retry === 0 && state.serverTurns === 1, state);
  const storedBefore = await page.evaluate(() => Object.fromEntries([...Object.entries(sessionStorage), ...Object.entries(localStorage)].filter(([k]) => /pending|managed/i.test(k) && !/draft/i.test(k))));
  await page.unroute(`**${WEB}/turns/submit`);
  await page.reload();
  await sleep(6000);
  const storedAfter = await page.evaluate(() => Object.fromEntries([...Object.entries(sessionStorage), ...Object.entries(localStorage)].filter(([k]) => /pending|managed/i.test(k) && !/draft/i.test(k))));
  await shot(page, 'c10-after-reload');
  const retryAfterReload = await page.getByRole('button', { name: 'Retry the same request' }).count();
  check('C10 reload restores the pending record and its Retry', retryAfterReload > 0, { retryAfterReload, storedBefore, storedAfter, editorText: await editorText(page), editorDisabled: (await page.locator('.cm-content[contenteditable="false"]:visible').count()) > 0 });
  if (!retryAfterReload) { await ctx.close(); throw new Error('stop'); }
  await page.getByRole('button', { name: 'Retry the same request' }).click();
  const s = await waitTurnsSettled(m);
  await sleep(1500);
  const subs = reqs(net, '/turns/submit');
  check('C10 reload restores Retry; retry replays the same key, one Turn, composer empty', subs.length === 2 && subs[0].body.idempotencyKey === subs[1].body.idempotencyKey && turnsWith(m) === 1 && s === 'COMPLETED' && (await editorText(page)) === '', { keys: subs.map((x) => x.body.idempotencyKey), turns: turnsWith(m), s, text: await editorText(page) });
  check('C10 no page errors', errors.length === 0, errors);
  await ctx.close();
}

// ---------- Z1: zh-CN + light theme new-task page ----------
if (want('Z1')) {
  for (const [lang, theme] of [['zh', 'dark'], ['en', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const { errors } = track(page);
    await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13973.html?presets=${encodeURIComponent(JSON.stringify(PRESETS))}&lang=${lang}&theme=${theme}`);
    await page.locator('.cm-content, #managed-workspace-select').first().waitFor({ timeout: 30000 });
    await sleep(2000);
    const colors = await page.evaluate(() => { const r = document.querySelector('[data-web-shell-root]'); const cs = getComputedStyle(r); return { bg: cs.backgroundColor, fg: cs.color }; });
    await shot(page, `z1-${lang}-${theme}`);
    check(`Z1 ${lang}/${theme} standalone root has a themed background`, colors.bg !== 'rgba(0, 0, 0, 0)' && colors.bg !== colors.fg, colors);
    check(`Z1 ${lang}/${theme} no page errors`, errors.length === 0, errors);
    await ctx.close();
  }
}

out.finished = new Date().toISOString();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
const fails = out.checks.filter((c) => !c.ok);
console.log(`\nSUMMARY ${arm}: ${out.checks.length - fails.length}/${out.checks.length} passed`);
await browser.close();
