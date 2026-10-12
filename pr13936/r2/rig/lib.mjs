// Shared helpers for the PR 13936 browser + public-API probes.
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const RIG = '/Users/wenshao/git/pr13936-rig';
const require = createRequire('/Users/wenshao/git/pr13936-merge/package.json');
export const { chromium } = require('playwright');

export const VITE = { merge: 'http://localhost:18936', base: 'http://localhost:18937', cand: 'http://localhost:18938' };
export const FIXTURE = '/e2e/fixtures/pr13936-rig.html';
export const GWCTL = 'http://127.0.0.1:19371';
export const MODELCTL = 'http://127.0.0.1:19380';

export function state(db) {
  return JSON.parse(readFileSync(`${RIG}/runs/${db}/state.json`, 'utf8'));
}
export const sql = (db, q) =>
  execFileSync(`${RIG}/mysql.sh`, ['sql', '-N', '-B', '-e', q, db], { encoding: 'utf8' }).trim();

const H = { 'x-qwen-tenant-id': 'rig', 'x-rig-actor': 'rig-actor', 'content-type': 'application/json' };
export async function api(db, method, path, body) {
  const st = state(db);
  const res = await fetch(`http://127.0.0.1:${st.springPort}/v1/agents/sessions${path}`, {
    method,
    headers: { ...H, ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
export async function createParent(db, prompt) {
  const r = await api(db, 'POST', '', {
    agent_id: 'qwen-code',
    workspace: { workspace_id: 'rig-ws' },
    input: [{ type: 'input_text', text: prompt }],
  });
  if (r.status !== 202 || !r.json?.id) throw new Error(`create failed ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json.id;
}
/** Wait until the session's newest Turn is terminal; returns {status, code}. */
export async function waitTurn(db, sid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = sql(db, `SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at DESC LIMIT 1`);
    if (/^(COMPLETED|FAILED|CANCELLED)/.test(row)) return row;
    if (Date.now() > deadline) return `TIMEOUT ${row}`;
    await sleep(500);
  }
}
export async function turnCount(db, sid) {
  return Number(sql(db, `SELECT COUNT(*) FROM managed_agent_turn WHERE session_id='${sid}'`));
}
export async function serverTasks(db, sid) {
  const r = await api(db, 'GET', `/${sid}/tasks`);
  return r;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function gw(path) {
  return (await fetch(`${GWCTL}${path}`)).text();
}
export async function release(id) {
  return (await fetch(`${MODELCTL}/release/${id}`)).text();
}
export function gwLog(db) {
  try {
    return readFileSync(`${RIG}/runs/${db}/gw.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
export function out(file, obj) {
  mkdirSync(`${RIG}/results`, { recursive: true });
  appendFileSync(`${RIG}/results/${file}`, (typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n');
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

/** Browser: records every Web Shell task/operation call the page makes. */
export async function openPage(browser, { arm = process.env.ARM ?? 'merge', sid, lang = 'en', scope, width = 1440, height = 900, context } = {}) {
  const ctx = context ?? (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 }));
  const page = await ctx.newPage();
  const net = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    if (u.pathname.endsWith('/events/stream')) return;
    net.push({ t: Date.now(), kind: 'req', path: u.pathname.replace('/api/agent/web-shell/v1', ''), body: req.postData() });
  });
  page.on('requestfailed', (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    net.push({ t: Date.now(), kind: 'fail', path: u.pathname.replace('/api/agent/web-shell/v1', ''), error: req.failure()?.errorText });
  });
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/agent/web-shell/v1/')) return;
    if (u.pathname.endsWith('/events/stream')) return;
    let body = '';
    try { body = (await res.text()).slice(0, 2000); } catch {}
    net.push({ t: Date.now(), kind: 'res', path: u.pathname.replace('/api/agent/web-shell/v1', ''), status: res.status(), body });
  });
  const q = new URLSearchParams({ tenant: 'rig', lang });
  if (sid) q.set('sid', sid);
  if (scope !== undefined) q.set('scope', scope);
  await page.goto(`${VITE[arm]}${FIXTURE}?${q}`);
  return { ctx, page, net, errors };
}

/** Starts a 50 ms sampler of the task panel / header status text inside the page. */
export async function startSampler(page) {
  await page.evaluate(() => {
    const w = window;
    w.__samples = [];
    let last = '';
    w.__sampler = setInterval(() => {
      const panel = document.querySelector('[data-managed-task-panel]');
      const header = [...document.querySelectorAll('span[role="status"]')].map((e) => e.textContent).join(' | ');
      const text = (panel ? panel.innerText.replace(/\s+/g, ' ') : '<no panel>') + ' || HEADER: ' + header;
      if (text !== last) {
        last = text;
        w.__samples.push({ t: Date.now(), text });
      }
    }, 50);
  });
}
export async function samples(page) {
  return page.evaluate(() => window.__samples ?? []);
}

/** Approves every requested permission Action of the session (rig auto-approver). */
export async function approveAll(db, sid) {
  const r = await api(db, 'GET', `/${sid}/actions`);
  const done = [];
  for (const a of r.json?.data ?? []) {
    if (a.state !== 'requested' || a.kind !== 'permission') continue;
    const p = await api(db, 'POST', `/${sid}/actions/${a.id}/responses`, {
      kind: 'permission', input_revision: a.input_revision, policy_revision: a.policy_revision, option_id: 'allow',
    });
    done.push(`${a.tool_name}:${p.status}`);
  }
  return done;
}
/** Approve Actions until the newest parent Turn is terminal. */
export async function driveTurn(db, sid, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  const approvals = [];
  for (;;) {
    approvals.push(...(await approveAll(db, sid)));
    const row = sql(db, `SELECT CONCAT(status,' ',IFNULL(error_code,'-')) FROM managed_agent_turn WHERE session_id='${sid}' ORDER BY created_at DESC LIMIT 1`);
    if (/^(COMPLETED|FAILED|CANCELLED)/.test(row)) return { turn: row, approvals };
    if (Date.now() > deadline) return { turn: `TIMEOUT ${row}`, approvals };
    await sleep(700);
  }
}

/** Parent with one background child whose model call is held; returns once the task runs. */
export async function launchChild(db, prefix, mode = 'bg') {
  const id = prefix + Date.now().toString(36);
  const sid = await createParent(db, `PARENT::${mode}::${id}::hold start the background child`);
  const launch = await driveTurn(db, sid);
  let taskId;
  for (let i = 0; i < 60 && !taskId; i++) {
    const t = await api(db, 'GET', `/${sid}/tasks`);
    taskId = t.json?.data?.find((x) => x.kind === 'child_agent' && x.state === 'running')?.id;
    if (!taskId) await sleep(1000);
  }
  return { id, sid, taskId, launch };
}
