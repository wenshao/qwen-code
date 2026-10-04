// S12 (round 7): the order the worker really runs a background start in —
// capture prepare (open manifest → advanceOutput) before the start receipt
// is attached — through the PR's HostedChildRunSession on the real store.
import { BINDING_1, WT, createPublicSession, javaRows, openSession, records, say, openLog } from './lib.mjs';
if (!records.MANAGED_SESSION_ENABLED_DOMAINS.includes('child_run')) records.MANAGED_SESSION_ENABLED_DOMAINS.push('child_run');
openLog('s12-output-before-attach');
const { HostedChildRunSession } = await import(`${WT}/packages/cli/dist/src/serve/hosted-child-run-session.js`);
const pub = await createPublicSession();
const { session, sessionKey } = await openSession({ sessionId: pub.id, writerId: 'writer-s12', create: true });
const shells = new HostedChildRunSession({ authority: session.authority, resources: session.resources }, sessionKey);
const m1 = await session.resources.publish('managed-tool-result-manifest', Buffer.from(JSON.stringify({ revision: 1, captureId: 'cap-s12' })));
const step = async (label, fn) => { try { await fn(); return `${label}: ok`; } catch (e) { return `${label}: REFUSED ${e.message.slice(0, 80)}`; } };
const out = [];
out.push(await step('admit', () => shells.admit({ shellId: 's-1', ownerScopeId: 'scope', executionCallId: 'call-s1', args: { command: 'yes', is_background: true } })));
out.push(await step('dispatchStarted', () => shells.dispatchStarted('s-1', BINDING_1)));
out.push(await step('advanceOutput(open manifest) before attach', () => shells.advanceOutput('s-1', m1)));
out.push(await step('attach', () => shells.attach('s-1', BINDING_1, { unit: 'qwen-bg-call-s1' })));
out.push(await step('advanceOutput(open manifest) after attach', () => shells.advanceOutput('s-1', m1)));
const row = javaRows(pub.id).find((r) => r[0] === 's-1');
say('RESULT', { steps: out, javaRow: row ? `rev${row[2]} ${row[4]}/${row[5]}` : 'NO ROW' });
await session.close();
process.exit(0);
