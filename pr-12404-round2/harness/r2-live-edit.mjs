// r2-live-edit.mjs <arm> <case> — watch a session live, POST the case over raw HTTP, then edit the (live) user message and resend.
import { launch, BASE, TOKEN, WS, OUT, sleep, save } from './ui.mjs';
import { CASES } from './r2-cases.mjs';
const [arm, name] = process.argv.slice(2);
const H = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const c = await (await fetch(BASE + '/session', { method: 'POST', headers: H, body: JSON.stringify({ cwd: WS, sessionScope: 'thread' }) })).json();
const { browser, context, page, log } = await launch();
await context.addInitScript(() => { window.__errs = []; addEventListener('unhandledrejection', (e) => window.__errs.push('unhandledrejection: ' + String(e.reason && (e.reason.stack || e.reason)).slice(0, 300))); addEventListener('error', (e) => window.__errs.push('error: ' + String(e.message).slice(0, 300))); });
await page.goto(`${BASE}/session/${c.sessionId}#token=${TOKEN}`); await sleep(5000);
const { text, anns } = CASES[name];
await fetch(`${BASE}/session/${c.sessionId}/prompt`, { method: 'POST', headers: { ...H, 'X-Qwen-Client-Id': c.clientId }, body: JSON.stringify({ prompt: [{ type: 'text', text }], _meta: { inputAnnotations: anns } }) });
await sleep(6000);
if (process.env.RELOAD_FIRST) { await page.reload(); await sleep(6000); }
const bubble = page.locator('[class*="chatBubble"]', { hasText: name }).first();
const res = { arm, name, sid: c.sessionId, bubble: await bubble.count() };
if (res.bubble) {
  await bubble.hover(); await sleep(400);
  const edit = page.getByRole('button', { name: 'Edit message' }).first();
  res.editButton = await edit.count();
  if (res.editButton) {
    await edit.click(); await sleep(1200);
    const ta = page.locator('textarea').first();
    res.textarea = await ta.count();
    if (res.textarea) {
      const orig = await ta.inputValue();
      await ta.fill(orig.replace(name, name + ' edited'));
      const reqP = page.waitForRequest((r) => r.method() === 'POST' && /\/prompt$/.test(new URL(r.url()).pathname), { timeout: 12000 }).catch(() => null);
      await page.getByRole('button', { name: 'Send' }).first().click().catch((e) => { res.sendClickError = String(e).slice(0, 200); });
      const req = await reqP;
      res.editPromptSent = !!req;
      if (req) { const b = req.postDataJSON(); res.editedText = b.prompt?.[0]?.text; res.editedAnnotations = (b._meta?.inputAnnotations || []).length; }
      await sleep(5000);
    }
  }
}
const body = await page.locator('body').innerText().catch(() => '');
res.windowErrors = await page.evaluate(() => window.__errs || []);
res.stillEditing = await page.locator('textarea').count();
res.appCrashed = /Something went wrong/.test(body);
res.couldNotDisplay = (body.match(/This message could not be displayed/g) || []).length;
res.errors = log.filter((l) => l.startsWith('[pageerror]') || /TypeError|Unhandled/.test(l)).map((l) => l.slice(0, 220)).slice(0, 4);
await page.screenshot({ path: `${OUT}/${arm}-live-edit-${name}${process.env.RELOAD_FIRST ? '-reloaded' : ''}.png` });
console.log(JSON.stringify(res));
save(`${arm}-live-edit-${name}${process.env.RELOAD_FIRST ? '-reloaded' : ''}.json`, res);
await browser.close();
