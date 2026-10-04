// PR #13265 round 6 — appends one probe to a local copy of
// hosted-workspace-tool-turn.test.ts (never committed): the PR's own
// background-admission rig, run past execute() to finish(). Does the turn
// release its per-turn Runtime Session while the background Shell it just
// started is still running?
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = "it('records a proven-unstarted background refuse as start_failed and lands the unstarted family', async () => {";
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `it('R6 probe: finish() after a background admission', async () => {
  const { call, parts } = backgroundCall();
  const detached: ToolResultEnvelope = {
    executionStatus: 'success',
    responseParts: [{ text: 'Background shell started under unit qwen-bg-rt.' }],
    capture: {
      captureStatus: 'detached',
      captureReason: null,
      manifest: null,
      previewTruncated: false,
      deliveryStatus: 'pending',
    },
  };
  const rig = backgroundTurnRig(detached);
  turn = rig.turn;
  await turn.execute([call], parts, 'model', new AbortController().signal);
  const before = broker.release.mock.calls.length;
  let finished = 'ok';
  try {
    await turn.consumeResults();
    await turn.finish();
  } catch (cause) {
    finished = cause instanceof Error ? \`\${cause.name}: \${cause.message}\` : String(cause);
  }
  console.log('[R6-TURN] ' + JSON.stringify({
    backgroundAdmitted: rig.orchestrator.calls.map(([name]) => name),
    finish: finished,
    releaseCallsAtFinish: broker.release.mock.calls.length - before,
  }));
});

`;
src = src.replace(anchor, () => probe + anchor);
fs.writeFileSync(file, src);
console.log('inserted');
