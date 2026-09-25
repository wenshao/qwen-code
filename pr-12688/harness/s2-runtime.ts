// S2..S7: runtime behaviour of the Advisor loop on the real bundled CLI,
// same scripted fake provider on both arms.
import { writeFileSync } from 'node:fs';
import {
  REMINDER_MARK, STREAM_ARGS, baseSettings, contentText, countOf, fakeToolCall,
  isAdvisorReq, isExecutorStream, messages, prepareDirs, requestText, runCli,
  streamInput, toolNames, toolResults, withServer, type J,
} from './lib.ts';

const arms = (process.env.ARMS ?? 'base,head').split(',');
const only = process.env.ONLY?.split(',');
const report: Record<string, unknown> = {};
const lines: string[] = [];
const log = (s: string) => { lines.push(s); console.log(s); };

const CONSULTANT = '---\nname: consultant\ndescription: Independent reasoning consultant\ntools: advisor\n---\nCONSULTANT_SYSTEM: examine the task independently.';
const READER = '---\nname: reader\ndescription: Read-only helper\ntools: read_file\n---\nREADER_SYSTEM: read files only.';
const GENERAL = '---\nname: generalist\ndescription: Helper with default tools\n---\nGENERALIST_SYSTEM: do the task.';

function isChild(body: J, marker: string) {
  return messages(body).some((m) => m['role'] === 'system' && contentText(m['content']).includes(marker));
}
function advisorResultTexts(body: J): string[] {
  return toolResults(body).filter((t) => /advis/i.test(t));
}

async function scenario(name: string, fn: (arm: string) => Promise<J>) {
  if (only && !only.includes(name)) return;
  report[name] = {};
  for (const arm of arms) {
    try {
      (report[name] as J)[arm] = await fn(arm);
    } catch (e) {
      (report[name] as J)[arm] = { error: String(e) };
    }
    log(`[${name}] ${arm}: ${JSON.stringify((report[name] as J)[arm])}`);
  }
}

// S2 — cap 1 shared between executor and a derived subagent.
for (const cap of [1, 2]) {
  await scenario(`s2-shared-cap-${cap}`, async (arm) =>
    withServer(({ body }) => {
      if (isAdvisorReq(body)) return { content: 'ADVICE_TEXT: approach is sound.' };
      if (body['stream'] !== true) return { content: '{}' };
      const text = requestText(body);
      if (isChild(body, 'CONSULTANT_SYSTEM')) {
        if (toolResults(body).length > 0) return { content: 'CHILD_DONE' };
        return { content: 'child consulting', toolCalls: [fakeToolCall('advisor', {}, 'child-adv')] };
      }
      if (text.includes('CHILD_DONE')) return { content: 'PARENT_DONE' };
      if (toolResults(body).length > 0)
        return { content: 'delegating', toolCalls: [fakeToolCall('agent', { subagent_type: 'consultant', run_in_background: false, description: 'check', prompt: 'CHILD_TASK: verify independently.' }, 'launch')] };
      return { content: 'parent consulting', toolCalls: [fakeToolCall('advisor', {}, 'parent-adv')] };
    }, async (server) => {
      const dirs = prepareDirs(`s2-cap${cap}`, arm, {
        userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: cap, tools: { visible: ['advisor'] } }),
        agents: { consultant: CONSULTANT },
      });
      const r = await runCli(arm, dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['PARENT_TASK: consult then delegate.']));
      const bodies = server.requests.map((q) => q.body);
      const adv = bodies.filter(isAdvisorReq);
      const childReqs = bodies.filter((b) => b['stream'] === true && isChild(b, 'CONSULTANT_SYSTEM'));
      const childLast = childReqs.at(-1);
      return {
        exit: r.code,
        parentDone: r.stdout.includes('PARENT_DONE'),
        advisorRequests: adv.length,
        advisorInputs: adv.map((b) => ({ hasParentTask: requestText(b).includes('PARENT_TASK'), hasChildTask: requestText(b).includes('CHILD_TASK'), tools: toolNames(b).length })),
        childToolsHasAdvisor: childReqs[0] ? toolNames(childReqs[0]).includes('advisor') : null,
        childFirstHasReminder: childReqs[0] ? requestText(childReqs[0]).includes(REMINDER_MARK) : null,
        childAdvisorResult: childLast ? toolResults(childLast).map((t) => t.slice(0, 140)) : null,
      };
    }),
  );
}

