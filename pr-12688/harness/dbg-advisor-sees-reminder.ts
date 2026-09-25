import { STREAM_ARGS, baseSettings, fakeToolCall, isAdvisorReq, prepareDirs, requestText, runCli, streamInput, toolResults, withServer, REMINDER_MARK, countOf } from './lib.ts';
await withServer(({ body }) => {
  if (isAdvisorReq(body)) return { content: 'ok advice' };
  if (body['stream'] !== true) return { content: '{}' };
  const t = requestText(body);
  if (!t.includes('CONSULT_NOW')) return { content: 'ack' };
  if (toolResults(body).length > 0) return { content: 'done' };
  return { content: 'consulting', toolCalls: [fakeToolCall('advisor', {}, 'a')] };
}, async (server) => {
  const dirs = prepareDirs('dbg-adv-rem', 'head', { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', tools: { visible: ['advisor'] } }) });
  await runCli('head', dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['turn one', 'turn two', 'CONSULT_NOW three']));
  const adv = server.requests.map((q) => q.body).filter(isAdvisorReq);
  console.log('advisor requests', adv.length, 'reminder copies in advisor input:', adv[0] ? countOf(requestText(adv[0]), REMINDER_MARK) : 'n/a');
});
