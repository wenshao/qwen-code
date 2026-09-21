import { launch, BASE, TOKEN, OUT, sleep } from './ui.mjs';
const sid = process.argv[2];
const { browser, page } = await launch();
page.on('response', async (r) => {
  const u = new URL(r.url());
  if (!/\/(load|transcript)$/.test(u.pathname)) return;
  let b = ''; try { b = (await r.body()).toString(); } catch {}
  let summary = b.slice(0, 200);
  try { const d = JSON.parse(b); summary = JSON.stringify({ keys: Object.keys(d), events: (d.events || []).map((e) => e.data?.sessionUpdate + ':' + JSON.stringify(e.data?.content ?? '').slice(0, 50)), hasMore: d.hasMore, error: d.error, code: d.code }); } catch {}
  console.log(r.request().method(), u.pathname.replace(sid, '<sid>') + u.search.replace(/cursor=[^&]+/, 'cursor=…'), r.status(), b.length, 'bytes\n   ', summary.slice(0, 600));
  if (r.request().method() === 'POST') console.log('    req body:', (r.request().postData() || '').slice(0, 300));
});
await page.goto(`${BASE}/session/${sid}#token=${TOKEN}`); await sleep(8000);
await browser.close();
