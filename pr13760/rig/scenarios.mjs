// VERIFICATION RIG ONLY (PR #13760): drive the real Managed panel (ManagedAgentWebShell host
// fixture served by vite from the arm's worktree) against that arm's real Spring + Hosted Harness.
// usage: node ui/scenarios.mjs <merge|main> [U1,U3,...]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13760-rig/src-merge/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13760-rig';
const [arm, onlyArg] = process.argv.slice(2);
const only = onlyArg ? onlyArg.split(',') : null;
const want = (u) => !only || only.includes(u);
const st = JSON.parse(fs.readFileSync(`${RIG}/state/serve-${arm}.json`, 'utf8'));
const port = { merge: 5760, main: 5761, head: 5762 }[arm];
const T = 'rig-tenant';
const WEB = '/api/agent/web-shell/v1';
const outFile = `${RIG}/out/ui-${arm}.json`;
const out = fs.existsSync(outFile) && only ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { arm, checks: [] };
if (only) out.checks = out.checks.filter((c) => !only.includes(c.name.split(' ')[0]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail) => {
  out.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
};
const sql = (q) => {
  const r = spawnSync(`${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`, ['--protocol=tcp', '-h127.0.0.1', '-P23760', '-uroot', '--batch', '--skip-column-names', st.db, '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
const row = (sid) => { const [cwd, rev] = sql(`SELECT cwd_relative, context_revision FROM managed_agent_session WHERE session_id='${sid}'`).split('\t'); return { cwd, rev: Number(rev) }; };
const cwdOps = (sid) => sql(`SELECT COUNT(*) FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='CWD_CHANGE'`);
const opStates = (sid) => sql(`SELECT GROUP_CONCAT(CONCAT(state, ':', COALESCE(target_cwd_relative,''), ':', COALESCE(error_code,'')) ORDER BY created_at SEPARATOR ' | ') FROM managed_agent_operation WHERE session_id='${sid}' AND operation_kind='CWD_CHANGE'`);
async function api(actor, method, p, body) {
  const r = await fetch(`http://127.0.0.1:${st.springPort}${p}`, { method, headers: { 'x-qwen-tenant-id': T, 'x-rig-actor': actor, 'content-type': 'application/json', 'idempotency-key': `ui-${randomBytes(4).toString('hex')}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const control = (p) => fetch(`http://127.0.0.1:${st.controlPort}${p}`).then((r) => r.json());
async function apiChange(actor, sid, target) {
  const { rev } = row(sid);
  const r = await api(actor, 'POST', `${WEB}/sessions/cwd/change`, { sessionId: sid, idempotencyKey: `ui-api-${randomBytes(4).toString('hex')}`, cwdRelative: target, expectedContextRevision: rev });
  for (let i = 0; i < 80 && row(sid).cwd !== target; i++) await sleep(250);
  return { status: r.status, code: r.json?.error?.code, cwd: row(sid).cwd };
}
const turnStatus = (turnId) => sql(`SELECT status FROM managed_agent_turn WHERE turn_id='${turnId}'`);
async function waitTurnDone(turnId, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = turnStatus(turnId); if (/COMPLETED|FAILED|CANCELLED/.test(s)) return s; await sleep(250); }
  return turnStatus(turnId);
}

const browser = await chromium.launch({ headless: true });
async function open(actor, sid, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
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
    if (!u.pathname.startsWith(WEB)) return;
    const e = { t: Date.now(), dir: 'res', path: u.pathname.slice(WEB.length), status: r.status() };
    try { e.body = await r.json(); } catch {}
    net.push(e);
  });
  await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13760.html?actor=${actor}&tenant=${T}&session=${sid}&lang=${lang}`);
  await page.locator('[data-managed-workspace-binding]').first().waitFor({ timeout: 30000 });
  await sleep(1200);
  return { page, ctx, net, errors };
}
const shot = (page, name) => page.screenshot({ path: `${RIG}/fig/raw/${arm}-${name}.png` });
const binding = (page) => page.locator('[data-managed-workspace-binding]').first();
const dirLine = async (page) => (await binding(page).innerText()).split("\n").find((l) => /directory|目录/i.test(l) && !/^(Change directory|Changing directory|切换目录|正在切换)/.test(l)) ?? '';
const trigger = (page) => binding(page).getByRole('button', { name: /^(Change directory|切换目录)$/ });
const dialog = (page) => page.getByRole('dialog');
const pathInput = (page) => dialog(page).getByRole('textbox');
const composer = (page) => page.locator('textarea').first();
const sendButton = (page) => page.locator('button[type="submit"]').filter({ hasText: /^(Send|Retry|Sending…|发送|重试)/ }).last();
const cardText = async (page) => (await binding(page).innerText()).replace(/\n+/g, ' | ');
const posts = (net, path) => net.filter((e) => e.dir === 'req' && e.path === path);
async function waitDir(page, target, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await dirLine(page)).trim().endsWith(`: ${target}`)) return true; await sleep(200); }
  return false;
}

// U0 — the entry exists only where the arm's server advertises cwdChange.
if (want('U0')) {
  const { page, ctx, net, errors } = await open('cr', st.sessions.change.sid);
  const get = net.filter((e) => e.dir === 'res' && e.path === '/sessions/get').at(-1)?.body;
  const caps = get?.capabilities ?? get?.session?.capabilities ?? {};
  const n = await trigger(page).count();
  await shot(page, 'u0-entry');
  check(`U0 ${arm}: Change directory entry for the creator`, arm === 'main' ? n === 0 : n === 1, `buttons=${n} capabilities.cwdChange=${caps.cwdChange} workspaceTurns=${caps.workspaceTurns} dir="${await dirLine(page)}" pageerrors=${errors.length}`);
  await ctx.close();
}
if (arm === 'main') {
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  await browser.close();
  console.log('UI-DONE', arm);
  process.exit(0);
}

// U1 — creator changes . -> B with a draft in the composer; the next Turn writes into B.
if (want('U1')) {
  const S = st.sessions.change;
  const { page, ctx, net, errors } = await open('cr', S.sid);
  const marker = `RIG_WRITE_u1${randomBytes(3).toString('hex')}`;
  const draft = `please ${marker}`;
  await composer(page).fill(draft);
  const msgsBefore = await page.locator('[data-managed-message], [data-role="user"], [data-message-role]').count();
  const transcriptBefore = (await page.locator('main, [data-managed-transcript]').first().innerText().catch(() => '')).length;
  await shot(page, 'u1a-before');
  await trigger(page).click();
  await dialog(page).waitFor();
  const prefill = await pathInput(page).inputValue();
  await pathInput(page).fill('B');
  await shot(page, 'u1b-dialog');
  const t0 = Date.now();
  await pathInput(page).press('Enter');
  await sleep(250);
  const during = { dir: await dirLine(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), draft: await composer(page).inputValue(), card: await cardText(page), dialogOpen: await dialog(page).isVisible() };
  await shot(page, 'u1c-changing');
  const moved = await waitDir(page, 'B');
  for (let i = 0; i < 60 && /Changing directory/.test(await cardText(page)); i++) await sleep(250);
  const ms = Date.now() - t0;
  await sleep(300);
  const after = { dir: await dirLine(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), draft: await composer(page).inputValue(), card: await cardText(page), dialogOpen: await dialog(page).isVisible().catch(() => false) };
  const transcriptAfter = (await page.locator('main, [data-managed-transcript]').first().innerText().catch(() => '')).length;
  await shot(page, 'u1d-after');
  const submitted = posts(net, '/sessions/cwd/change').map((e) => e.body);
  check('U1 dialog prefilled with the committed directory', prefill === '.', `prefill="${prefill}"`);
  check('U1 Send locked and draft kept while the operation is in flight', during.send === true && during.draft === draft, during);
  check('U1 directory B shown after completion; draft kept; Send unlocked; dialog closed', moved && after.send === false && after.draft === draft && after.dialogOpen === false, { ...after, ms });
  check('U1 one POST with cwdRelative=B at the summary revision', submitted.length === 1 && submitted[0].cwdRelative === 'B', submitted);
  check('U1 DB: session cwd B, one CWD_CHANGE op completed', row(S.sid).cwd === 'B' && cwdOps(S.sid) === '1', `${JSON.stringify(row(S.sid))} ops=${opStates(S.sid)}`);
  check('U1 transcript not reloaded/lost', transcriptAfter >= transcriptBefore, `before=${transcriptBefore} after=${transcriptAfter} msgsBefore=${msgsBefore}`);
  // Send the kept draft: the scripted model writes "<marker>.txt" (relative) after an approval.
  await sendButton(page).click();
  let turnId = null;
  for (let i = 0; i < 40 && !turnId; i++) { turnId = net.find((e) => e.dir === 'res' && e.path === '/turns/submit')?.body?.turnId; await sleep(250); }
  const allow = page.locator('[data-testid="managed-approval"] [data-option-id]', { hasText: /allow once|允许/i }).first();
  await allow.waitFor({ timeout: 30000 }).catch(() => {});
  await shot(page, 'u1e-approval');
  await allow.click().catch(() => {});
  const done = turnId ? await waitTurnDone(turnId) : null;
  await sleep(1500);
  await shot(page, 'u1f-written');
  const inB = fs.existsSync(`${st.mountRoot}/${S.st}/B/${marker}.txt`);
  const inRoot = fs.existsSync(`${st.mountRoot}/${S.st}/${marker}.txt`);
  check('U1 next Turn from the composer writes into B (not the root)', done === 'COMPLETED' && inB && !inRoot, `turn=${done} inB=${inB} inRoot=${inRoot} pageerrors=${errors.length}`);
  await ctx.close();
}

// U2 — the capability is per caller: READER has no entry, a non-creator OPERATOR does.
if (want('U2')) {
  const S = st.sessions.change;
  for (const [actor, expect] of [['rd', 0], ['op2', 1], ['ow2', 1]]) {
    const { page, ctx, net } = await open(actor, S.sid);
    const get = net.filter((e) => e.dir === 'res' && e.path === '/sessions/get').at(-1)?.body;
    const n = await trigger(page).count();
    if (actor !== 'ow2') await shot(page, `u2-${actor}`);
    check(`U2 ${actor}: entry count ${expect}`, n === expect, `buttons=${n} cwdChange=${(get?.capabilities ?? get?.session?.capabilities)?.cwdChange} dir="${await dirLine(page)}"`);
    await ctx.close();
  }
}

// U3 — lost 202: the server commits, the browser sees a network failure; reload; the
// original key is replayed only on "Continue confirming".
if (want('U3')) {
  const S = st.sessions.lostack;
  const { page, ctx, net, errors } = await open('cr', S.sid);
  await composer(page).fill('draft kept across a lost acknowledgement');
  let intercepted = null;
  await page.route(`**${WEB}/sessions/cwd/change`, async (route) => {
    const resp = await route.fetch();
    intercepted = { status: resp.status(), body: await resp.json().catch(() => null) };
    await route.abort('failed');
  });
  await trigger(page).click();
  await pathInput(page).fill('A');
  await pathInput(page).press('Enter');
  for (let i = 0; i < 40 && !intercepted; i++) await sleep(250);
  await sleep(1500);
  const lost = { card: await cardText(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), serverCwd: row(S.sid).cwd, ops: opStates(S.sid), dialogOpen: await dialog(page).isVisible().catch(() => false) };
  await shot(page, 'u3a-lost-ack');
  check('U3 server committed although the browser lost the 202', intercepted?.status === 202 && lost.serverCwd === 'A', { intercepted: intercepted?.status, op: intercepted?.body?.operationId, ...lost });
  check('U3 UI parks the request as unconfirmed and keeps Send locked', /not confirmed/i.test(lost.card) && lost.send === true, lost);
  if (lost.dialogOpen) await page.keyboard.press('Escape');
  await page.unroute(`**${WEB}/sessions/cwd/change`);
  const firstKey = posts(net, '/sessions/cwd/change')[0]?.body?.idempotencyKey;
  const mark = net.length;
  await page.reload();
  await binding(page).waitFor({ timeout: 30000 });
  await sleep(4000);
  const afterReload = { card: await cardText(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), postsSinceReload: posts(net.slice(mark), '/sessions/cwd/change').length, dir: await dirLine(page) };
  await shot(page, 'u3b-after-reload');
  check('U3 after reload: still unconfirmed, no automatic replay, Send locked', /not confirmed/i.test(afterReload.card) && afterReload.postsSinceReload === 0 && afterReload.send === true, afterReload);
  await binding(page).getByRole('button', { name: /Continue confirming/ }).click();
  await sleep(3500);
  const replays = posts(net.slice(mark), '/sessions/cwd/change');
  const replayRes = net.slice(mark).filter((e) => e.dir === 'res' && e.path === '/sessions/cwd/change').map((e) => ({ status: e.status, replayed: e.body?.replayed, op: e.body?.operationId, status2: e.body?.status }));
  const draftAfterReload = await composer(page).inputValue();
  if (!draftAfterReload) await composer(page).fill('typed after confirmation');
  const confirmed = { draftAfterReload, card: await cardText(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), dir: await dirLine(page), ops: cwdOps(S.sid) };
  await shot(page, 'u3c-confirmed');
  check('U3 Continue replays the original key once; server answers replayed', replays.length === 1 && replays[0].body?.idempotencyKey === firstKey && replayRes[0]?.replayed === true && replayRes[0]?.op === intercepted?.body?.operationId, { firstKey, replayKeys: replays.map((r) => r.body?.idempotencyKey), replayRes });
  check('U3 confirmed: directory A, Send usable with text, still exactly one CWD_CHANGE op', confirmed.dir.trim().endsWith(': A') && confirmed.send === false && confirmed.ops === '1', { ...confirmed, pageerrors: errors.length });
  await ctx.close();
}

// U4 — an open dialog whose basis revision moves requires acknowledgement.
if (want('U4')) {
  const S = st.sessions.stale;
  const { page, ctx } = await open('cr', S.sid);
  await trigger(page).click();
  await pathInput(page).fill('B');
  const other = await apiChange('op2', S.sid, 'docs');
  await sleep(4500);
  const dlg = await dialog(page).innerText();
  const submitDisabled = await dialog(page).getByRole('button', { name: /^Change directory$/ }).isDisabled();
  await shot(page, 'u4a-stale');
  check('U4 another operator changes the directory: dialog shows the new directory and blocks submit', /changed to docs/.test(dlg) && submitDisabled, { other, submitDisabled, dialog: dlg.replace(/\n+/g, ' | ') });
  await dialog(page).getByRole('button', { name: /Use the current directory context/ }).click();
  const enabled = !(await dialog(page).getByRole('button', { name: /^Change directory$/ }).isDisabled());
  await pathInput(page).press('Enter');
  const moved = await waitDir(page, 'B');
  check('U4 after acknowledging, the change applies on the new basis', enabled && moved && row(S.sid).cwd === 'B', { enabled, moved, row: row(S.sid), ops: opStates(S.sid) });
  // The root target in that same banner (bot R1-25: "changed to ..").
  await trigger(page).click();
  await apiChange('op2', S.sid, '.');
  await sleep(4500);
  const rootBanner = (await dialog(page).innerText()).split('\n').find((l) => /changed to/.test(l)) ?? '';
  await shot(page, 'u4b-root-banner');
  check('U4 root-directory banner text (R1-25 copy)', true, rootBanner);
  await page.keyboard.press('Escape');
  await ctx.close();
}

// U5 — refusals and a terminal failure: the category is explained and the target kept.
if (want('U5')) {
  const S = st.sessions.fail;
  const { page, ctx, net } = await open('cr', S.sid);
  await composer(page).fill('draft survives a failed change');
  await trigger(page).click();
  await pathInput(page).fill('missing/dir');
  await pathInput(page).press('Enter');
  await sleep(5000);
  const failed = { card: await cardText(page), dialog: (await dialog(page).innerText().catch(() => '')).replace(/\n+/g, ' | '), send: await sendButton(page).isDisabled().catch(() => 'n/a'), ops: opStates(S.sid), row: row(S.sid) };
  await shot(page, 'u5a-missing');
  check('U5 missing directory: op FAILED, cwd unchanged, failure explained, Send unlocked', /FAILED/.test(failed.ops) && failed.row.cwd === '.' && /failed|invalid|unavailable/i.test(failed.card + failed.dialog) && failed.send === false, failed);
  await page.keyboard.press('Escape');
  await sleep(300);
  await trigger(page).click();
  const keptTarget = await pathInput(page).inputValue();
  check('U5 reopening the dialog keeps the failed target', keptTarget === 'missing/dir', `prefill="${keptTarget}"`);
  await pathInput(page).fill('../outside');
  await pathInput(page).press('Enter');
  await sleep(2000);
  const res = net.filter((e) => e.dir === 'res' && e.path === '/sessions/cwd/change').at(-1);
  const lexical = { status: res?.status, code: res?.body?.error?.code, card: await cardText(page), dialog: (await dialog(page).innerText().catch(() => '')).replace(/\n+/g, ' | ') };
  await shot(page, 'u5b-invalid');
  check('U5 parent escape: 400 invalid_cwd explained', lexical.status === 400 && lexical.code === 'invalid_cwd' && /invalid/i.test(lexical.card + lexical.dialog), lexical);
  await page.keyboard.press('Escape');
  await ctx.close();
}

// U6 — busy: a running Turn disables the entry with a reason.
if (want('U6')) {
  const S = st.sessions.busy;
  const marker = `RIG_HOLD_u6${randomBytes(3).toString('hex')}`;
  const s = await api('cr', 'POST', `/v1/agents/sessions/${S.sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `please ${marker}` }] });
  const { page, ctx } = await open('cr', S.sid);
  await sleep(2500);
  const busy = { disabled: await trigger(page).isDisabled().catch(() => 'n/a'), card: await cardText(page) };
  await shot(page, 'u6-busy');
  check('U6 running Turn: entry disabled with the busy reason', busy.disabled === true && /Finish the active task/.test(busy.card), busy);
  await api('cr', 'POST', `/v1/agents/sessions/${S.sid}/events`, { type: 'agent.session.cancel', turn_id: s.json?.turn_id });
  await waitTurnDone(s.json?.turn_id, 30000);
  await ctx.close();
}

// U7 — a saved operation id is followed after reload; a 30 s timeout parks it as unconfirmed;
// Continue confirming then reads the operation (no new submit).
if (want('U7')) {
  const S = st.sessions.recover;
  await control(`/hold?sid=${S.sid}`);
  const { page, ctx, net, errors } = await open('cr', S.sid);
  await trigger(page).click();
  await pathInput(page).fill('B');
  await pathInput(page).press('Enter');
  await sleep(2500);
  const held = await control('/status');
  const opId = net.find((e) => e.dir === 'res' && e.path === '/sessions/cwd/change')?.body?.operationId;
  const changing = { card: await cardText(page), dir: await dirLine(page), send: await sendButton(page).isDisabled().catch(() => 'n/a'), parked: held.parked, opId };
  await page.keyboard.press('Escape');
  await shot(page, 'u7a-held');
  check('U7 settlement parked: old directory kept, Send locked, card tracks the operation after closing the dialog', held.parked && /Changing directory/.test(changing.card) && changing.dir.trim().endsWith(': .') && changing.send === true, changing);
  const mark = net.length;
  await page.reload();
  await binding(page).waitFor({ timeout: 30000 });
  await sleep(3000);
  const resumed = { queries: posts(net.slice(mark), '/operations/query').length, submits: posts(net.slice(mark), '/sessions/cwd/change').length, card: await cardText(page) };
  check('U7 after reload the saved operation id is queried automatically (no resubmit)', resumed.queries > 0 && resumed.submits === 0 && /Changing directory/.test(resumed.card), resumed);
  const tReload = Date.now();
  let parkedCard = '';
  while (Date.now() - tReload < 40000) { parkedCard = await cardText(page); if (/not confirmed/i.test(parkedCard)) break; await sleep(500); }
  const timeoutMs = Date.now() - tReload;
  await shot(page, 'u7b-timeout');
  check('U7 still unsettled after ~30 s: parked as unconfirmed, Send locked', /not confirmed/i.test(parkedCard) && (await sendButton(page).isDisabled().catch(() => 'n/a')) === true, { afterMs: timeoutMs, card: parkedCard });
  await control('/release');
  for (let i = 0; i < 40 && row(S.sid).cwd !== 'B'; i++) await sleep(250);
  const mark2 = net.length;
  await binding(page).getByRole('button', { name: /Continue confirming/ }).click();
  const moved = await waitDir(page, 'B');
  for (let i = 0; i < 40 && /Changing directory/.test(await cardText(page)); i++) await sleep(250);
  await composer(page).fill('typed after confirmation');
  const fin = { moved, queries: posts(net.slice(mark2), '/operations/query').length, submits: posts(net.slice(mark2), '/sessions/cwd/change').length, card: await cardText(page), ops: opStates(S.sid), send: await sendButton(page).isDisabled().catch(() => 'n/a') };
  await shot(page, 'u7c-confirmed');
  check('U7 Continue confirming queries the known operation and completes', moved && fin.submits === 0 && fin.queries > 0 && fin.send === false && !/Changing/.test(fin.card), { ...fin, pageerrors: errors.length });
  await ctx.close();
}

// U8 — zh-CN copy of the dialog.
if (want('U8')) {
  const S = st.sessions.zh;
  const { page, ctx } = await open('cr', S.sid, 'zh');
  await trigger(page).click();
  await pathInput(page).fill('目录');
  await shot(page, 'u8-zh-dialog');
  await pathInput(page).press('Enter');
  const moved = await waitDir(page, '目录');
  await shot(page, 'u8b-zh-after');
  check('U8 zh-CN: Unicode target 目录 applies', moved && row(S.sid).cwd === '目录', { row: row(S.sid), card: await cardText(page) });
  await ctx.close();
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
await browser.close();
console.log('UI-DONE', arm);