// S3 — two advisor calls in ONE model response with cap 1.
await scenario('s3-parallel-cap-1', async (arm) =>
  withServer(async ({ body }) => {
    if (isAdvisorReq(body)) { await new Promise((r) => setTimeout(r, 400)); return { content: 'ADVICE_TEXT parallel' }; }
    if (body['stream'] !== true) return { content: '{}' };
    if (toolResults(body).length > 0) return { content: 'EXEC_DONE' };
    return { content: 'two at once', toolCalls: [fakeToolCall('advisor', {}, 'a1'), fakeToolCall('advisor', {}, 'a2')] };
  }, async (server) => {
    const dirs = prepareDirs('s3-par', arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: 1, tools: { visible: ['advisor'] } }) });
    const r = await runCli(arm, dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['go']));
    const bodies = server.requests.map((q) => q.body);
    const last = bodies.filter(isExecutorStream).at(-1)!;
    return { exit: r.code, done: r.stdout.includes('EXEC_DONE'), advisorRequests: bodies.filter(isAdvisorReq).length, results: toolResults(last).map((t) => t.slice(0, 90)) };
  }),
);

// S4 — workspace settings cannot raise/clear the user cap, nor set one.
for (const [label, user, ws] of [
  ['user1-ws0', { advisorMaxUses: 1 }, { advisorMaxUses: 0 }],
  ['user-none-ws1', {}, { advisorMaxUses: 1 }],
] as const) {
  await scenario(`s4-workspace-${label}`, async (arm) =>
    withServer(({ body }) => {
      if (isAdvisorReq(body)) return { content: 'ADVICE_TEXT ok' };
      if (body['stream'] !== true) return { content: '{}' };
      const n = toolResults(body).length;
      if (n >= 2) return { content: 'EXEC_DONE' };
      return { content: `consult #${n + 1}`, toolCalls: [fakeToolCall('advisor', {}, `c${n}`)] };
    }, async (server) => {
      const dirs = prepareDirs(`s4-${label}`, arm, {
        userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', tools: { visible: ['advisor'] }, ...user }),
        workspaceSettings: ws,
      });
      const r = await runCli(arm, dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['consult twice']));
      const bodies = server.requests.map((q) => q.body);
      const last = bodies.filter(isExecutorStream).at(-1)!;
      return { exit: r.code, advisorRequests: bodies.filter(isAdvisorReq).length, results: toolResults(last).map((t) => t.slice(0, 70)), warn: (r.stderr.match(/advisorMaxUses[^\n]{0,80}/) ?? [''])[0] };
    }),
  );
}

