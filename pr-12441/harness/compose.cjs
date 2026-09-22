const { chromium } = require('playwright'); const fs = require('fs');
const S = '/root/verify/pr12441/shots/', SO = '/root/verify/pr12441/shots-old/', OUT = '/root/verify/pr12441/publish/pr-12441/';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const tones = { bad: '#f85149', good: '#3fb950', ref: '#58a6ff', note: '#d29922' };
function panel(p, width) {
  const c = p.crop || { x: 0, y: 0, w: 2800, h: 1800 }; const scale = width / c.w;
  const img = !p.img ? '' : `<div style="width:${width}px;height:${Math.round(c.h * scale)}px;overflow:hidden;border:1px solid #30363d;border-radius:6px">
    <img src="${uri(p.img)}" style="display:block;width:${Math.round(2800 * scale)}px;margin-left:${-Math.round(c.x * scale)}px;margin-top:${-Math.round(c.y * scale)}px"></div>`;
  const lines = (p.lines || []).map((l) => { const m = /^([✗✓•])\s/.exec(l); const col = m ? (m[1] === '✗' ? tones.bad : m[1] === '✓' ? tones.good : '#8b949e') : '#c9d1d9'; return `<div style="color:${col}">${l ? esc(l) : '&nbsp;'}</div>`; }).join('');
  return `<div style="width:${width}px"><div style="font:600 17px system-ui;color:${tones[p.tone]};margin:0 0 8px">${esc(p.label)}</div>${img}
    <div style="margin-top:${p.img ? 10 : 0}px;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px;font:13px/1.55 'DejaVu Sans Mono',monospace;white-space:pre-wrap">${lines}</div></div>`;
}
async function fig(page, name, f) {
  const w = f.panelWidth || 900;
  const html = `<html><body style="margin:0;background:#0d1117"><div id="fig" style="display:inline-block;padding:22px 24px;background:#0d1117;color:#c9d1d9">
    <div style="font:700 21px system-ui;color:#f0f6fc">${esc(f.title)}</div><div style="font:14px system-ui;color:#8b949e;margin:4px 0 16px">${esc(f.subtitle)}</div>
    <div style="display:flex;gap:22px;align-items:flex-start">${f.panels.map((p) => panel(p, p.width || w)).join('')}</div>
    ${f.footer ? `<div style="font:13px system-ui;color:#8b949e;margin-top:14px">${esc(f.footer)}</div>` : ''}</div></body></html>`;
  await page.setContent(html); await page.waitForTimeout(300);
  const box = await page.locator('#fig').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 10, height: Math.ceil(box.height) + 10 });
  const b2 = await page.locator('#fig').boundingBox();
  await page.screenshot({ path: OUT + name, clip: b2 }); console.log(name, Math.round(b2.width), 'x', Math.round(b2.height));
}
(async () => {
  const br = await chromium.launch(); const page = await (await br.newContext({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } })).newPage();
  const crop = { x: 0, y: 0, w: 2800, h: 1800 };
  await fig(page, '01-ab-single-project-open.png', {
    title: 'PR #12441 · clicking a persisted "Voice chat" on a daemon serving ONE project (the reported topology)',
    subtitle: 'Same real daemon (qwen serve from this PR head, 0.24.3), same session, same click · /capabilities: multi_workspace_sessions ABSENT, workspaces[] = [project (primary), Conversations kind:"live" trusted non-primary]',
    panels: [
      { label: 'BEFORE · merge-base client (only session-context.ts reverted)', tone: 'bad', img: S + 's1-base-r1-b-after-click.png', crop, lines: [
        '✗ POST /session/<id>/load  — never sent',
        '✗ console: [web-shell] Daemon does not advertise multi-workspace session routing',
        '✗ transcript: 0 of 4 spoken lines rendered (empty "New session")',
        '✗ cold reload of /session/<id>?context=live: same, no /load',
        '• 3/3 runs identical'] },
      { label: 'AFTER · PR head 4d1a7ab client', tone: 'good', img: S + 's1-head-r1-b-after-click.png', crop, lines: [
        '✓ POST /session/<id>/load → 200',
        '✓ console: no errors or warnings after the click',
        '✓ transcript: all 4 spoken lines rendered',
        '✓ cold reload of /session/<id>?context=live: /load → 200, transcript restored',
        '• 3/3 runs identical'] },
    ],
    footer: 'The "interrupted" banner and the "New session" header also appear on the unchanged two-project path (figure 03), so this PR does not cause them.',
  });
  await fig(page, '02-real-live-call-seed.png', {
    title: 'Where the "Voice chat" session came from: a real Live Voice call placed from the Web Shell',
    subtitle: 'Chromium fake microphone → /live/web → daemon Live coordinator → wss realtime provider (the only scripted part) → transcript persisted by the daemon itself',
    panels: [
      { label: 'Live Voice dialog during the call (this tab is the mic/speaker)', tone: 'ref', img: S + 'seed-02-in-call.png', crop: { x: 958, y: 488, w: 884, h: 824 }, width: 600, lines: [
        '• provider: scripted DashScope-shaped realtime server on',
        '  wss://fake-live.dashscope.aliyuncs.com (TLS via a local CA,',
        '  DNS pinned to loopback for that one host only)',
        '• 2 spoken turns, then "Stop Live"'] },
      { label: 'What the daemon wrote and advertised', tone: 'ref', img: S + 'seed-03-after-stop.png', crop: { x: 0, y: 0, w: 520, h: 1100 }, width: 250, lines: [] , hide: true },
    ].slice(0, 1).concat([{ label: 'What the daemon advertised and wrote', tone: 'ref', width: 700, lines: [
        'GET /capabilities  (single-project daemon, Live Voice on)',
        '  qwenCodeVersion           0.24.3',
        '  multi_workspace_sessions  ✗ absent   (features: 142)',
        '  realtime_voice_web        present',
        '  workspaces[0]  demo-project           primary  trusted',
        '  workspaces[1]  …/Qwen Code/Conversations  kind:"live"',
        '                 primary:false  trusted:true',
        '',
        '~/.qwen/projects/…-Conversations/chats/<id>.jsonl',
        '  system    session_source   realtime_voice:<callId>',
        '  system    custom_title     "Voice chat" (auto)',
        '  user      realtime_message "What does this project do? …"',
        '  assistant realtime_message "It is a small demo repository …"',
        '  user      realtime_message "Thanks. Remind me later …"',
        '  assistant realtime_message "Noted — I will remind you …"'] }]),
  });
  await fig(page, '03-control-and-typed-turn.png', {
    title: 'Reference behaviour and usability after opening',
    subtitle: 'Left: the path that already worked before the PR (two projects ⇒ multi_workspace_sessions present). Right: PR head on the single-project daemon, after sending a typed message into the opened Live session.',
    panels: [
      { label: 'CONTROL · merge-base client, daemon with TWO projects', tone: 'ref', img: S + 's2-base-r1-b-after-click.png', crop, lines: [
        '• multi_workspace_sessions present ⇒ base already opens it',
        '• POST /session/<id>/load → 200, all 4 lines rendered',
        '• same header, same "interrupted" banner as the PR arm',
        '• non-2xx set identical in all 4 cells (base/head × 1/2 projects):',
        '  only GET /workspaces/<live cwd>/sessions/live-state → 400',
        '  (pre-existing, fired on page load before any click)'] },
      { label: 'AFTER · PR head, ONE project: typed turn in the opened Live session', tone: 'good', img: SO + 's1-head-d-typed-turn.png', crop, lines: [
        '✓ POST /session/<id>/prompt → 202, reply rendered, console clean',
        '✓ user + assistant records appended to the SAME Live session file',
        '  (record cwd under …/Qwen Code/Conversations/conversation-<hash>)',
        '✓ no new chat file under the demo-project storage dir',
        '• identical outcome on the two-project control (202 + reply)'] },
    ],
  });
  await fig(page, '04-preexisting-continue-execution.png', {
    title: 'Pre-existing, out of scope: "Continue execution" on a Voice chat transcript',
    subtitle: 'Reproduced on the merge-base client with TWO projects (the path that already worked), so this predates the PR. After this PR, single-project users can reach it too.',
    panels: [
      { label: 'After pressing "Continue execution"', tone: 'note', img: S + 's2-base-f-continue-live.png', crop, lines: [
        '• the banner appeared on every Voice chat I opened (all arms)',
        '• pressing it makes 1 backend model request; the answer is glued',
        '  onto the spoken reply: "…next time we talk.Typed reply #7 …"'] },
      { label: 'After a page reload', tone: 'note', img: S + 's2-base-g-continue-reload.png', crop, lines: [
        '• the spoken reply "Noted — I will remind you …" no longer renders;',
        '  only the backend answer is shown (the record is still on disk)',
        '• where the banner comes from was not traced; it is not in the',
        '  client code this PR touches (identical on the merge-base client)'] },
    ],
  });
  await br.close();
})().catch((e) => { console.error(e); process.exit(1); });
