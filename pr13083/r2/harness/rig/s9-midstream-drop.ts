// S9: the provider drops the stream after the first content chunk; the retry would answer in full.
// Unbound Session (text published at round end) vs Workspace-bound Session (durable deltas).
// usage: tsx s9-midstream-drop.ts <label>
import { createRig, freePort, ms } from './stack.js';

const label = process.argv[2] ?? 's9';
const rig = await createRig({ label, workspace: true, durable: process.platform === 'linux' });
let failure: unknown;
try {
  const attempts = new Map<string, number>();
  await rig.startModel(({ body }) => {
    const text = JSON.stringify(body['messages']);
    const key = (/S9_[A-Z]+/.exec(text) ?? ['S9'])[0];
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    if (n === 1) return { contentChunks: ['FIRST_ATTEMPT_PART ', 'never sent'], disconnectAfterContentChunks: 1 };
    return { content: 'SECOND_ATTEMPT_FULL_ANSWER' };
  });
  const harnessPort = await freePort();
  const spring = await rig.startSpring('A', { harnessUrl: `http://127.0.0.1:${harnessPort}` });
  await rig.startHarness('A', { port: harnessPort, brokerUrl: `http://127.0.0.1:${spring.brokerPort}` });
  const rows: Record<string, unknown>[] = [];
  for (const [key, bound] of [
    ['S9_UNBOUND', false],
    ['S9_BOUND', true],
  ] as const) {
    const started = ms();
    const session = await rig.createSession(spring.url, `${key}. Reply.`, bound);
    const terminal = await rig.waitTerminal(spring.url, session.id, 0, 90_000);
    const events = await rig.events(spring.url, session.id, 0);
    rows.push({
      session: bound ? 'workspace-bound (durable deltas)' : 'unbound (no deltas)',
      terminal: terminal?.type ?? 'NONE within 90 s',
      terminalData: terminal?.data,
      ms: ms() - started,
      modelRequests: attempts.get(key) ?? 0,
      publicText: events
        .filter((e) => e.type === 'item.output_text.delta')
        .map((e) => String(e.data?.['text'] ?? ''))
        .join('|'),
      turn: rig
        .sql(`SELECT status, IFNULL(error_code,'-') FROM qwen_managed_agent.managed_agent_turn WHERE ${rig.sessionFilter(session.id)}`)
        .split('\t'),
    });
  }
  const result = { label, platform: `${process.platform} ${process.arch}`, db: rig.dbVersion, rows };
  rig.save('result.json', result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await rig.cleanup();
}
if (failure) process.exit(1);
