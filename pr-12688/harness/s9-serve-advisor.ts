// S9: Advisor through the `qwen serve` daemon (Web Shell backend): the
// session is not a subagent, so the consultation must use the session chat
// (not fail closed) and the cap must hold across two prompts.
import { spawn } from 'node:child_process';
import {
  ARMS, baseSettings, cliEnv, fakeToolCall, isAdvisorReq, prepareDirs, requestText,
  toolResults, withServer,
} from './lib.ts';

const arms = (process.env.ARMS ?? 'base,head').split(',');
const TWO = process.env.TWO === '1';
for (const arm of arms) {
  await withServer(({ body }) => {
    if (isAdvisorReq(body)) {
      const tools = (body['tools'] as unknown[] | undefined) ?? [];
      if (tools.length) return { toolCalls: [fakeToolCall(((tools[0] as any).function.name), { verdict: 'ok', risks: 'none', missingEvidence: 'none', recommendation: 'go' })] };
      return { content: 'DAEMON_ADVICE: go ahead.' };
    }
    if (body['stream'] !== true) return { content: '{}' };
    const results = toolResults(body);
    const text = requestText(body);
    const prompts = (text.match(/DAEMON_PROMPT_\d/g) ?? []).length;
    if (results.length >= prompts) return { content: `DONE_${prompts}` };
    return { content: 'consulting', toolCalls: [fakeToolCall('advisor', {}, `d${prompts}`)] };
  }, async (server) => {
    const dirs = prepareDirs('s9-serve-adv', arm, { userSettings: baseSettings(server.baseUrl, { advisorModel: 'advisor-model', advisorMaxUses: 1, tools: { visible: ['advisor'] } }) });
    const child = spawn('node', [ARMS[arm]!, 'serve', '--port', '0', '--token', 'T', '--workspace', dirs.ws], { cwd: dirs.ws, env: cliEnv(dirs.home, server.baseUrl), stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const t0 = Date.now();
    let port: string | undefined;
    while (Date.now() - t0 < 30000 && !port) {
      port = out.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1];
      await new Promise((r) => setTimeout(r, 200));
    }
    const H = { authorization: 'Bearer T', 'content-type': 'application/json' };
    const mk = async () => (await (await fetch(`http://127.0.0.1:${port}/session`, { method: 'POST', headers: H, body: JSON.stringify({ cwd: dirs.ws, ...(TWO ? { sessionScope: 'thread' } : {}) }) })).json()) as { sessionId: string };
    const sA = await mk();
    let s = sA;
    const outcome: string[] = [];
    for (const n of [1, 2]) {
      if (TWO && n === 2) { s = await mk(); outcome.push(`second session ${s.sessionId === sA.sessionId ? 'SAME' : 'new'} id`); }
      const r = await fetch(`http://127.0.0.1:${port}/session/${s.sessionId}/prompt`, { method: 'POST', headers: H, body: JSON.stringify({ prompt: [{ type: 'text', text: `DAEMON_PROMPT_${n}: consult then finish.` }] }) });
      const t1 = Date.now();
      // wait until the executor has answered this prompt
      while (Date.now() - t1 < 30000) {
        const last = server.requests.map((q) => q.body).filter((b) => b['stream'] === true && b['model'] === 'executor-model').at(-1);
        if (last && toolResults(last).length >= n) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 500));
      const last = server.requests.map((q) => q.body).filter((b) => b['stream'] === true && b['model'] === 'executor-model').at(-1)!;
      outcome.push(`prompt${n}: HTTP ${r.status}, tool result = ${JSON.stringify(toolResults(last).at(-1)?.slice(0, 70))}`);
    }
    const adv = server.requests.map((q) => q.body).filter(isAdvisorReq);
    console.log(`${arm}: advisor requests=${adv.length}; advisor saw prompt1=${adv[0] ? requestText(adv[0]).includes('DAEMON_PROMPT_1') : 'n/a'}\n  ${outcome.join('\n  ')}`);
    child.kill('SIGTERM');
  });
}
