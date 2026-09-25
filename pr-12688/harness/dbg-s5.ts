import { STREAM_ARGS, baseSettings, isExecutorStream, prepareDirs, requestText, runCli, streamInput, toolNames, withServer, messages, REMINDER_MARK, countOf } from './lib.ts';
const arm = process.env.ARM ?? 'head';
await withServer(({ body }) => (body['stream'] === true ? { content: 'ack' } : { content: '{}' }), async (server) => {
  const dirs = prepareDirs('dbg-s5', arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model' }) });
  await runCli(arm, dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['turn one', 'turn two', 'turn three']));
  for (const [i, q] of server.requests.entries()) {
    const b = q.body;
    const sys = messages(b).find((m) => m['role'] === 'system');
    console.log(i, b['model'], 'stream=', b['stream'], 'tools=', toolNames(b).length, toolNames(b).filter((n) => /tool_|advisor/.test(n)).join(','), 'msgs=', messages(b).length, 'rem=', countOf(requestText(b), REMINDER_MARK), 'sys=', JSON.stringify(sys?.['content'] ?? '').slice(0, 80));
  }
});
