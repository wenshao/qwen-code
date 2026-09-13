// ARM=head|pre node ui-open.mjs <sid> <tag>  -> open the session in the real
// Web Shell and record what the page renders.
import * as O from './obs.mjs';
import * as U from './ui.mjs';
const sid = process.argv[2];
const tag = process.argv[3] || 'open';
const label = `${O.ARM}-${tag}`;
const NEEDLES = ['Ownership and rendering findings are complete. This is the final main-agent answer.', 'Ownership is understood; rendering is still being investigated.'];
const { browser, page, errors } = await U.open(sid);
await page.waitForTimeout(5000);
const deep = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const counts = {};
  for (const b of q('button')) { const n = (b.innerText || b.getAttribute('aria-label') || '').trim(); if (n) counts[n] = (counts[n] || 0) + 1; }
  return {
    buttons: counts,
    markers: q('[data-background-turn-start]').map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
    bodyText: document.body.innerText,
  };
});
const facts = await U.facts(page, sid, NEEDLES);
const shot = await U.shot(page, label, { fullPage: true });
O.save(`${U.SHOTS}/../runs/${label}.json`, { arm: O.ARM, sid, facts, deep, errors, shot });
console.log(label, JSON.stringify({ markers: deep.markers, expandSteps: facts.expandSteps, collapseSteps: facts.collapseSteps, errors }, null, 1));
const t = deep.bodyText; const i = t.indexOf('[[S:two]]');
console.log('--- transcript ---\n' + t.slice(i, i + 800));
await browser.close();
process.exit(0);
