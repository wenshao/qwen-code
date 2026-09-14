// R6-5: a qwen-live client ATTACHES while only an automatic (background)
// execution is active, then hands off a steer.
// Real daemon + the shipped QwenCodeAdaptor. Adaptor A starts the work and is
// then dropped; adaptor B is a fresh instance with no prior session state —
// everything it knows comes from the create/attach snapshot.
import * as O from './obs.mjs';
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', String(e && e.message || e).slice(0,400)); process.exit(9); });
process.on('unhandledRejection', (e) => { console.log('UNHANDLED:', String(e && e.message || e).slice(0,400)); process.exit(9); });

const WT = O.ARM === 'pre'
  ? '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4pre'
  : '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wt4';
const { QwenCodeAdaptor } = await import(`${WT}/packages/qwen-live/dist/adaptor/qwen-code-adaptor.js`);
const { DaemonClient } = await import(`${WT}/packages/sdk-typescript/dist/daemon/index.js`);

const label = `${O.ARM}-attach`;
const out = { arm: O.ARM, label, steps: [] };
const step = (m, x) => { out.steps.push({ t: O.rel(), m, ...(x || {}) }); console.log(`[${label} +${O.rel()}s] ${m}`, x ? JSON.stringify(x).slice(0, 300) : ''); };

await O.mockRun(label);
const clientId = `live-probe-${O.ARM}-${Date.now().toString(36)}`;
const mk = (attachTo) => {
  const opts = { baseUrl: O.BASE, token: O.TOKEN, defaultCwd: O.cfg.ws, clientId };
  if (attachTo) {
    // Real DaemonClient, real HTTP; the only change is that this client
    // attaches to an existing session id (`POST /session` with `sessionId`),
    // which is what a reconnecting qwen-live host does. Everything the
    // adaptor sees — including the snapshot — is the daemon's own response.
    const real = new DaemonClient({ baseUrl: O.BASE, token: O.TOKEN });
    const proxy = new Proxy(real, {
      get(target, prop, recv) {
        if (prop === 'createOrAttachSession') {
          return (req, cid) => {
            const p = target.createOrAttachSession.call(target, { ...req, sessionId: attachTo }, cid);
            return p.then((s) => { out.attachSnapshot = { sessionId: s.sessionId, hasActivePrompt: s.hasActivePrompt, backgroundTurn: s.backgroundTurn?.turnId?.slice(-14) }; return s; });
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    opts.client = proxy;
  }
  return new QwenCodeAdaptor(opts);
};

const a = mk();
await a.preflight();
const handleA = await a.createSession({ cwd: O.cfg.ws, label: 'attach probe' });
const sid = handleA.id;
out.sid = sid;
step('adaptor A session', { sid });

const acA = new AbortController();
(async () => { for await (const _ of a.events(handleA, { signal: acA.signal })) { /* drain */ } })().catch(() => {});

await a.prompt(handleA, [{ type: 'text', text: '[[S:slowbg]] launch a slow background probe' }]);
step('adaptor A prompt sent');

// Wait until the daemon reports an ADMITTED background turn and no foreground prompt.
let snapshot;
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const st = (await O.api(`/session/${sid}/status`)).json;
  if (st?.backgroundTurn?.turnId) { snapshot = st; break; }
  await O.sleep(300);
}
out.daemonSnapshot = snapshot ? { hasActivePrompt: snapshot.hasActivePrompt, backgroundTurn: snapshot.backgroundTurn?.turnId?.slice(-14) } : null;
step('daemon: automatic execution active', out.daemonSnapshot);
if (!snapshot) { console.log('NO BACKGROUND TURN — abort'); process.exit(1); }

// Adaptor A goes away (qwen-live process restarts / the host reconnects).
acA.abort();

const b = mk(sid);
await b.preflight();
const handleB = await b.createSession({ cwd: O.cfg.ws });
out.attachedSameSession = handleB.id === sid;
step('adaptor B attach', { id: handleB.id, sameSession: out.attachedSameSession, snapshot: out.attachSnapshot });

// The state adaptor B seeded from the snapshot, before any SSE frame.
out.bIsBusyBeforeEvents = b.isBusy(handleB);
step('B.isBusy() straight after attach', { isBusy: out.bIsBusyBeforeEvents });

const receipt = await b.prompt(handleB, [{ type: 'text', text: 'please also check the linter' }], { steer: true });
out.receipt = receipt;
step('B handoff with steer:true', receipt);

const st2 = (await O.api(`/session/${sid}/status`)).json;
out.statusAfter = { hasActivePrompt: st2?.hasActivePrompt, backgroundTurn: st2?.backgroundTurn?.turnId?.slice(-14), pendingPrompts: st2?.pendingPrompts?.length };
step('daemon status after the handoff', out.statusAfter);

O.save(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${label}.json`, out);
console.log('\n=== VERDICT ===');
console.log(JSON.stringify({
  arm: O.ARM,
  attachedSameSession: out.attachedSameSession,
  isBusyAfterAttach: out.bIsBusyBeforeEvents,
  receiptStatus: receipt.status,
  receiptJobRef: receipt.jobRef ? 'yes' : 'none',
  receiptNote: receipt.note,
  attachSnapshotBackgroundTurn: out.attachSnapshot?.backgroundTurn ?? null,
  attachSnapshotHasActivePrompt: out.attachSnapshot?.hasActivePrompt ?? null,
}, null, 1));
process.exit(0);
