// r2-post.mjs <arm> [case,...] — per case: open a live browser on a fresh session, POST the prompt over raw HTTP,
// capture the live render, then locate the persisted user record in the session JSONL.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, BASE, TOKEN, WS, OUT, sleep, save } from './ui.mjs';
import { CASES } from './r2-cases.mjs';
const arm = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(CASES);
const HOMEQ = process.env.HOME_QWEN || '/root/verify/pr12404-r2-e2e/home';
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const state = async (page, name) => {
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return {
    bubble: await page.locator('[class*="chatBubble"]', { hasText: name }).count(),
    tags: await page.locator('[class*="chatBubble"] [class*="messageTag"]').evaluateAll((els) => els.filter((e) => !e.parentElement.closest('[class*="messageTag"]')).map((e) => e.textContent.trim())),
    couldNotDisplay: (body.match(/This message could not be displayed/g) || []).length,
    appCrashed: /Something went wrong/.test(body),
    reply: body.includes('Done. (mock reply)'),
  };
};
const out = { arm, cases: {} };
for (const name of only) {
  const { text, anns } = CASES[name];
  const c = await (await fetch(BASE + '/session', { method: 'POST', headers: H, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) })).json();
  const { browser, page, log } = await launch();
  await page.goto(`${BASE}/session/${c.sessionId}#token=${TOKEN}`); await sleep(5000);
  const body = JSON.stringify({ prompt: [{ type: 'text', text }], _meta: { inputAnnotations: anns } });
  const r = await fetch(`${BASE}/session/${c.sessionId}/prompt`, { method: 'POST', headers: { ...H, 'X-Qwen-Client-Id': c.clientId }, body });
  await sleep(name === 'HUGE' ? 12000 : 6000);
  const live = await state(page, name);
  await page.screenshot({ path: `${OUT}/${arm}-${name}-live.png` });
  await browser.close();
  // persisted user record
  const file = execFileSync('find', [HOMEQ, '-name', `${c.sessionId}.jsonl`]).toString().trim().split('\n')[0];
  let record = null;
  if (file) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes(name)) continue;
      try { const o = JSON.parse(line); if (o.type === 'user') { record = o; break; } } catch {}
    }
  }
  const sp = record?.systemPayload;
  const persisted = sp ? { keys: Object.keys(sp), annotations: Array.isArray(sp.inputAnnotations) ? sp.inputAnnotations.length : null, annotationTypes: Array.isArray(sp.inputAnnotations) ? sp.inputAnnotations.slice(0, 8).map((a) => (a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a)) : null, recordBytes: JSON.stringify(record).length } : { systemPayload: null, recordBytes: record ? JSON.stringify(record).length : null };
  const pageErrors = log.filter((l) => l.startsWith('[pageerror]') || /TypeError/.test(l)).slice(0, 3);
  out.cases[name] = { sid: c.sessionId, jsonl: file, promptStatus: r.status, bodyBytes: body.length, sent: anns.length, live, persisted, pageErrors };
  console.log(`[${arm}] ${name}: prompt=${r.status} sent=${anns.length} live=${JSON.stringify(live)} persisted=${JSON.stringify(persisted)} errors=${pageErrors.length}`);
}
save(`${arm}-r2-post.json`, out);
