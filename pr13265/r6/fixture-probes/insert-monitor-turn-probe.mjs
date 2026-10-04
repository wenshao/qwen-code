// PR #13265 round 6 — appends one probe to a local copy of
// hosted-workspace-tool-turn.test.ts (never committed): the PR's own monitor
// rig, recording the payload the turn hands the Broker for a Monitor call.
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = "  it('settles a proven-unstarted monitor as start_failed', async () => {";
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `  it('R6 probe: the Broker payload of a Monitor call', async () => {
    const { call, parts } = monitorCall();
    const rig = monitorTurnRig(DETACHED);
    turn = rig.turn;
    await rig.turn.execute([call], parts, 'model', new AbortController().signal);
    const payloads = broker.executeV3.mock.calls.map((args: unknown[]) => args.find((a) => typeof a === 'string' && a.startsWith('{')));
    console.log('[R6-MONITOR-PAYLOAD] ' + JSON.stringify(payloads.map((p: string | undefined) => (p ? JSON.parse(p) : null))));
  });

`;
src = src.replace(anchor, () => probe + anchor);
fs.writeFileSync(file, src);
console.log('inserted');
