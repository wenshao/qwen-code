// VERIFICATION RIG ONLY (PR #13545): drive the real Managed panel (ManagedAgentWebShell host fixture,
// served by vite from the arm's worktree) against that arm's real Spring + Hosted Harness stack.
// usage: node ui/scenarios.mjs <head|base>
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13545-rig/src-head/package.json');
const { chromium } = require('playwright');
const RIG = '/Users/wenshao/pr13545-rig';
const [arm] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(`${RIG}/state/serve-${arm}.json`, 'utf8'));
const port = arm === 'head' ? 5545 : 5546;
const T = 'rig-tenant';
const out = { arm, checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`); };
const sql = (q) => {
  const r = spawnSync(`${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`, ['--protocol=tcp', '-h127.0.0.1', '-P23545', '-uroot', '--batch', '--skip-column-names', st.db, '-e', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
async function api(actor, method, p, body) {
  const r = await fetch(`http://127.0.0.1:${st.springPort}${p}`, { method, headers: { 'x-qwen-tenant-id': T, 'x-rig-actor': actor, 'content-type': 'application/json', 'idempotency-key': `ui-${randomBytes(4).toString('hex')}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function raiseApproval(sid) {
  const marker = `RIG_WRITE_u${randomBytes(3).toString('hex')}`;
  const s = await api('cr', 'POST', `/v1/agents/sessions/${sid}/events`, { type: 'agent.session.input.message', input: [{ type: 'input_text', text: `please ${marker}` }] });
  for (let i = 0; i < 120; i++) {
    const a = await api('cr', 'GET', `/v1/agents/sessions/${sid}/actions`);
    const req = (a.json?.data ?? []).find((x) => x.state === 'requested');
    if (req) return { marker, turnId: s.json?.turn_id, action: req };
    await sleep(250);
  }
  throw new Error('no approval');
}
const turnStatus = (turnId) => sql(`SELECT status FROM managed_agent_turn WHERE turn_id='${turnId}'`);
async function waitTurnDone(turnId, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = turnStatus(turnId); if (/COMPLETED|FAILED|CANCELLED/.test(s)) return s; await sleep(250); }
  return turnStatus(turnId);
}
const pendingFor = (sid) => sql(`SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}' AND status IN ('ACCEPTED','RUNNING')`);

