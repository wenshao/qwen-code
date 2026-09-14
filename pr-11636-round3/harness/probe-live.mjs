// R4-6/R4-7/R4-8: the shipped qwen-live QwenCodeAdaptor driven against a REAL
// `qwen serve` daemon (its own DaemonClient, its own SSE stream). The
// orchestrator above it is replaced by this recorder; everything below is
// production code.
import * as O from './obs.mjs';
import fs from 'node:fs';

const WT = O.ARM === 'pre'
  ? '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wtPRE'
  : '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wtHEAD';
const { QwenCodeAdaptor } = await import(`${WT}/packages/qwen-live/dist/adaptor/qwen-code-adaptor.js`);

const label = `${O.ARM}-live`;
const out = { arm: O.ARM, label, events: [], busy: [], steps: [] };
const step = (m, x) => { out.steps.push({ t: O.rel(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 300) : ''); };

await O.mockRun(label);
const adaptor = new QwenCodeAdaptor({ baseUrl: O.BASE, token: O.TOKEN, defaultCwd: O.cfg.ws });
await adaptor.preflight();
step('preflight ok');
const handle = await adaptor.createSession({ cwd: O.cfg.ws, label: 'live probe' });
out.sid = handle.id;
step('adaptor session', { id: handle.id });

const ac = new AbortController();
(async () => {
  for await (const ev of adaptor.events(handle, { signal: ac.signal })) {
    out.events.push({ t: O.rel(), type: ev.type, jobRef: ev.jobRef, summary: (ev.summary ?? ev.text ?? ev.detail ?? '').toString().slice(0, 70) });
  }
})().catch((e) => step('events ended', { e: String(e).slice(0, 120) }));

// Watch the daemon for the background turn id it admits.
let backgroundTurnId;
const watch = setInterval(async () => {
  const st = (await O.api(`/session/${handle.id}/status`)).json;
  if (st?.backgroundTurn?.turnId && !backgroundTurnId) {
    backgroundTurnId = st.backgroundTurn.turnId;
    step('daemon admitted a background turn', { turnId: backgroundTurnId.slice(-14) });
  }
  out.busy.push({ t: O.rel(), isBusy: adaptor.isBusy(handle), hasActivePrompt: st?.hasActivePrompt, bg: !!st?.backgroundTurn });
}, 400);

const r = await adaptor.prompt(handle, [{ type: 'text', text: '[[S:idle]] launch a background probe' }]);
step('prompt accepted', r);

await O.sleep(24000);
clearInterval(watch);
ac.abort();
out.backgroundTurnId = backgroundTurnId;
const bgStamped = out.events.filter((e) => e.jobRef && backgroundTurnId && e.jobRef === backgroundTurnId);
out.eventsStampedWithBackgroundTurnId = bgStamped;
out.finalIsBusy = adaptor.isBusy(handle);
out.busyTail = out.busy.slice(-6);
O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({
  arm: O.ARM,
  backgroundTurnId: backgroundTurnId ? '…' + backgroundTurnId.slice(-14) : null,
  totalEvents: out.events.length,
  eventsStampedWithUnownedBackgroundJobRef: bgStamped.length,
  stampedTypes: [...new Set(bgStamped.map((e) => e.type))],
  finalIsBusy: out.finalIsBusy,
}, null, 1));
console.log('--- event trace ---');
for (const e of out.events) console.log(` ${e.t}s ${e.type}${e.jobRef ? ' jobRef=' + (e.jobRef === backgroundTurnId ? 'BACKGROUND-TURN' : e.jobRef.slice(0, 8)) : ' (no jobRef)'} ${e.summary}`);
process.exit(0);
