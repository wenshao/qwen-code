// VERIFICATION RIG ONLY (PR #13179): a panel opened on a Session id the server does not know (a stale link / bookmark).
// Both snapshot legs answer 404, so which leg's rejection reaches Promise.all first decides the bootstrap's verdict.
// N pages per arm, each on its own unknown id, watched for WATCH_S seconds.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Report, j, RIG, DB, api } from './lib.mjs';
import { launch, open, alertText, shot, counts, sleep } from './ui.mjs';
const N = Number(process.env.N ?? 10);
const WATCH_S = Number(process.env.WATCH_S ?? 120);
const r = new Report('u3-unknown');
const id = () => 'ses_' + randomBytes(13).toString('hex');
const probe = id();
for (const [p, body] of [['/sessions/get', { sessionId: probe }], ['/transcript/query', { sessionId: probe, limit: 100 }]]) {
  const x = await api('POST', '/api/agent/web-shell/v1' + p, body);
  r.note(`server answer ${p}`, `${x.status} ${x.ms} ms ${JSON.stringify(x.json).slice(0, 140)}`);
}
const b = await launch();
const pages = [];
for (let i = 0; i < N; i++) for (const arm of (process.env.ARMS ?? 'base,head').split(',')) pages.push({ ...(await open(b, { arm, session: id(), scale: i === 0 ? 2 : 1 })), i, t0: Date.now() });
await sleep(WATCH_S * 1000);
for (const p of pages.filter((x) => x.i === 0)) await shot(p.page, `u3-${p.arm}`);
const rows = [];
for (const p of pages) {
  const tx = p.net.filter((e) => e.path === '/transcript/query');
  const sg = p.net.filter((e) => e.path === '/sessions/get');
  // pair each bootstrap's two legs (issued within 50 ms of each other) and see which answered first
  const attempts = tx.map((x) => { const s = sg.find((y) => Math.abs(y.t - x.t) < 50); return { sessionFirst: s && s.tr !== undefined && x.tr !== undefined ? s.tr <= x.tr : null, s: s?.status, x: x.status }; });
  const row = {
    arm: p.arm, i: p.i, requests: p.net.length, byPath: counts(p.net),
    bootstrapAttempts: tx.length, sessionLegFirst: attempts.map((a) => a.sessionFirst),
    lastRequestS: p.net.length ? +((p.net.at(-1).t - p.t0) / 1000).toFixed(1) : null,
    alerts: await alertText(p.page),
  };
  rows.push(row);
  r.say(`ROW ${JSON.stringify(row)}`);
}
for (const arm of (process.env.ARMS ?? 'base,head').split(',')) {
  const a = rows.filter((x) => x.arm === arm);
  r.note(`${arm}: requests per page in ${WATCH_S}s`, j(a.map((x) => x.requests)));
  r.note(`${arm}: bootstrap attempts per page`, j(a.map((x) => x.bootstrapAttempts)));
  r.note(`${arm}: pages whose bootstrap stopped after one attempt`, `${a.filter((x) => x.bootstrapAttempts === 1).length}/${a.length}`);
}
fs.writeFileSync(`${RIG}/out/${DB}/u3-net.json`, JSON.stringify({ pages: pages.map((p) => ({ arm: p.arm, i: p.i, t0: p.t0, net: p.net })) }));
await b.close();
r.done({ rows });