const browser = await chromium.launch({ headless: true });
async function open(actor, sid, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const net = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    const e = { path: u.pathname.replace('/api/agent/web-shell/v1', ''), status: r.status() };
    try { e.body = await r.json(); } catch {}
    net.push(e);
  });
  await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13545.html?actor=${actor}&tenant=${T}&session=${sid}&lang=${lang}`);
  await page.getByText(/Bound Workspace|绑定/).first().waitFor({ timeout: 20000 });
  await page.locator('[data-testid="managed-approval"], textarea').first().waitFor({ timeout: 5000 }).catch(() => {});
  await sleep(1500);
  return { page, ctx, net };
}
const shot = (page, name) => page.screenshot({ path: `${RIG}/fig/raw/ui-${arm}-${name}.png` });
const allowButton = (page) => page.locator('[data-testid="managed-approval"] [data-option-id]', { hasText: /allow once|允许/i }).first();
const respondCalls = (net) => net.filter((e) => e.path === '/actions/respond').map((e) => `${e.status} ${e.body?.error?.code ?? e.body?.status ?? ''}`);

// Every run starts with one pending approval on SU, raised by the creator.
{
  const a = await api('cr', 'GET', `/v1/agents/sessions/${st.SU}/actions`);
  if (!(a.json?.data ?? []).some((x) => x.state === 'requested')) {
    const r = await raiseApproval(st.SU);
    st.approvalTurn = r.turnId; st.marker = r.marker;
  }
}

// U1 — the READER answers: refused; on head, raising the role row and pressing Retry re-probes and succeeds.
sql(`UPDATE managed_workspace_access SET role='READER' WHERE tenant_id='${T}' AND actor_id='rd'`);
{
  const { page, ctx, net } = await open('rd', st.SU);
  await allowButton(page).click();
  await sleep(2500);
  const notice = await page.locator('[role="status"], [role="alert"]').filter({ hasText: /answer this approval|回答这项审批/ }).first().innerText().catch(() => '');
  const retryBtn = page.getByRole('button', { name: /Retry loading approvals/ });
  check('U1 reader answer refused 403 action_forbidden', respondCalls(net).some((c) => c.startsWith('403 action_forbidden')), JSON.stringify(respondCalls(net)));
  check('U1 refusal notice text', notice.length > 0, notice);
  check('U1 card disabled after refusal', await allowButton(page).isDisabled(), `disabled=${await allowButton(page).isDisabled()}`);
  out.u1 = { notice, retryButton: await retryBtn.count() };
  await shot(page, 'u1-reader-refused');
  if (arm === 'head') {
    check('U1 head offers a Retry button on the forbidden notice', (await retryBtn.count()) === 1, `count=${await retryBtn.count()}`);
    sql(`UPDATE managed_workspace_access SET role='OPERATOR' WHERE tenant_id='${T}' AND actor_id='rd' AND workspace_id='W2'`);
    await retryBtn.click();
    await sleep(2000);
    const enabled = !(await allowButton(page).isDisabled());
    check('U1 after the role is raised, Retry re-enables the card', enabled, `enabled=${enabled}`);
    await allowButton(page).click();
    const done = await waitTurnDone(st.approvalTurn);
    await sleep(1500);
    check('U1 promoted reader answers: 202 and the Turn completes', respondCalls(net).some((c) => c.startsWith('202')) && done === 'COMPLETED', `${JSON.stringify(respondCalls(net))} turn=${done} file=${fs.existsSync(`${RIG}/wsroot/r45_${arm === 'head' ? 'uihead' : 'uibase'}/mounts/st2/${st.marker}.txt`)}`);
    await shot(page, 'u1b-reader-promoted-answered');
    sql(`UPDATE managed_workspace_access SET role='READER' WHERE tenant_id='${T}' AND actor_id='rd'`);
  }
  await ctx.close();
}

// U2 — a second OPERATOR (not the creator) answers a pending approval.
{
  let target = { turnId: st.approvalTurn, marker: st.marker };
  if (arm === 'head') target = await raiseApproval(st.SU);
  const { page, ctx, net } = await open('op2', st.SU);
  await shot(page, 'u2-operator-pending');
  await allowButton(page).click();
  await sleep(2500);
  const done = arm === 'head' ? await waitTurnDone(target.turnId) : turnStatus(target.turnId);
  await sleep(1500);
  const notice = await page.locator('[role="status"], [role="alert"]').filter({ hasText: /answer this approval|回答这项审批/ }).first().innerText().catch(() => '');
  check(`U2 op2 answer on ${arm}`, true, `respond=${JSON.stringify(respondCalls(net))} turn=${done} notice=${notice}`);
  out.u2 = { respond: respondCalls(net), turn: done, notice, file: fs.existsSync(`${RIG}/wsroot/${st.db}/mounts/st2/${target.marker}.txt`) };
  await shot(page, 'u2-operator-after');
  await ctx.close();
  if (arm === 'base') {
    // Let the creator finish the base approval so the stack ends idle.
    const a = await api('cr', 'GET', `/v1/agents/sessions/${st.SU}/actions`);
    const req = (a.json?.data ?? []).find((x) => x.state === 'requested');
    if (req) await api('cr', 'POST', `/v1/agents/sessions/${st.SU}/actions/${req.id}/responses`, { kind: 'permission', option_id: 'allow', input_revision: req.input_revision, policy_revision: req.policy_revision });
  }
}

// U3 — the composer of an idle bound Session, as the second OPERATOR.
{
  const { page, ctx, net } = await open('op2', st.SC);
  const ta = page.locator('textarea').first();
  const present = await ta.count();
  const disabled = present ? await ta.isDisabled() : null;
  const sessionGet = net.filter((e) => e.path === '/sessions/get').at(-1)?.body;
  const caps = sessionGet?.capabilities ?? sessionGet?.session?.capabilities;
  out.u3 = { textarea: present, disabled, workspaceTurns: caps?.workspaceTurns };
  await shot(page, 'u3-composer');
  if (present && !disabled) {
    const marker = `RIG_TEXT_uic${randomBytes(3).toString('hex')}`;
    await ta.fill(`please ${marker}`);
    await page.getByRole('button', { name: /^Send$/ }).click();
    await sleep(3000);
    const sub = net.filter((e) => e.path === '/turns/submit').map((e) => `${e.status} ${e.body?.turnId ?? e.body?.error?.code ?? ''}`);
    const tid = net.find((e) => e.path === '/turns/submit')?.body?.turnId;
    const done = tid ? await waitTurnDone(tid) : null;
    await sleep(1500);
    out.u3.submit = sub; out.u3.turn = done;
    check(`U3 op2 sends from the composer on ${arm}`, sub.some((s) => s.startsWith('202')) && done === 'COMPLETED', `${JSON.stringify(sub)} turn=${done}`);
    await shot(page, 'u3-composer-sent');
  } else {
    check(`U3 composer on ${arm}`, true, `textarea=${present} disabled=${disabled} workspaceTurns=${caps?.workspaceTurns}`);
  }
  await ctx.close();
}
fs.writeFileSync(`${RIG}/out/ui-${arm}.json`, JSON.stringify(out, null, 2));
await browser.close();
console.log('UI-DONE', arm);
