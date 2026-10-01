// S8: streamed text that is not a single plain line — newlines, CRLF, tabs, a control character,
// and multi-byte text larger than the 3072-byte delta split with an emoji straddling the split.
// Workspace-bound Session (durable deltas). usage: tsx s8-multiline.ts <label>
import { createRig, freePort, ms } from './stack.js';

const label = process.argv[2] ?? 's8';
const rig = await createRig({ label, workspace: true, durable: process.platform === 'linux' });
let failure: unknown;
try {
  const cases: Record<string, string[]> = {
    S8_NEWLINES: ['line one\nline two\n', '\tindented\r\nCRLF line', '\n\nend'],
    S8_CONTROL: ['bell\u0007 and escape\u001b[0m kept'],
    // 3071 ASCII bytes, then a 4-byte emoji that straddles the 3072-byte split, then CJK.
    S8_SPLIT: ['a'.repeat(3071) + '😀' + '中'.repeat(1500) + 'Z'],
  };
  await rig.startModel(({ body }) => {
    const text = JSON.stringify(body['messages']);
    const key = Object.keys(cases).find((k) => text.includes(k)) ?? 'S8_NEWLINES';
    return { contentChunks: cases[key] };
  });
  const harnessPort = await freePort();
  const spring = await rig.startSpring('A', { harnessUrl: `http://127.0.0.1:${harnessPort}` });
  await rig.startHarness('A', { port: harnessPort, brokerUrl: `http://127.0.0.1:${spring.brokerPort}` });
  const rows: Record<string, unknown>[] = [];
  for (const [key, chunks] of Object.entries(cases)) {
    const expected = chunks.join('');
    const started = ms();
    const session = await rig.createSession(spring.url, `${key}. Reply.`);
    const terminal = await rig.waitTerminal(spring.url, session.id, 0, 60_000);
    const events = await rig.events(spring.url, session.id, 0);
    const deltas = events.filter((e) => e.type === 'item.output_text.delta').map((e) => String(e.data?.['text'] ?? ''));
    const text = deltas.join('');
    rows.push({
      case: key,
      terminal: terminal?.type ?? 'NONE within 60 s',
      terminalCode: (terminal?.data as Record<string, unknown> | undefined)?.['code'],
      ms: ms() - started,
      publicDeltaEvents: deltas.length,
      publicTextBytes: Buffer.byteLength(text),
      expectedBytes: Buffer.byteLength(expected),
      byteExact: text === expected,
      loneSurrogate: /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(deltas.join('\u0001')),
      journalTransactions: Number(
        rig.sql(`SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${rig.sessionFilter(session.id)}`),
      ),
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
