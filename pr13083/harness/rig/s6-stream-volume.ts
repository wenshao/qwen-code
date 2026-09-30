// S6: cost of durable per-chunk text deltas. One Turn whose model answer arrives as N small chunks,
// on an unbound Session (text is published once, at the end of the round) and on a Workspace-bound
// Session (every chunk commits a message.delta journal event).
// usage: tsx s6-stream-volume.ts <label> <chunks,chunks,...>
import { createRig, freePort, ms } from './stack.js';

const label = process.argv[2] ?? 's6';
const sizes = (process.argv[3] ?? '200,1000').split(',').map(Number);
const rig = await createRig({ label, workspace: true, durable: process.platform === 'linux' });
let failure: unknown;
try {
  await rig.startModel(({ body }) => {
    const match = /S6_CHUNKS_(\d+)/.exec(JSON.stringify(body['messages']));
    const n = Number(match?.[1] ?? 1);
    return { contentChunks: Array.from({ length: n }, (_, i) => `w${i} `) };
  });
  const harnessPort = await freePort();
  const spring = await rig.startSpring('A', { harnessUrl: `http://127.0.0.1:${harnessPort}` });
  await rig.startHarness('A', { port: harnessPort, brokerUrl: `http://127.0.0.1:${spring.brokerPort}` });
  const rows: Record<string, unknown>[] = [];
  // Warm the JVM, the Harness model client and the Runtime once so the first sample is not a cold start.
  for (const bound of [false, true]) {
    const warm = await rig.createSession(spring.url, 'S6_CHUNKS_3 warm-up', bound);
    await rig.waitTerminal(spring.url, warm.id, 0, 120_000);
  }
  for (const n of sizes) {
    for (const bound of [false, true]) {
      const started = ms();
      const session = await rig.createSession(spring.url, `S6_CHUNKS_${n} reply`, bound);
      let firstTextAt: number | null = null;
      let terminal = null;
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline && !terminal) {
        const events = await rig.events(spring.url, session.id, 0);
        if (firstTextAt === null && events.some((e) => e.type === 'item.output_text.delta'))
          firstTextAt = ms() - started;
        terminal = events.find((e) => e.terminal) ?? null;
        if (!terminal) await new Promise((r) => setTimeout(r, 25));
      }
      const total = ms() - started;
      const events = await rig.events(spring.url, session.id, 0);
      const text = events
        .filter((e) => e.type === 'item.output_text.delta')
        .map((e) => String(e.data?.['text'] ?? ''))
        .join('');
      const filter = rig.sessionFilter(session.id);
      rows.push({
        session: bound ? 'workspace-bound (durable deltas)' : 'unbound (no deltas)',
        modelChunks: n,
        terminal: terminal?.type ?? 'NONE within 300 s',
        firstPublicTextMs: firstTextAt,
        totalMs: total,
        journalTransactions: Number(
          rig.sql(`SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${filter}`),
        ),
        journalBytes: Number(
          rig.sql(
            `SELECT IFNULL(SUM(LENGTH(record_bytes)),0) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${filter}`,
          ),
        ),
        publicDeltaEvents: events.filter((e) => e.type === 'item.output_text.delta').length,
        textComplete: text === Array.from({ length: n }, (_, i) => `w${i} `).join(''),
      });
    }
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
