// S1c: one Turn, same live owners; the coordinator's SSE stream to the Harness is cut once while
// the model is mid-answer. The coordinator has to re-enter the Turn and finish consuming it.
// usage: tsx s1c-stream-gap.ts <label>
import { createRig, freePort, ms, sleep } from './stack.js';

const label = process.argv[2] ?? 's1c';
const waitMs = Number(process.env['RIG_WAIT_MS'] ?? 75_000);
const rig = await createRig({ label, workspace: false });
let failure: unknown;
try {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await rig.startModel(() => ({
    contentChunks: ['GAP_PART_ONE ', 'GAP_PART_TWO'],
    holdAfterChunks: 1,
    holdUntil: hold,
  }));
  const harnessPort = await freePort();
  const tap = await rig.tap('coordinator->harness', `http://127.0.0.1:${harnessPort}`);
  const spring = await rig.startSpring('A', { harnessUrl: tap.baseUrl });
  await rig.startHarness('A', { port: harnessPort });
  const started = ms();
  const session = await rig.createSession(spring.url, 'S1C. Reply exactly GAP_PART_ONE GAP_PART_TWO.');
  // A no-tool Hosted Turn publishes its text only when the model round ends, so the boundary is
  // "model request in flight and the coordinator's event stream open".
  await rig.until(
    'model request in flight with the event stream open',
    () => rig.modelRequests().length >= 1 && tap.log.some((e) => e.line.includes('(sse open)')),
    30_000,
  );
  await sleep(500);
  const cutAt = ms();
  const cut = tap.cutStreams();
  await sleep(300);
  release();
  const terminal = await rig.waitTerminal(spring.url, session.id, 0, waitMs);
  const events = await rig.events(spring.url, session.id, 0);
  const result = {
    label,
    platform: process.platform,
    db: rig.dbVersion,
    streamsCut: cut,
    terminal: terminal?.type ?? `NONE within ${waitMs} ms of the cut`,
    terminalData: terminal?.data,
    msFromCutToTerminal: terminal ? ms() - cutAt : null,
    totalMs: ms() - started,
    publicText: events
      .filter((e) => e.type === 'item.output_text.delta')
      .map((e) => String(e.data?.['text'] ?? ''))
      .join(''),
    'turnRow(status,error_code,retry_count,submission_attempted)': rig
      .sql(
        `SELECT status, IFNULL(error_code,'-'), retry_count, submission_attempted FROM qwen_managed_agent.managed_agent_turn`,
      )
      .split('\t'),
    sessionStatus: rig.sql(`SELECT status FROM qwen_managed_agent.managed_agent_session`),
    harnessCalls: tap.log
      .filter((e) => !/heartbeat/.test(e.line))
      .map((e) => `${e.t}ms ${e.line.replace('[coordinator->harness] ', '').slice(0, 170)}`),
  };
  rig.save('result.json', result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await rig.cleanup();
}
if (failure) process.exit(1);
