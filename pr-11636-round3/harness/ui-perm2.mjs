// Web Shell view of the orphaned background approval.
// Foreground approvals are answered with allow_once over REST (no settings
// writes); the BACKGROUND turn's approval is left for the UI to render.
import * as O from './obs.mjs';
import * as U from './ui.mjs';

const label = `${O.ARM}-uiperm2`;
const out = { arm: O.ARM, label, steps: [], shots: [], facts: {} };
const step = (m, x) => { out.steps.push({ t: O.rel(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 260) : ''); };
const deep = async () => { const j = await (await fetch(`${O.BASE}/health?deep=1`, { headers: { Authorization: `Bearer ${O.TOKEN}` } })).json(); return j.pendingPermissions; };

await O.mockRun(label);
const s = await O.createSession({ approvalMode: 'default' });
const sid = s.sessionId;
out.sid = sid;

const ac = new AbortController();
const bgPerms = []; const resolutions = [];
(async () => {
  const res = await fetch(`${O.BASE}/session/${sid}/events`, { headers: { Authorization: `Bearer ${O.TOKEN}`, accept: 'text/event-stream', 'x-qwen-client-id': s.clientId }, signal: ac.signal });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'permission_request') {
        const rec = { t: O.rel(), requestId: ev.data?.requestId, backgroundTurn: ev.data?.backgroundTurn?.turnId, tool: ev.data?.toolCall?.title };
        if (rec.backgroundTurn) { bgPerms.push(rec); step('BACKGROUND approval raised -> left for the UI', rec); }
        else {
          const opts = ev.data?.options ?? [];
          const allow = opts.find((o) => o.kind === 'allow_once') ?? opts[0];
          await O.api(`/session/${sid}/permission/${rec.requestId}`, { method: 'POST', clientId: s.clientId, body: { outcome: { outcome: 'selected', optionId: allow?.optionId } } });
          step('foreground approval auto-allowed (once)', { tool: rec.tool, opt: allow?.optionId });
        }
      } else if (ev.type === 'permission_resolved') {
        resolutions.push({ t: O.rel(), requestId: ev.data?.requestId, outcome: JSON.stringify(ev.data?.outcome ?? {}) });
      }
    }
  }
})().catch(() => {});

const { browser, page } = await U.open(sid);
step('web shell open', { sid });

const uiFacts = async () => page.evaluate(() => {
  const t = document.body.innerText;
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  return {
    approvalWordsInSidebar: [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^Approval$/i.test(e.textContent.trim())).length,
    allowButtons: [...document.querySelectorAll('button')].map((b) => norm(b.innerText)).filter((x) => /allow|yes,|proceed|approve/i.test(x)).slice(0, 8),
    rejectButtons: [...document.querySelectorAll('button')].map((b) => norm(b.innerText)).filter((x) => /reject|no,|deny|don.t/i.test(x)).slice(0, 8),
    sleepShown: /sleep 120/.test(t),
    runningShell: /Running Shell/i.test(t),
    composer: (document.querySelector('.cm-content')?.getAttribute('aria-placeholder') || '').trim(),
    tail: norm(t).slice(-260),
  };
});

await U.send(page, '[[S:perm]] run the permission probe');
step('prompt sent from the composer');
const t0 = Date.now();
while (Date.now() - t0 < 60000 && bgPerms.length === 0) await page.waitForTimeout(300);
await page.waitForTimeout(2500);
out.facts.dialog = await uiFacts();
out.facts.pendingBefore = await deep();
out.shots.push(await U.shot(page, `${O.ARM}-perm2-1-approval`));
step('approval state', { pending: out.facts.pendingBefore, ...out.facts.dialog });

await O.prompt(sid, s.clientId, '[[S:after]] never mind, answer this instead');
step('next user message sent while the background approval is still open');
await page.waitForTimeout(14000);
out.facts.after = await uiFacts();
out.facts.pendingAfter = await deep();
out.shots.push(await U.shot(page, `${O.ARM}-perm2-2-after`));
step('after', { pending: out.facts.pendingAfter, ...out.facts.after });

await page.waitForTimeout(10000);
out.facts.settled = await uiFacts();
out.facts.pendingSettled = await deep();
out.shots.push(await U.shot(page, `${O.ARM}-perm2-3-settled`, { fullPage: true }));
step('settled', { pending: out.facts.pendingSettled, allowButtons: out.facts.settled.allowButtons, approvalWordsInSidebar: out.facts.settled.approvalWordsInSidebar });

out.resolutions = resolutions;
ac.abort();
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({ arm: O.ARM, pendingBefore: out.facts.pendingBefore, pendingAfter: out.facts.pendingAfter, pendingSettled: out.facts.pendingSettled, sidebarApprovalBadgeAtEnd: out.facts.settled.approvalWordsInSidebar, allowButtonsAtEnd: out.facts.settled.allowButtons }, null, 1));
await browser.close();
process.exit(0);