// S5 — reminder per user turn: accumulation in history, and gating when
// the tool is denied / disabled / plan mode.
for (const [label, extra, args] of [
  ['default', {}, []],
  ['permissions-deny-advisor', { permissions: { deny: ['advisor'] } }, []],
  ['tools-disabled-advisor', { tools: { disabled: ['advisor'] } }, []],
  ['plan-mode', {}, ['--approval-mode', 'plan']],
] as const) {
  await scenario(`s5-reminder-${label}`, async (arm) =>
    withServer(({ body }) => {
      if (isAdvisorReq(body)) return { content: 'ADVICE_TEXT' };
      if (body['stream'] !== true) return { content: '{}' };
      return { content: 'ack' };
    }, async (server) => {
      const dirs = prepareDirs(`s5-${label}`, arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', ...extra }) });
      const turns = ['turn one', 'turn two', 'turn three', 'turn four', 'turn five', 'turn six'];
      const streamArgs = STREAM_ARGS.filter((a) => !(args.length && a === '--yolo'));
      const r = await runCli(arm, dirs, server.baseUrl, [...streamArgs, ...args, '--advisor', 'advisor-model'], streamInput(turns));
      const ex = server.requests.map((q) => q.body).filter(isExecutorStream);
      const last = ex.at(-1);
      const lastText = last ? requestText(last) : '';
      const reminderBlock = lastText.match(/<system-reminder>\nAdvisor is available[\s\S]*?<\/system-reminder>/)?.[0] ?? '';
      return {
        exit: r.code,
        executorRequests: ex.length,
        remindersInLastRequest: countOf(lastText, REMINDER_MARK),
        reminderChars: reminderBlock.length,
        route: /select:advisor/.test(reminderBlock) ? 'bridge' : /Call advisor with no arguments/.test(reminderBlock) ? 'direct' : 'none',
        declared: last ? { advisor: toolNames(last).includes('advisor'), tool_search: toolNames(last).includes('tool_search'), tool_call: toolNames(last).includes('tool_call') } : null,
        lastRequestChars: JSON.stringify(last?.['messages'] ?? []).length,
      };
    }),
  );
}

// S6 — `/advisor` in non-interactive mode after one use.
await scenario('s6-noninteractive-status', async (arm) =>
  withServer(({ body }) => (body['stream'] === true ? { content: 'unused' } : { content: '{}' }), async (server) => {
    const dirs = prepareDirs('s6', arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: 3 }) });
    const r = await runCli(arm, dirs, server.baseUrl, ['--yolo', '--auth-type', 'openai', '--model', 'executor-model', '--advisor', 'advisor-model', '--prompt', '/advisor']);
    return { exit: r.code, stdout: r.stdout.trim().slice(0, 400), stderr: r.stderr.trim().split('\n').slice(0, 3).join(' | ').slice(0, 300), modelRequests: server.requests.length };
  }),
);

// S7 — subagent tool restrictions gate the reminder and the call.
for (const [label, def, marker] of [
  ['reader-no-advisor', READER, 'READER_SYSTEM'],
  ['generalist-default-tools', GENERAL, 'GENERALIST_SYSTEM'],
] as const) {
  await scenario(`s7-subagent-${label}`, async (arm) =>
    withServer(({ body }) => {
      if (isAdvisorReq(body)) return { content: 'ADVICE_TEXT child' };
      if (body['stream'] !== true) return { content: '{}' };
      if (isChild(body, marker)) {
        if (toolResults(body).length > 0) return { content: 'CHILD_DONE' };
        return { content: 'child tries advisor', toolCalls: [fakeToolCall('advisor', {}, 'child-adv')] };
      }
      if (requestText(body).includes('CHILD_DONE')) return { content: 'PARENT_DONE' };
      return { content: 'delegate', toolCalls: [fakeToolCall('agent', { subagent_type: label.split('-')[0], run_in_background: false, description: 'x', prompt: 'CHILD_TASK' }, 'launch')] };
    }, async (server) => {
      const dirs = prepareDirs(`s7-${label}`, arm, {
        userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model' }),
        agents: { [label.split('-')[0]]: def },
      });
      const r = await runCli(arm, dirs, server.baseUrl, [...STREAM_ARGS, '--advisor', 'advisor-model'], streamInput(['delegate']));
      const bodies = server.requests.map((q) => q.body);
      const child = bodies.filter((b) => b['stream'] === true && isChild(b, marker));
      return {
        exit: r.code,
        parentDone: r.stdout.includes('PARENT_DONE'),
        advisorRequests: bodies.filter(isAdvisorReq).length,
        childDeclaresAdvisor: child[0] ? toolNames(child[0]).includes('advisor') : null,
        childBridge: child[0] ? toolNames(child[0]).includes('tool_call') : null,
        childFirstHasReminder: child[0] ? requestText(child[0]).includes(REMINDER_MARK) : null,
        childResult: child.at(-1) ? toolResults(child.at(-1)!).map((t) => t.slice(0, 120)) : null,
      };
    }),
  );
}

writeFileSync(`/root/verify/pr12688/runs/s2-runtime-${arms.join('_')}${only ? '-' + only.join('_') : ''}.json`, JSON.stringify(report, null, 2));
