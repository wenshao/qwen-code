// T5 (round 2): the Advisor budget resets on /clear (new session) and the
// reset is shared with a subagent launched afterwards. Real Ink TUI.
//   phase A: cap 1 -> consult (ok), consult (refused)
//   /clear
//   phase B: subagent consults (must be allowed: fresh budget), then the
//            parent consults (must be refused: the child used the shared slot)
import { mkdirSync } from 'node:fs';
import { TerminalCapture } from '/root/verify/pr12688/head/integration-tests/terminal-capture/terminal-capture.ts';
import {
  ARMS, baseSettings, cliEnv, contentText, fakeToolCall, isAdvisorReq, messages, prepareDirs,
  requestText, startFakeOpenAIServer, toolResults, type J,
} from './lib.ts';

const OUT = '/root/verify/pr12688/shots';
mkdirSync(OUT, { recursive: true });
const LABEL: Record<string, string> = { head: '5d59f93 (PR head, round 2)', fix: '3b49c69 + F1 patch (old reset)' };
const CONSULTANT = '---\nname: consultant\ndescription: Independent reasoning consultant\ntools: advisor\n---\nCONSULTANT_SYSTEM: examine the task independently.';
const isChild = (b: J) => messages(b).some((m) => m['role'] === 'system' && contentText(m['content']).includes('CONSULTANT_SYSTEM'));

for (const arm of (process.env.ARMS ?? 'fix,head').split(',')) {
  const server = await startFakeOpenAIServer(({ body }) => {
    if (isAdvisorReq(body)) return { content: 'ADVICE: fine.' };
    if (body['stream'] !== true) return { content: '{}' };
    const text = requestText(body);
    const n = toolResults(body).length;
    if (isChild(body)) return n > 0 ? { content: 'CHILD_DONE' } : { content: 'child consulting', toolCalls: [fakeToolCall('advisor', {}, 'c1')] };
    if (text.includes('PHASE_B')) {
      if (n === 0) return { content: 'Delegating to a consultant.', toolCalls: [fakeToolCall('agent', { subagent_type: 'consultant', run_in_background: false, description: 'check', prompt: 'CHILD_TASK' }, 'launch')] };
      if (n === 1) return { content: 'Parent consulting after the child.', toolCalls: [fakeToolCall('advisor', {}, 'b2')] };
      return { content: 'PHASE B finished.' };
    }
    if (text.includes('PHASE_A')) {
      if (n < 2) return { content: `Phase A consult #${n + 1}.`, toolCalls: [fakeToolCall('advisor', {}, `a${n}`)] };
      return { content: 'PHASE A finished.' };
    }
    return { content: 'ok' };
  });
  const dirs = prepareDirs('t5-clear', arm, {
    userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: 1, tools: { visible: ['advisor'] } }),
    agents: { consultant: CONSULTANT },
  });
  const env = { ...cliEnv(dirs.home, server.baseUrl), FORCE_COLOR: '1', TERM: 'xterm-256color', NODE_NO_WARNINGS: '1' };
  const t = await TerminalCapture.create({ cols: 112, rows: 40, cwd: dirs.ws, env, theme: 'github-dark' as never, chrome: true, title: `${LABEL[arm]} — advisorMaxUses: 1, /clear between phases`, outputDir: OUT, fontSize: 13 });
  const adv = () => server.requests.filter((q) => isAdvisorReq(q.body)).length;
  const send = async (s: string) => { await t.type(s); await t.idle(400, 4000); await t.type('\r'); };
  try {
    await t.spawn('node', [ARMS[arm]!, '--no-chat-recording', '--yolo', '--auth-type', 'openai', '--model', 'executor-model', '--advisor', 'advisor-model']);
    await t.waitFor('Type your message', { timeout: 40000 });
    await send('PHASE_A: consult twice.');
    await t.waitFor('PHASE A finished', { timeout: 30000 });
    await t.idle(600, 6000);
    const afterA = adv();
    await send('/clear');
    await t.idle(1500, 8000);
    await send('PHASE_B: delegate, then consult.');
    await t.waitFor('PHASE B finished', { timeout: 40000 });
    await t.idle(800, 8000);
    await t.capture(`t5-clear-${arm}.png`);
    const bodies = server.requests.map((q) => q.body);
    const lastParent = bodies.filter((b) => b['stream'] === true && b['model'] === 'executor-model' && !isChild(b) && requestText(b).includes('PHASE_B')).at(-1)!;
    const lastChild = bodies.filter((b) => b['stream'] === true && isChild(b)).at(-1);
    console.log(JSON.stringify({
      arm, advisorRequestsAfterPhaseA: afterA, advisorRequestsTotal: adv(),
      childResult: lastChild ? toolResults(lastChild).at(-1)?.slice(0, 60) : null,
      parentPhaseBResult: toolResults(lastParent).at(-1)?.slice(0, 60),
    }));
  } finally {
    await t.close();
    await server.close();
  }
}
