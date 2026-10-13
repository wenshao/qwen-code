// Round-2 evidence cards for PR #13325 (head 621d2c08) -> fig2/*.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13325-rig/src-h2/package.json');
const { chromium } = require('playwright');
const DIR = '/Users/wenshao/pr13325-rig/fig2';
const RUNS = '/Users/wenshao/pr13325-rig/runs';
const J = (n) => JSON.parse(fs.readFileSync(`${RUNS}/${n}/results.json`, 'utf8'));
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1200px;max-width:2100px}
h1{font-size:24px;margin:0 0 4px 0;color:#f0f6fc}
.sub{color:#8b949e;font-size:14px;margin-bottom:16px;max-width:1650px}
table{border-collapse:collapse;font-size:14px;margin:6px 0 14px 0}
th{background:#161b22;color:#8b949e;text-align:left;padding:7px 10px;border:1px solid #30363d;font-weight:600}
td{padding:6px 10px;border:1px solid #30363d;vertical-align:top;font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre}
td.t{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:14px;white-space:normal;max-width:430px}
.bad{color:#ff7b72}.good{color:#7ee787}.warn{color:#e3b341}.dim{color:#8b949e}
pre{background:#161b22;border:1px solid #30363d;padding:10px 12px;font-size:13px;line-height:1.45;margin:6px 0 14px 0;white-space:pre;overflow:hidden}
.note{border-left:4px solid #388bfd;padding:6px 12px;color:#c9d1d9;font-size:14px;margin-top:6px;max-width:1650px}
.note.w{border-color:#e3b341}
h2{font-size:16px;margin:16px 0 4px 0;color:#79c0ff}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;
const B = (s) => `<span class="bad">${esc(s)}</span>`;
const G = (s) => `<span class="good">${esc(s)}</span>`;
const W = (s) => `<span class="warn">${esc(s)}</span>`;
const D = (s) => `<span class="dim">${esc(s)}</span>`;
const ans = (x) => !x ? '?' : `${x.http}${x.code ? ' ' + x.code : ''}${x.replayed === true || x.replayed === 'true' ? ' replayed' : ''}`;
const cards = {};

// ---- 01 race ----
{
  const arms = { prev: J('race-prev-mysql'), h2: J('race-h2-mysql') };
  const reps = (d) => Object.keys(d).filter((k) => k.startsWith('rep')).map((k) => d[k]);
  const rowsFor = (arm, label, good) => reps(arms[arm]).map((v, i) => row([
    i === 0 ? (good ? G(label) : B(label)) : '', `#${i + 1}`, String(v.parked.commandRowsForKey), ans(v.alice1),
    (good ? G : B)(ans(v.bob)), (good ? G : B)(String(v.afterBob.titleCallsByBob)),
    (good ? G : B)(`${v.afterBob.cmd[0].status} (actor_key=${v.afterBob.cmd[0].actor_key})`),
    `${v.afterBob.delivery[0].state} rev ${v.afterBob.delivery[0].rev}`,
    (good ? G : B)(v.afterBob.session.split('\t')[0]), ans(v.aliceRetry),
  ]));
  cards['01-rename-race'] = page(
    'Unfinished-rename replay race: the key is recorded after the racer\'s pre-read (fix 621d2c08)',
    'Workspace-bound Session, MySQL 8.4.7. alice = creator (OPERATOR), bob = another OPERATOR. prev = b657a1e6 (head before the fix), head = 621d2c08. Same requests on both jars, 3 runs each.',
    `<pre>1. JDI breakpoint (SUSPEND_EVENT_THREAD) on ManagedAgentStore.beginSessionRename entry
2. bob   PATCH /v1/agents/sessions/{id} {"title":"alice-title-N"}  Idempotency-Key: K
         ManagedAgentService.renameSession pre-read findCommand(K) -> none; thread parks at beginSessionRename  ${D('(rows for K at park time: 0)')}
3. alice PATCH same body, same K; the rig proxy answers her POST /session/:id/title with 503
         -> 503 hosted_harness_unavailable; command K = FAILED (actor_key alice); delivery PENDING, claimable
4. release bob   5. alice retries her own key</pre>` +
    table(['arm', 'run', 'rows@park', 'alice (1st)', 'bob answer', 'bob Harness /title calls', 'alice\'s command after bob', 'delivery', 'Session title after bob', 'alice retry'], [
      ...rowsFor('prev', 'prev b657a1e6', false), ...rowsFor('h2', 'head 621d2c08', true),
    ]) +
    `<div class="note">prev: bob gets <b>200 replayed=true</b>, claims alice's delivery, makes the Harness title call and completes alice's command (3/3). head: the discovery arm under the Session lock refuses bob with 409 before any side effect; alice's own retry then completes it (3/3).</div>`,
  );
}

// ---- 02 ownership ----
{
  const mb = J('owner-mb-mysql'), h2 = J('owner-h2-mysql');
  const cmp = (label, a, b, goodHead = true) => row([label, ans(a), (goodHead ? G : W)(ans(b))], ['t']);
  const L = (d, who, k) => d.live[who][k];
  const X = (d, who, k) => d.afterDelete[who][k];
  cards['02-replay-ownership'] = page(
    'Replay ownership across actors on one Workspace-bound Session (base vs head)',
    'MySQL 8.4.7. alice = creator (OPERATOR), bob = OPERATOR, carol = READER, dave = no grant. base = 83ffe454 (merge base), head = 621d2c08. Same requests on both jars.',
    `<h2>Live Session</h2>` +
    table(['request', 'base', 'head'], [
      cmp('bob replays alice\'s submit key (same body)', L(mb, 'bob', 'submitReplay'), L(h2, 'bob', 'submitReplay')),
      cmp('bob replays alice\'s rename key (same title)', L(mb, 'bob', 'renameReplay'), L(h2, 'bob', 'renameReplay')),
      cmp('bob, alice\'s rename key, other title', L(mb, 'bob', 'renameReplayOtherTitle'), L(h2, 'bob', 'renameReplayOtherTitle')),
      cmp('bob replays alice\'s cancel key', L(mb, 'bob', 'cancelReplay'), L(h2, 'bob', 'cancelReplay')),
      row(['bob replays alice\'s UNFINISHED rename key (her Harness call failed)', `${ans(mb['bob.replays.aliceUnfinishedRename'])}\n${B(`bob made ${mb['unfinished.afterBob'].titleCallsByBob} Harness /title call; alice's row -> ${mb['unfinished.afterBob'].cmd[0].status}`)}`, `${G(ans(h2['bob.replays.aliceUnfinishedRename']))}\n${G(`0 Harness calls; alice's row stays ${h2['unfinished.afterBob'].cmd[0].status}`)}`], ['t']),
      cmp('bob replays his own submit key', L(mb, 'bob', 'bobKeySubmitReplay'), L(h2, 'bob', 'bobKeySubmitReplay')),
      cmp('alice (creator) replays bob\'s key', L(mb, 'alice', 'bobKeySubmitReplay'), L(h2, 'alice', 'bobKeySubmitReplay')),
      cmp('alice replays her own submit / rename / cancel', { http: `${L(mb, 'alice', 'submitReplay').http}/${L(mb, 'alice', 'renameReplay').http}/${L(mb, 'alice', 'cancelReplay').http}`, replayed: true }, { http: `${L(h2, 'alice', 'submitReplay').http}/${L(h2, 'alice', 'renameReplay').http}/${L(h2, 'alice', 'cancelReplay').http}`, replayed: true }),
      cmp('carol (READER) replays any key', L(mb, 'carol', 'submitReplay'), L(h2, 'carol', 'submitReplay')),
      cmp('dave (no grant) replays any key', L(mb, 'dave', 'submitReplay'), L(h2, 'dave', 'submitReplay')),
    ]) +
    `<h2>After delete (bound Session: tombstone written with the product's delete-completion UPDATE; legacy Session: real DELETE)</h2>` +
    table(['request', 'base', 'head'], [
      cmp('alice replays her submit / cancel key', { http: `${X(mb, 'alice', 'submitReplay').http}/${X(mb, 'alice', 'cancelReplay').http}`, code: X(mb, 'alice', 'submitReplay').code }, { http: `${X(h2, 'alice', 'submitReplay').http}/${X(h2, 'alice', 'cancelReplay').http}`, replayed: true }),
      cmp('alice replays her rename key', X(mb, 'alice', 'renameReplay'), X(h2, 'alice', 'renameReplay')),
      cmp('bob replays alice\'s key', X(mb, 'bob', 'submitReplay'), X(h2, 'bob', 'submitReplay')),
      cmp('bob replays his own key', X(mb, 'bob', 'bobKeySubmitReplay'), X(h2, 'bob', 'bobKeySubmitReplay')),
      cmp('anyone, fresh key (submit / rename)', { http: `${X(mb, 'alice', 'freshSubmit').http}/${X(mb, 'alice', 'freshRename').http}`, code: X(mb, 'alice', 'freshSubmit').code }, { http: `${X(h2, 'alice', 'freshSubmit').http}/${X(h2, 'alice', 'freshRename').http}`, code: X(h2, 'alice', 'freshSubmit').code }),
      cmp('carol / dave, any key', X(mb, 'carol', 'submitReplay'), X(h2, 'dave', 'submitReplay')),
      cmp('legacy Session: submit / rename / cancel replay', { http: `${mb['legacy.afterDelete'].submitReplay.http}/${mb['legacy.afterDelete'].renameReplay.http}/${mb['legacy.afterDelete'].cancelReplay.http}`, code: 'session_not_found' }, { http: `${h2['legacy.afterDelete'].submitReplay.http}/${h2['legacy.afterDelete'].renameReplay.http}/${h2['legacy.afterDelete'].cancelReplay.http}`, replayed: true }),
      cmp('legacy Session: fresh submit / rename', { http: `${mb['legacy.afterDelete'].freshSubmit.http}/${mb['legacy.afterDelete'].freshRename.http}`, code: 'session_not_found' }, { http: `${h2['legacy.afterDelete'].freshSubmit.http}/${h2['legacy.afterDelete'].freshRename.http}`, code: 'session_not_found' }),
    ]) +
    `<div class="note">On base, any OPERATOR reads another operator's recorded outcome (turn id, title), and can finish their unfinished rename. On head, a recorded key answers only its recorder (V69 actor_key) or the Session's creator, and recorded outcomes survive a delete while fresh keys get 404.</div>`,
  );
}

// ---- 03 regression matrix of the original claims ----
{
  const L = (a, e) => J(`lockorder-${a}-${e}-r5`);
  const dl = (d) => `${Object.keys(d).filter((k) => k.startsWith('rep')).reduce((n, k) => n + d[k].deadlocks, 0)}/5 deadlocks`;
  const dis = { mb: J('dispatch-mb-mysql'), h2: J('dispatch-h2-mysql') };
  const rec = { mb: J('recovery-mb-mysql'), h2: J('recovery-h2-mysql'), mbm: J('recovery-mb-mariadb'), h2m: J('recovery-h2-mariadb') };
  const loc = { mb: J('locale-mb-mysql-tr'), h2: J('locale-h2-mysql-tr') };
  const pag = { mb: J('paging-mb-mysql'), h2: J('paging-h2-mysql') };
  const rep = { mb: J('replay-mb-mysql'), h2: J('replay-h2-mysql') };
  const tit = { mb: J('title-mb-mysql'), h2: J('title-h2-mysql') };
  const ws = { mb: J('wstitle-mb-mysql'), h2: J('wstitle-h2-mysql') };
  const r2 = (label, a, b) => row([label, B(a), G(b)], ['t']);
  cards['03-original-claims'] = page(
    'The eight original R2 Criticals, re-run at the new head (same requests against both jars)',
    'base = 83ffe454 (merge base), head = 621d2c08. MySQL 8.4.7 unless noted; lock order and recovery code also on MariaDB 10.11.18. tr_TR: JVM started with -Duser.language=tr -Duser.country=TR.',
    table(['claim', 'base', 'head'], [
      r2('Lock order: public cancel vs Harness admission (holder + held /prompt)', `MySQL ${dl(L('mb', 'mysql'))}\nMariaDB ${dl(L('mb', 'mariadb'))}`, `MySQL ${dl(L('h2', 'mysql'))}\nMariaDB ${dl(L('h2', 'mariadb'))}`),
      r2('PUT /v1/agents/sessions; text/plain + Idempotency-Key', `${dis.mb.put_collection.status} ${dis.mb.put_collection.code}; ${dis.mb.text_plain_with_key.status} ${dis.mb.text_plain_with_key.code}`, `${dis.h2.put_collection.status} Allow: ${dis.h2.put_collection.allow}; ${dis.h2.text_plain_with_key.status} ${dis.h2.text_plain_with_key.code}`),
      r2('recoveryDetailCode 129 / 4096 chars (MySQL and MariaDB)', `${rec.mb.len129.http} / ${rec.mb.len4096.http}, block not recorded (${rec.mb.len129.row[0]}); MariaDB ${rec.mbm.len129.http}`, `${rec.h2.len129.http} / ${rec.h2.len4096.http} ${rec.h2.len129.code}; MariaDB ${rec.h2m.len129.http}; 128 still recorded`),
      r2('tr_TR default locale: Session / running Turn / archived', `${loc.mb['create.status']} / ${loc.mb['turn.whileRunning'].status} / ${loc.mb['get.afterArchive']}`, `${loc.h2['create.status']} / ${loc.h2['turn.whileRunning'].status} / ${loc.h2['get.afterArchive']}`),
      r2('Replay while the Harness is disabled: recorded submit / create+input', `${rep.mb['outage.submitReplay'].http} ${rep.mb['outage.submitReplay'].code} / ${rep.mb['outage.createReplay'].http}`, `${rep.h2['outage.submitReplay'].http} replayed / ${rep.h2['outage.createReplay'].http} replayed; fresh still ${rep.h2['outage.freshSubmit'].http}`),
      r2('Rename / unarchive replay after a real delete', `${rep.mb['afterDelete.renameReplay'].http} / ${rep.mb['afterDelete.unarchiveReplay'].http}`, `${rep.h2['afterDelete.renameReplay'].http} (${rep.h2['afterDelete.renameReplay'].status}) / ${rep.h2['afterDelete.unarchiveReplay'].http} (${rep.h2['afterDelete.unarchiveReplay'].status})`),
      r2('Keyset paging after A\'s updated_at moved (rename / Turn), limit 2', `page 2 = ${JSON.stringify(pag.mb['rename.result'].page2)} / ${JSON.stringify(pag.mb['turn.result'].page2)}`, `page 2 = ${JSON.stringify(pag.h2['rename.result'].page2)} / ${JSON.stringify(pag.h2['turn.result'].page2)}`),
      row(['Title policy: public create 257 / 512 / 513, TAB; WebShell create 300; rename 257', W(`${tit.mb.create257.http} / ${tit.mb.create512.http} / ${tit.mb.create513.http} ${tit.mb.create513.code}, TAB ${tit.mb.createControlTab.http}; ${ws.mb.webshellCreate300.http}; ${tit.mb.rename257.http} ${tit.mb.rename257.code}`), W(`${tit.h2.create257.http} / ${tit.h2.create512.http} / ${tit.h2.create513.http} ${tit.h2.create513.code}, TAB ${tit.h2.createControlTab.http}; ${ws.h2.webshellCreate300.http}; ${tit.h2.rename257.http} ${tit.h2.rename257.code}`)], ['t']),
    ]) +
    `<div class="note">All eight reproduce exactly as in the round-1 verification at 58f8b173. The title row is a policy change rather than a fix: create now refuses 257–512 characters and control characters (documented in the OpenAPI at 256 since round 1).</div>`,
  );
}

// ---- 04 upgrade ----
{
  const u = { mysql: J('upgrade2-x-mysql'), mariadb: J('upgrade2-x-mariadb') };
  const clean = (s) => (s ?? '').replace(/\\0/g, '').replace(/\0/g, '');
  const sumMy = (a) => {
    a = clean(a);
    const top = a.match(/Limit: 21 row\(s\).*?actual time=[\d.]+\.\.([\d.]+) rows=(\d+)/);
    const idx = a.match(/Index lookup on managed_agent_session using (\w+)[^\n]*?(\(reverse\))?\s+\(cost[^\n]*?rows=(\d+) loops/);
    const sort = /-> Sort: managed_agent_session\.updated_at/.test(a);
    return `${sort ? 'Sort (filesort) over ' : ''}${idx ? idx[1] : '?'}${idx && idx[2] ? ' reverse scan' : ''}, reads ${idx ? idx[3] : '?'} rows, ${top ? top[1] : '?'} ms`;
  };
  const sumMaria = (a) => { const c = clean(a).split('\n')[0].split(' | '); return `key=${c[5]}, r_rows ${c[9]}${/filesort/i.test(c[12] ?? '') ? ', Using filesort' : ', no filesort'}`; };
  const ex = (e, ph) => { const a = u[e][ph]?.analyze ?? ''; return e === 'mysql' ? sumMy(a) : sumMaria(a); };
  const exr = (e) => { const a = u[e].rollback?.explain?.analyze ?? ''; return e === 'mysql' ? sumMy(a) : sumMaria(a); };
  cards['04-upgrade'] = page(
    'V69 + V70 on a populated database: upgrade from main, pre-upgrade keys, legacy title, rollback',
    'base jar (83ffe454, schema V68) creates 3,000 Sessions, a Workspace Session with alice\'s submit + rename keys, and a legacy 300-character title; then head (621d2c08) boots on the same database; then the base jar again.',
    table(['check', 'MySQL 8.4.7', 'MariaDB 10.11.18'], [
      row(['Flyway on head', ...['mysql', 'mariadb'].map((e) => G(u[e]['head.flyway'].slice(-2).map((x) => `V${x[0]} ${x[1]} ok`).join('\n') + `\nboot ${u[e]['head.bootMs']} ms`))], ['t']),
      row(['session indexes after upgrade', ...['mysql', 'mariadb'].map((e) => u[e]['head.indexes'].filter((x) => /created|list_idx/.test(x)).join('\n') + '\n' + D('managed_agent_session_list_idx dropped'))], ['t']),
      row(['pre-upgrade command rows (actor_key)', ...['mysql', 'mariadb'].map((e) => `submit ${u[e]['head.actorKeyOfPreUpgradeRows'].submit[0].actor_key}, rename ${u[e]['head.actorKeyOfPreUpgradeRows'].rename[0].actor_key}`)], ['t']),
      row(['replay of those keys: alice (creator) / bob (OPERATOR)', ...['mysql', 'mariadb'].map((e) => { const p = u[e]['head.preUpgradeReplays']; return `${G(`submit ${ans(p.aliceSubmit)}, rename ${ans(p.aliceRename)}`)}\n${W(`bob: submit ${ans(p.bobSubmit)}, rename ${ans(p.bobRename)}`)}`; })], ['t']),
      row(['legacy 300-char title (written by base): echo / other 300 / 256', ...['mysql', 'mariadb'].map((e) => { const l = u[e]['head.legacy300']; return `${G(`echo ${l.echo.http} no-op, Harness /title calls ${l.echoTitleCalls}`)}\nother 300 -> ${l.other300.http} ${l.other300.code}\n256 -> ${l.rename256.http}, 1 Harness call`; })], ['t']),
      row(['head list query on 3,000 Sessions', ...['mysql', 'mariadb'].map((e) => G(ex(e, 'head.explain')))], ['t']),
      row(['cursor minted by base, read by head (limit 3)', ...['mysql', 'mariadb'].map((e) => `page 2 = ${JSON.stringify(u[e]['head.cursorFromBase'].page2)}`)], ['t']),
      row(['rollback: base jar on the V70 schema', ...['mysql', 'mariadb'].map((e) => { const r = u[e].rollback; return `${r.bootMs ? `boots in ${r.bootMs} ms, list ${r.list.http}` : B(r.error)}\n${W(exr(e))}\n${W(`bob replays alice's key -> ${ans(r.bobReplay)} (no actor gate on base)`)}`; })], ['t']),
    ]) +
    `<div class="note">The upgrade is clean on both engines and a Turn on a pre-upgrade Session completes. NULL actor_key rows answer the creator only, as the V69 comment says. A rollback is possible, but the base jar's updated_at listing loses its index (filesort), and base answers replays without the actor gate.</div>`,
  );
}

// ---- 05 mutation ----
{
  const m = JSON.parse(fs.readFileSync('/Users/wenshao/pr13325-rig/out/mut2/results.json', 'utf8'));
  const rows = Object.entries(m).filter(([k]) => k !== 'BASELINE').map(([k, v]) => row([esc(k), v.killed ? G('killed') : B('SURVIVED'), v.totals ? `${Number(v.totals[1]) + Number(v.totals[2])} failed / ${v.totals[0]}` : "?", esc(v.failing.join('\n') || '-')]));
  cards['05-mutation'] = page(
    'Single-site mutants on head 621d2c08 against the PR\'s 14 touched test classes',
    `Each mutant is applied alone to a clean head worktree; the same 14 classes run each time (baseline: ${m.BASELINE.totals[0]} tests, ${m.BASELINE.totals[1]} failures). H2, JDK 21.`,
    table(['mutant', 'result', 'tests', 'failing tests'], rows),
  );
}

for (const [name, html] of Object.entries(cards)) fs.writeFileSync(`${DIR}/${name}.html`, html);
const only = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1900, height: 1200 } });
for (const name of Object.keys(cards)) {
  if (only.length && !only.includes(name)) continue;
  const p = await ctx.newPage();
  await p.goto(`file://${DIR}/${name}.html`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${DIR}/${name}.png` });
  console.log(name, 'clipped=', clipped);
  await p.close();
}
await browser.close();
