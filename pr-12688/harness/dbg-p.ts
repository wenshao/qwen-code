import { baseSettings, isExecutorStream, prepareDirs, requestText, runCli, toolNames, withServer, REMINDER_MARK, countOf } from './lib.ts';
for (const arm of ['base', 'head']) {
  await withServer(({ body }) => (body['stream'] === true ? { content: 'ack' } : { content: '{}' }), async (server) => {
    const dirs = prepareDirs('dbg-p', arm, { userSettings: baseSettings(server.baseUrl, {}) });
    await runCli(arm, dirs, server.baseUrl, ['--yolo', '--auth-type', 'openai', '--model', 'executor-model', '--advisor', 'advisor-model', '-o', 'stream-json', '-p', 'Make the tests pass.']);
    const ex = server.requests.map((q) => q.body).filter(isExecutorStream)[0]!;
    const sysText = JSON.stringify((ex['messages'] as any[]).find((m) => m.role === 'system')?.content ?? '');
    console.log(arm, 'reminders in first request:', countOf(requestText(ex), REMINDER_MARK), 'advisor declared:', toolNames(ex).includes('advisor'), 'bridge:', toolNames(ex).includes('tool_search'), 'system prompt mentions advisor:', /advisor/i.test(sysText));
  });
}
