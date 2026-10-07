// Probe: can a channel delivery go unknown -> partial -> sending with NO new receipt?
import { readFileSync } from 'node:fs';
const root = process.argv[2];
const { MANAGED_EXTENSION_RECORD_BODIES: B } = await import(`${root}/packages/core/dist/src/managed-runtime/managed-extension-projection.js`);
const fx = JSON.parse(readFileSync(`${root}/packages/core/src/managed-runtime/contracts/managed-channel-record-v1.fixtures.json`, 'utf8'));
const T = fx.templates.channel_delivery;
const seg = (i, receipt) => ({ ...structuredClone(T.segments[i]), receipt });
const rc = (id) => ({ providerMessageId: id, acceptedAt: 1760000000000, proofRef: null });
const d = (runState, line, receipts) => ({ ...structuredClone(T),
  segments: [seg(0, receipts[0]), seg(1, receipts[1])],
  run: { ...structuredClone(T.run), state: runState, reason: null, delivery: { target: 'channel', state: line } } });
const chain = [
  ['planned',  d('admitted', 'planned', [null, null])],
  ['sending',  d('running',  'sending', [null, null])],
  ['sending (seg-1 receipted)', d('running', 'sending', [rc('m-1'), null])],
  ['unknown  (seg-2 fate unknown)', d('waiting', 'unknown', [rc('m-1'), null])],
  ['partial  (NO new receipt)', d('running', 'partial', [rc('m-1'), null])],
  ['sending  (seg-2 re-sent)', d('running', 'sending', [rc('m-1'), null])],
  ['delivered (seg-2 twice)', d('settled', 'delivered', [rc('m-1'), rc('m-2-dup')])],
];
const body = B.channel_delivery;
for (let i = 0; i < chain.length; i++) {
  const [label, rec] = chain[i];
  let parse; try { body.parse(rec); parse = 'valid'; } catch (e) { parse = 'REFUSED ' + e.message; }
  const succ = i === 0 ? (body.isStart(rec) ? 'start' : 'NOT start') : (body.isSuccessor(chain[i-1][1], rec) ? 'successor ACCEPTED' : 'successor REFUSED');
  console.log(`${String(i).padStart(2)} ${label.padEnd(32)} parse=${parse.padEnd(6)} ${succ}`);
}
// direct step, which the corpus pins
console.log('direct unknown -> sending:', body.isSuccessor(chain[3][1], chain[5][1]) ? 'ACCEPTED' : 'REFUSED');
console.log(JSON.stringify(chain.map(([l, r]) => r)) );
