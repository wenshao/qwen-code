// Playwright helpers against the daemon's own Web Shell bundle.
import pw from '/root/git/pr11636/node_modules/playwright/index.js';
import * as O from './obs.mjs';

const { chromium } = pw;
export const SHOTS = '/root/git/h11636/out/shots';

export async function open(sid, { width = 1360, height = 900 } = {}) {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('qwen-code-web-shell-sidebar-width', '320');
    } catch {}
  });
  const page = await ctx.newPage();
  const net = [];
  const errors = [];
  page.on('request', (r) => {
    const u = r.url().replace(O.BASE, '');
    if (/mid-turn-message|\/prompt$|\/cancel$|pending-prompts\/?/.test(u) && r.method() !== 'GET') {
      net.push({ t: Date.now(), method: r.method(), url: u, body: (r.postData() || '').slice(0, 300) });
    }
  });
  page.on('response', async (r) => {
    const u = r.url().replace(O.BASE, '');
    if (/mid-turn-message|\/prompt$|\/cancel$/.test(u) && r.request().method() !== 'GET') {
      let body = '';
      try {
        body = (await r.text()).slice(0, 300);
      } catch {}
      net.push({ t: Date.now(), status: r.status(), url: u, body });
    }
  });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${O.BASE}/session/${sid}#token=${O.TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cm-content', { timeout: 30000 });
  await page.waitForTimeout(2500);
  return { browser, ctx, page, net, errors };
}

export async function send(page, text) {
  await page.locator('.cm-content').click();
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press('Enter');
}

export async function shot(page, name, opts = {}) {
  const file = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: file, ...opts });
  return file;
}

/** Structural facts the report asserts on, read from the live DOM. */
export async function facts(page, sid, needles = []) {
  return page.evaluate(
    ({ sid, needles }) => {
      const q = (s) => [...document.querySelectorAll(s)];
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      };
      const text = document.body.innerText;
      const rowFor = q('[data-web-shell-session-title]').find((el) => el.closest('[role="button"]')?.outerHTML.includes(sid.slice(0, 8)));
      return {
        userRows: q('[data-web-shell-user-row]').length,
        markers: q('[data-background-turn-start]').map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        taskNotices: (text.match(/Background agent "[^"]+" completed\./g) || []).length,
        sidebarBgDot: q('[data-web-shell-session-background-running]').filter(vis).length,
        sidebarRunning: q('[data-web-shell-session-running]').filter(vis).length,
        placeholder: (document.querySelector('.cm-placeholder')?.textContent || '').trim(),
        expandSteps: q('button').filter((b) => b.innerText.trim() === 'Expand steps' || b.getAttribute('aria-label') === 'Expand steps').length,
        collapseSteps: q('button').filter((b) => b.innerText.trim() === 'Collapse steps' || b.getAttribute('aria-label') === 'Collapse steps').length,
        needles: Object.fromEntries(needles.map((n) => [n, (text.split(n).length - 1)])),
        sidebarRowFound: !!rowFor,
      };
    },
    { sid, needles },
  );
}
