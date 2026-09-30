// S1: two consecutive Turns of one Session on the SAME live owners (no crash, no failover).
// usage: tsx s1-two-turn.ts <label> [unbound|workspace]
import { createRig, ms } from './stack.js';

const label = process.argv[2] ?? 's1';
const bound = process.argv[3] === 'workspace';
const waitMs = Number(process.env['RIG_WAIT_MS'] ?? 90_000);
const rig = await createRig({ label, workspace: bound, durable: bound && process.platform === 'linux' });
let failure: unknown;
try {
  await rig.startModel(({ body }) => {
    const text = JSON.stringify(body['messages']);
    if (text.includes('S1_TURN_THREE')) return { content: 'TURN_THREE_OK' };
    if (text.includes('S1_TURN_TWO')) return { content: 'TURN_TWO_OK' };
    return { content: 'TURN_ONE_OK' };
  });
  // Spring is told the Harness port up front; the tap records every coordinator -> Harness call.
  const harnessPort = await (await import('./stack.js')).freePort();
  const tap = await rig.tap('coordinator->harness', `http://127.0.0.1:${harnessPort}`);
  const spring = await rig.startSpring('A', { harnessUrl: tap.baseUrl });
  const harness = await rig.startHarness(
    'A',
    bound
      ? { port: harnessPort, brokerUrl: `http://127.0.0.1:${spring.brokerPort}` }
      : { port: harnessPort },
  );
  void harness;
  const turnRows = () =>
    rig
      .sql(
        `SELECT turn_id, status, IFNULL(error_code,'-'), retry_count, submission_attempted FROM qwen_managed_agent.managed_agent_turn ORDER BY created_at, turn_id`,
      )
      .split('\n')
      .map((row) => row.split('\t'));

  const result: Record<string, unknown> = {
    label,
    platform: process.platform,
    db: rig.dbVersion,
    sessionKind: bound ? 'workspace-bound (hosted-workspace-files/1)' : 'unbound (no tools)',
  };
  const started1 = ms();
  const session = await rig.createSession(spring.url, 'S1_TURN_ONE. Reply exactly TURN_ONE_OK.');
  const t1 = await rig.waitTerminal(spring.url, session.id, 0, waitMs);
  result['turn1'] = { terminal: t1?.type ?? 'NONE', ms: ms() - started1 };
  const after1 = t1?.sequence ?? 0;

  const started2 = ms();
  const posted = await rig.postMessage(spring.url, session.id, 'S1_TURN_TWO. Reply exactly TURN_TWO_OK.');
  const t2 = await rig.waitTerminal(spring.url, session.id, after1, waitMs);
  result['turn2'] = {
    postStatus: posted.status,
    terminal: t2?.type ?? `NONE after ${waitMs} ms`,
    terminalData: t2?.data,
    ms: ms() - started2,
  };
  if (t2?.type === 'turn.completed') {
    const started3 = ms();
    await rig.postMessage(spring.url, session.id, 'S1_TURN_THREE. Reply exactly TURN_THREE_OK.');
    const t3 = await rig.waitTerminal(spring.url, session.id, t2.sequence, waitMs);
    result['turn3'] = { terminal: t3?.type ?? `NONE after ${waitMs} ms`, ms: ms() - started3 };
  }
  result['turnRows(turn_id,status,error_code,retry_count,submission_attempted)'] = turnRows();
  result['modelRequests'] = rig.modelRequests().length;
  const loads = tap.log.filter((entry) => /POST \/session(\/[^ ]*\/load)? /.test(entry.line));
  result['coordinatorToHarness(load/create)'] = loads.map((e) => `${e.t}ms ${e.line.slice(0, 260)}`);
  const events = await rig.events(spring.url, session.id, 0);
  result['publicText'] = events
    .filter((e) => e.type === 'item.output_text.delta')
    .map((e) => String(e.data?.['text'] ?? ''))
    .join('|');
  rig.save('tap.json', tap.log);
  rig.save('result.json', result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await rig.cleanup();
}
if (failure) process.exit(1);
