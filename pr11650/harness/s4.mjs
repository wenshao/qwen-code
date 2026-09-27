// Test-plan step 4a: the session_rewound SSE frame is held 4.5s by the proxy
// (beyond the 2s sync timeout). Expect: no send, writes blocked, then one
// recoverable replacement with manual retry and no automatic send.
import { open, typeAndSend, waitText, sleep, rows, assistantLines, shot, mkLog, openEditor, composerText, modelLog, proxyLog, PORTS } from './lib.mjs';
const arm = process.argv[2] ?? 'after';
const log = mkLog(`s4-${arm}`);
const { browser, page, net } = await open(arm);
await typeAndSend(page, 'ALPHA first question');
await waitText(page, 'Reply to ALPHA');
await sleep(800);
await typeAndSend(page, 'QUEBEC second question');
await waitText(page, 'Reply to QUEBEC');
await sleep(1500);
await page.locator('[data-web-shell-composer-editor] .cm-content').click();
await page.keyboard.type('UNRELATED DRAFT');
await openEditor(page);
await page.fill('textarea[aria-label="Edit message"]', 'ROMEO late sync');
await fetch(`http://127.0.0.1:${PORTS[arm].proxy}/__probe/arm?delayRewoundMs=4500`);
const nModel0 = modelLog(arm).filter((r) => r.isMain).length;
const t0 = Date.now();
await page.keyboard.press('Enter');
const sample = async (label) => {
  const st = await page.evaluate(() => ({
    toasts: [...document.querySelectorAll('[data-web-shell-toast]')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
    submitDisabled: document.querySelector('[data-web-shell-composer-submit]')?.hasAttribute('disabled') ?? null,
    editorOpen: !!document.querySelector('textarea[aria-label="Edit message"]'),
    sendingLabel: [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Sending…'),
  }));
  log(`[t+${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`, { rows: await rows(page), composer: await composerText(page), ...st, prompts: net.filter((r) => r.t >= t0 && /\/prompt$/.test(r.u) && r.m === 'POST').length, modelMain: modelLog(arm).filter((r) => r.isMain).length - nModel0 });
};
await sleep(1000); await sample('sync pending');
await sleep(1600); await sample('after 2s timeout');
await shot(page, `s4-${arm}-0-blocked`);
// try to send the unrelated draft while writes are blocked
await page.locator('[data-web-shell-composer-editor] .cm-content').click();
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await sleep(600); await sample('pressed Enter in composer while blocked');
await sleep(2200); await sample('after late rewound frame');
await sleep(3000); await sample('3s later (no auto-send expected)');
await shot(page, `s4-${arm}-1-recovered`);
log('proxy rewound frames', proxyLog(arm).filter((r) => r.sseFrame && r.t >= t0).map((r) => ({ dt: r.t - t0, held: r.heldMs })));
await page.click('button[aria-label="Retry sending message"]');
await waitText(page, 'Reply to ROMEO');
await sleep(2000);
log('rows after retry', await rows(page));
log('assistant after retry', await assistantLines(page));
log('composer after retry', JSON.stringify(await composerText(page)));
await shot(page, `s4-${arm}-2-after-retry`);
await browser.close();
