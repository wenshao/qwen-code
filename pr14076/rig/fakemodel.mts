// Scriptable fake OpenAI model for the PR 13550 real-stack rig.
// Parent prompts carry PARENT::<mode>::<id>::<childspec>; the Agent call it
// emits carries CHILD::<childspec>::<id>. Every request is logged with the
// advertised tool names so the declaration set is evidence, not inference.
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
} from '/Users/wenshao/git/pr14076-head/integration-tests/fake-openai-server.ts';

const LOG = process.env.RIG_MODEL_LOG ?? '/Users/wenshao/git/pr14076-rig/runs/model-requests.jsonl';
const holds = new Map<string, { promise: Promise<void>; release: () => void }>();
function hold(id: string) {
  let entry = holds.get(id);
  if (!entry) {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    entry = { promise, release };
    holds.set(id, entry);
  }
  return entry;
}

const NUMS: Record<string, string> = {
  n01: '0.1', n02: '1e-7', n03: '1e21', n04: '123456789012345678901', n05: '-0', n06: '9007199254740993',
  n07: '18446744073709551616', n08: '5e-324', n09: '1.7976931348623157e308', n10: '0.000001', n11: '1.5', n12: '2.2250738585072014e-308',
  n13: '1e-320', n14: '-1e-7', n15: '1E+2', n16: '12345678.875',
};
function wfVariant(spec: string, id: string): { script: string; argsRaw?: string; extra?: string } {
  const meta = (n: string) => `export const meta = { name: "${n}", description: "pr14076 rig ${n}" };\n`;
  if (spec === 'pure') return {
    script: meta('rig-pure') + "phase('sum');\nlog('values=' + JSON.stringify(args.values));\nconst total = args.values.reduce((a, b) => a + b, 0);\nreturn { id: " + JSON.stringify(id) + ", total, echo: args };",
    argsRaw: '{"values":[0.1,0.2,2.5],"tag":"wf-' + id + '"}',
  };
  if (spec === 'agents') return {
    script: meta('rig-agents') + "phase('fan-out');\nconst [a, b] = await parallel([() => agent('CHILD::reply::" + id + "a Reply with one line.'), () => agent('CHILD::reply::" + id + "b Reply with one line.')]);\nphase('join');\nconst c = await agent('CHILD::reply::" + id + "c Reply with one line.');\nreturn { a, b, c };",
  };
  if (spec === 'hold') return {
    script: meta('rig-hold') + "phase('wait');\nconst r = await agent('CHILD::hold::" + id + "h Reply with one line.');\nreturn { r };",
  };
  // PR 14076: does the script keep executing after a cancel? A second agent() call after the held one is
  // the observable: if CHILD::reply::<id>z ever reaches the model, the run kept going.
  if (spec === 'holdafter') return {
    script: meta('rig-holdafter') + "phase('wait');\nconst r = await agent('CHILD::hold::" + id + "h Reply with one line.');\nphase('after');\nlog('after-hold');\nconst s = await agent('CHILD::reply::" + id + "z Reply with one line.');\nreturn { r, s };",
  };
  if (spec === 'parhold') return {
    script: meta('rig-parhold') + "phase('fan');\nconst [a, b] = await parallel([() => agent('CHILD::hold::" + id + "h Reply with one line.'), () => agent('CHILD::hold::" + id + "k Reply with one line.')]);\nphase('after');\nconst s = await agent('CHILD::reply::" + id + "z Reply with one line.');\nreturn { a, b, s };",
  };
  if (spec === 'fail') return { script: meta('rig-fail') + "phase('boom');\nthrow new Error('rig failure " + id + "');" };
  if (spec === 'ndirect') return { script: meta('rig-ndirect') + "return await workflow('host-report');" };
  if (spec === 'nalias') return { script: meta('rig-nalias') + "const w = workflow;\nreturn await w('host-report');" };
  if (spec === 'nthis') return { script: meta('rig-nthis') + "return await globalThis.workflow('host-report');" };
  if (spec === 'nproj') return { script: meta('rig-nproj') + "const w = workflow;\nreturn await w('proj-report');" };
  if (spec === 'nspath') return { script: meta('rig-nspath') + "const w = workflow;\nreturn await w({ scriptPath: '.qwen/workflows/proj-report.js' });" };
  // round 2: more indirection forms, all lexically admitted; the runtime must refuse every one
  if (spec === 'ncall') return { script: meta('rig-ncall') + "return await workflow.call(null, 'host-report');" };
  if (spec === 'napply') return { script: meta('rig-napply') + "return await Reflect.apply(workflow, null, ['host-report']);" };
  if (spec === 'ncomp') return { script: meta('rig-ncomp') + "return await globalThis['work' + 'flow']('host-report');" };
  if (spec === 'narr') return { script: meta('rig-narr') + "return await [workflow][0]('host-report');" };
  if (spec === 'ncomma') return { script: meta('rig-ncomma') + "return await (0, workflow)('host-report');" };
  if (spec === 'nfnarg') return { script: meta('rig-nfnarg') + "const run = (f) => f('host-report');\nreturn await run(workflow);" };
  if (spec === 'ncatch') return { script: meta('rig-ncatch') + "const w = workflow;\ntry { return { ran: await w('host-report') }; } catch (e) { return { caught: String(e && e.message) }; }" };
  if (spec === 'ninpar') return { script: meta('rig-ninpar') + "const w = workflow;\nconst [x] = await parallel([() => w('host-report')]);\nreturn x;" };
  // round 2: script byte bound (> 32 KiB) and args depth bound (64)
  if (spec === 'bigscript') return { script: meta('rig-bigscript') + '// ' + 'p'.repeat(33000) + "\nreturn 1;" };
  // deepN: args = {"d": N nested arrays around 1}; the leaf sits at depth N+1
  const dm = /^deep(\d+)$/.exec(spec);
  if (dm) { const n = Number(dm[1]); return { script: meta('rig-deep') + 'let n = args.d, d = 1; while (Array.isArray(n)) { n = n[0]; d++; } return { leafDepth: d, leaf: n };', argsRaw: '{"d":' + '['.repeat(n) + '1' + ']'.repeat(n) + '}' }; }
  // round 2: a lone surrogate inside the script source (the pin covers the script) and as an args key
  if (spec === 'slit') return { script: meta('rig-slit') + "const s = 'a\ud800b';\nreturn { len: s.length, units: [...Array(s.length).keys()].map((i) => s.charCodeAt(i).toString(16)) };" };
  if (spec === 'skey') return { script: meta('rig-skey') + "return { keys: Object.keys(args).map((k) => [...Array(k.length).keys()].map((i) => k.charCodeAt(i).toString(16)).join('-')) };", argsRaw: '{"k\\ud800":1,"ok":2}' };
  // round 2 (P1 probe): agent() subagents that touch the file system; which directory do they see?
  const ag = /^ag(rdhost|rdmount|pwdls|wrhost|shwr|shcat|rdabs|shetc)$/.exec(spec);
  if (ag) return { script: meta('rig-ag-' + ag[1]) + "const r = await agent('CHILD::" + ag[1] + "::" + id + "s Use the tool.');\nreturn { r };" };
  // round 2: a lone surrogate in the workflow RESULT (child result -> relay -> parent)
  if (spec === 'rlone') return { script: meta('rig-rlone') + "return 'r' + String.fromCharCode(0xd800) + 's';" };
  if (spec === 'rlobj') return { script: meta('rig-rlobj') + "const k = 'k' + String.fromCharCode(0xdc00);\nreturn { [k]: 'v' + String.fromCharCode(0xd800) };" };
  if (spec === 'date') return { script: meta('rig-date') + 'return Date.now();' };
  if (spec === 'syntax') return { script: meta('rig-syntax') + 'return (;' };
  if (spec === 'badkey') return { script: meta('rig-badkey') + 'return 1;', extra: ',"name":"x"' };
  if (spec === 'tamper') return { script: meta('rig-tamper') + "phase('t');\nconst marker = 'PIN-A';\nreturn { marker };" };
  if (spec === 'big') return { script: meta('rig-big') + "return 'z'.repeat(40000);" };
  if (spec in NUMS) return {
    script: meta('rig-num') + "return { v: args.v, s: JSON.stringify(args.v), neg0: Object.is(args.v, -0) };",
    argsRaw: '{"v":' + NUMS[spec] + '}',
  };
  if (spec === 'str') return {
    script: meta('rig-str') + "return { len: args.s.length, codes: [...args.s].map((c) => c.codePointAt(0).toString(16)) };",
    argsRaw: '{"s":"a\\u2028b\\u2029c\\ud800d\\udfffe\\u0000f\\u007fg\\ud83d\\ude00h"}',
  };
  const sx = /^s((?:[0-9a-f]+-?)+)$/.exec(spec);
  if (sx) {
    const units = sx[1].split('-').filter(Boolean).map((h) => '\\u' + h.padStart(4, '0'));
    return {
      script: meta('rig-sx') + "return { len: args.s.length, units: [...Array(args.s.length).keys()].map((i) => args.s.charCodeAt(i).toString(16)) };",
      argsRaw: '{"s":"x' + units.join('') + 'y"}',
    };
  }
  return { script: meta('rig-unknown') + 'return 0;' };
}
type Msg = { role: string; content?: unknown; tool_calls?: unknown };
function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
      .join('');
  return '';
}

const server = await startFakeOpenAIServer(
  async ({ body, requestIndex }): Promise<FakeOpenAIResponse> => {
    const messages = (body['messages'] ?? []) as Msg[];
    const tools = ((body['tools'] ?? []) as Array<{ function: { name: string } }>).map(
      (t) => t.function.name,
    );
    const users = messages.filter((m) => m.role === 'user').map((m) => text(m.content));
    const userText = users.join('\n');
    const last = messages[messages.length - 1];
    const lastUser = users[users.length - 1] ?? '';
    // The newest marker wins, so a later Turn of the same Session can switch mode.
    const parentAll = [...userText.matchAll(/PARENT::([a-z0-9-]+)::([A-Za-z0-9_-]+)::([a-z0-9-]+)/g)];
    const parent = parentAll.length ? parentAll[parentAll.length - 1] : null;
    const child = /CHILD::([a-z0-9-]+)::([A-Za-z0-9_-]+)/.exec(userText);
    let role = 'other';
    let reply: FakeOpenAIResponse = { content: 'UNSCRIPTED' };
    if (parent) {
      const [, mode, id, spec] = parent;
      const calledAgent = messages.some(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === 'agent'),
      );
      const fgArgs = {
        description: `child task ${id}`,
        prompt: `CHILD::${spec}::${id} Compute the answer and reply with one line.`,
        run_in_background: false,
      };
      const bgArgs = { ...fgArgs, run_in_background: true };
      const roundsWith = (name: string) => messages.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
          (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === name),
      ).length;
      if (mode === 'wfmix' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('workflow') === 0) {
        const v = wfVariant('pure', id);
        const wf = { id: `call_${id}_wf`, type: 'function', function: { name: 'workflow', arguments: '{"script":' + JSON.stringify(v.script) + ',"args":' + v.argsRaw + ',"run_in_background":false}' } };
        const shell = fakeToolCall('run_shell_command', { command: `echo mix-${id}` }, `call_${id}_shell`);
        return logAnd({ toolCalls: [shell, wf] }, 'parent-wfmix');
      }
      // PR 14076 rig: a background workflow (held subagent, key <id>h) and a background
      // child agent (held, key <id>a) in one batch, so one Session owns both task kinds.
      if (mode === 'wfagbg' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('workflow') === 0) {
        const v = wfVariant('hold', id);
        const wf = { id: `call_${id}_wf`, type: 'function', function: { name: 'workflow', arguments: '{"script":' + JSON.stringify(v.script) + ',"run_in_background":true}' } };
        const ag = fakeToolCall('agent', { description: `child task ${id}`, prompt: `CHILD::hold::${id}a Reply with one line.`, run_in_background: true }, `call_${id}_agent`);
        return logAnd({ toolCalls: [ag, wf] }, 'parent-wfagbg');
      }
      if (mode === 'wfag' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('workflow') === 0) {
        const v = wfVariant(spec, id);
        const wf = { id: `call_${id}_wf`, type: 'function', function: { name: 'workflow', arguments: '{"script":' + JSON.stringify(v.script) + (v.argsRaw ? ',"args":' + v.argsRaw : '') + ',"run_in_background":false}' } };
        const ag = fakeToolCall('agent', { description: `child task ${id}`, prompt: `CHILD::reply::${id}g Reply with one line.`, run_in_background: false }, `call_${id}_agent`);
        return logAnd({ toolCalls: [ag, wf] }, 'parent-wfag');
      }
      // Round 2: a non-workflow tool call (shell) carrying an extra argument
      // nested spec-deep (deep<N>), to tell a workflow-only gap from a general one.
      if (mode === 'shdeep' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('run_shell_command') === 0) {
        const n = Number(/^deep(\d+)$/.exec(spec)?.[1] ?? '1');
        const raw = '{"command":"echo deep-' + id + '","extra":' + '['.repeat(n) + '1' + ']'.repeat(n) + '}';
        return logAnd({ toolCalls: [{ id: `call_${id}_sh`, type: 'function', function: { name: 'run_shell_command', arguments: raw } }] }, `parent-shdeep-${spec}`);
      }
      // Round 2: read_file keeps every argument in its digested input (file tools spread call.args).
      if (mode === 'rfdeep' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('read_file') === 0) {
        const n = Number(/^deep(\d+)$/.exec(spec)?.[1] ?? '1');
        const raw = '{"file_path":"README.md","extra":' + '['.repeat(n) + '1' + ']'.repeat(n) + '}';
        return logAnd({ toolCalls: [{ id: `call_${id}_rf`, type: 'function', function: { name: 'read_file', arguments: raw } }] }, `parent-rfdeep-${spec}`);
      }
      // PR 13858 rig: the managed Workflow tool. spec selects the script/args
      // variant; raw argument text so number edge cases reach the daemon verbatim.
      if (mode === 'wffg' || mode === 'wfbg') {
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('workflow') === 0) {
          const v = wfVariant(spec, id);
          const bgFlag = mode === 'wfbg';
          const raw = '{"script":' + JSON.stringify(v.script) + (v.argsRaw !== undefined ? ',"args":' + v.argsRaw : '') +
            ',"run_in_background":' + bgFlag + (v.extra ?? '') + '}';
          return logAnd({ toolCalls: [{ id: `call_${id}_wf`, type: 'function', function: { name: 'workflow', arguments: raw } }] }, `parent-${mode}-${spec}`);
        }
      }
      if (mode === 'fgsh') {
        // Round 1: a foreground agent call. Round 2 (after its fold): a
        // shell call. Round 3: final text naming what the model saw.
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0)
          return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-fgsh-agent');
        if (last?.role === 'tool' && roundsWith('run_shell_command') === 0) {
          const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
          return logAnd({ toolCalls: [shell] }, 'parent-fgsh-shell');
        }
      }
      if (mode === 'fgshh') {
        // Round 3 (R2-1): round 1 a foreground agent call; round 2 (after
        // its live fold) is HELD until released, then a shell call.
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0)
          return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-fgshh-agent');
        if (last?.role === 'tool' && roundsWith('run_shell_command') === 0) {
          appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), i: requestIndex, role: 'parent-fgshh-holding', parent: parent?.[0], toolMsgs: messages.filter((m) => m.role === 'tool').map((m) => text(m.content).slice(0, 120)) }) + '\n');
          await hold(`${id}m`).promise;
          const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
          return logAnd({ toolCalls: [shell] }, 'parent-fgshh-shell');
        }
      }
      if (mode === 'fgag') {
        // Round 3 (R2-3): round 1 a foreground agent call (spec); round 2
        // (after its fold) a SECOND foreground agent call; round 3 text.
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0)
          return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-fgag-first');
        if (last?.role === 'tool' && roundsWith('agent') === 1) {
          const second = { ...fgArgs, description: `child two ${id}`, prompt: `CHILD::reply::${id}two Reply with one line.` };
          return logAnd({ toolCalls: [fakeToolCall('agent', second, `call_${id}_agent2`)] }, 'parent-fgag-second');
        }
      }
      if (mode === 'fgfg' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0) {
        // Two foreground children in one batch (A answers, B per spec).
        const a = { ...fgArgs, description: `child A ${id}`, prompt: `CHILD::reply::${id}a Compute the answer and reply with one line.` };
        const b = { ...fgArgs, description: `child B ${id}`, prompt: `CHILD::${spec}::${id}b Reply with one line.` };
        return logAnd({ toolCalls: [fakeToolCall('agent', a, `call_${id}_a`), fakeToolCall('agent', b, `call_${id}_b`)] }, 'parent-fgfg');
      }
      if (mode === 'fgbg' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0) {
        // One agent-only batch: a foreground child that answers, then a
        // background child (the spec) that the bot's R1-24 scenario names.
        const fg = { ...fgArgs, prompt: `CHILD::reply::${id}f Compute the answer and reply with one line.` };
        const bg = { ...fgArgs, run_in_background: true, description: `bg child ${id}`, prompt: `CHILD::${spec}::${id}b Reply with one line.` };
        return logAnd({ toolCalls: [fakeToolCall('agent', fg, `call_${id}_fg`), fakeToolCall('agent', bg, `call_${id}_bg`)] }, 'parent-fgbg');
      }
      if (mode === 'bgfg' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0) {
        // A background child that answers at once, then a foreground child (the spec):
        // the bg completion notification lands on the parent while its fg wait is live.
        const bg = { ...fgArgs, run_in_background: true, description: `bg child ${id}`, prompt: `CHILD::reply::${id}b Reply with one line.` };
        const fg = { ...fgArgs, prompt: `CHILD::${spec}::${id}f Compute the answer and reply with one line.` };
        return logAnd({ toolCalls: [fakeToolCall('agent', bg, `call_${id}_bg`), fakeToolCall('agent', fg, `call_${id}_fg`)] }, 'parent-bgfg');
      }
      if (mode === 'bgsh' && last?.role !== 'tool' && lastUser.includes('PARENT::') && roundsWith('agent') === 0) {
        // Round 1: a background child that answers at once; round 2 (below): a shell call.
        const bg = { ...fgArgs, run_in_background: true, description: `bg child ${id}`, prompt: `CHILD::reply::${id}b Reply with one line.` };
        return logAnd({ toolCalls: [fakeToolCall('agent', bg, `call_${id}_bg`)] }, 'parent-bgsh-agent');
      }
      if (mode === 'bgsh' && last?.role === 'tool' && roundsWith('run_shell_command') === 0) {
        const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
        return logAnd({ toolCalls: [shell] }, 'parent-bgsh-shell');
      }
      if (mode === 'prebg' && last?.role === 'tool' && !calledAgent) {
        return logAnd({ toolCalls: [fakeToolCall('agent', bgArgs, `call_${id}_agent`)] }, 'parent-prebg-agent');
      }
      if ((mode === 'sh' || mode === 'prebg') && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
        return logAnd({ toolCalls: [shell] }, `parent-${mode}-first`);
      }
      if (mode === 'dups' || mode === 'dupb') {
        // Two agent calls in one Turn that reuse one callId, the way an
        // index-numbered provider (call_0, call_1, ...) can across rounds.
        const agentCalls = messages.filter(
          (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) &&
            (m.tool_calls as Array<{ function?: { name?: string } }>).some((c) => c.function?.name === 'agent'),
        ).length;
        if (last?.role !== 'tool' && lastUser.includes('PARENT::') && agentCalls === 0) {
          return logAnd({ toolCalls: [fakeToolCall('agent', { ...fgArgs, run_in_background: true }, 'call_0')] }, `parent-${mode}-first`);
        }
        if (last?.role === 'tool' && agentCalls === 1) {
          const second = { ...fgArgs, run_in_background: true, prompt: `CHILD::reply::${id}b second prompt` + (mode === 'dupb' ? ' ' + 'q'.repeat(40 * 1024) : '') };
          return logAnd({ toolCalls: [fakeToolCall('agent', second, 'call_0')] }, `parent-${mode}-second`);
        }
      }
      if (mode === 'phold' && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        // The parent's own model call stays in flight until released (control probes).
        await hold(id).promise;
        return logAnd({ content: `PARENT_PLAIN::${id}::released` }, 'parent-phold');
      }
      if (mode === 'bigp' && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const big = { ...fgArgs, prompt: fgArgs.prompt + ' ' + 'p'.repeat(40 * 1024) };
        return logAnd({ toolCalls: [fakeToolCall('agent', big, `call_${id}_agent`)] }, 'parent-bigp');
      }
      if (mode === 'pre' && last?.role === 'tool' && !calledAgent) {
        // Second batch: the agent call after an earlier non-agent batch.
        return logAnd({ toolCalls: [fakeToolCall('agent', fgArgs, `call_${id}_agent`)] }, 'parent-pre-agent');
      }
      if ((mode === 'pre' || mode === 'mixed') && last?.role !== 'tool' && lastUser.includes('PARENT::')) {
        const shell = fakeToolCall('run_shell_command', { command: `echo parent-${id} > parent-${id}.txt; ls` }, `call_${id}_shell`);
        return logAnd(
          { toolCalls: mode === 'pre' ? [shell] : [shell, fakeToolCall('agent', fgArgs, `call_${id}_agent`)] },
          `parent-${mode}-first`,
        );
      }
      if (last?.role === 'tool') {
        role = 'parent-after-tool';
        reply = { content: `PARENT_FINAL::${id}|saw=${messages.filter((m) => m.role === 'tool').map((m) => text(m.content).slice(0, 160)).join(' || ')}` };
      } else if (!lastUser.includes('PARENT::')) {
        role = 'parent-wake';
        reply = { content: `PARENT_WAKE::${id}|saw=${lastUser.slice(0, 400)}` };
      } else if (mode === 'plain') {
        role = 'parent-plain';
        reply = { content: `PARENT_PLAIN::${id}` };
      } else {
        role = 'parent-launch';
        const args: Record<string, unknown> = {
          description: `child task ${id}`,
          prompt: `CHILD::${spec}::${id} Compute the answer and reply with one line.`,
        };
        if (mode === 'fg') args['run_in_background'] = false;
        if (mode === 'bg') args['run_in_background'] = true;
        if (mode === 'subagent') {
          args['run_in_background'] = false;
          args['subagent_type'] = 'general-purpose';
        }
        if (mode === 'five') {
          return logAnd(
            {
              toolCalls: [1, 2, 3, 4, 5].map((n) =>
                fakeToolCall(
                  'agent',
                  {
                    description: `child ${id} #${n}`,
                    prompt: `CHILD::${spec}::${id}-${n} Reply with one line.`,
                    run_in_background: true,
                  },
                  `call_${id}_${n}`,
                ),
              ),
            },
            'parent-launch-five',
          );
        }
        reply = { toolCalls: [fakeToolCall('agent', args, `call_${id}`)] };
      }
    } else if (child) {
      const [, spec, id] = child;
      role = 'child';
      if (last?.role === 'tool') {
        // msghold: the message to the parent is committed; hold the child's final answer
        if (spec === 'msghold') await hold(id).promise;
        // round 2 (P1 probe): echo what the tool actually returned
        if (['rdhost', 'rdmount', 'pwdls', 'wrhost', 'shwr', 'shcat', 'rdabs', 'shetc'].includes(spec))
          reply = { content: `CHILD_RESULT::${id}::saw=` + text(last.content).replace(/\s+/g, ' ').slice(0, 400) };
        else reply = { content: `CHILD_RESULT::${id}::after-tool` };
      } else if (spec === 'rdhost' || spec === 'rdmount') {
        const file = spec === 'rdhost' ? 'HOST_ONLY.txt' : 'MOUNT_ONLY.txt';
        reply = { toolCalls: [fakeToolCall('read_file', { file_path: file }, `call_${id}_rd`)] };
      } else if (spec === 'pwdls') {
        reply = { toolCalls: [fakeToolCall('run_shell_command', { command: 'pwd; ls' }, `call_${id}_pwd`)] };
      } else if (spec === 'shetc') {
        reply = { toolCalls: [fakeToolCall('run_shell_command', { command: 'head -2 /etc/hosts; ls ../harness-home/.qwen' }, `call_${id}_etc`)] };
      } else if (spec === 'shcat') {
        reply = { toolCalls: [fakeToolCall('run_shell_command', { command: 'pwd; cat HOST_ONLY.txt MOUNT_ONLY.txt 2>&1' }, `call_${id}_cat`)] };
      } else if (spec === 'rdabs') {
        reply = { toolCalls: [fakeToolCall('read_file', { file_path: '/Users/wenshao/git/pr14076-rig/runs/h1/workspace/HOST_ONLY.txt' }, `call_${id}_rda`)] };
      } else if (spec === 'shwr') {
        reply = { toolCalls: [fakeToolCall('run_shell_command', { command: `pwd; cat HOST_ONLY.txt MOUNT_ONLY.txt 2>&1; echo written-by-${id} > SUBAGENT_WROTE_${id}.txt; ls` }, `call_${id}_shwr`)] };
      } else if (spec === 'wrhost') {
        reply = { toolCalls: [fakeToolCall('write_file', { file_path: `WROTE_${id}.txt`, content: `written by ${id}\n` }, `call_${id}_wr`)] };
      } else if (spec === 'msg' || spec === 'msghold') {
        // H4d-b: the child messages its parent first, then answers
        reply = { toolCalls: [fakeToolCall('send_message', { to: 'parent', message: `MSG_FROM_CHILD::${id}` }, `call_${id}_msg`)] };
      } else if (spec === 'reply') {
        reply = { content: `CHILD_RESULT::${id}::ok` };
      } else if (spec.startsWith('hold')) {
        appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), i: requestIndex, role: 'child-holding', child: child?.[0] }) + '\n');
        await hold(id).promise;
        reply = { content: `CHILD_RESULT::${id}::released` };
      } else if (spec.startsWith('streamhold')) {
        reply = {
          contentChunks: [`CHILD_PARTIAL::${id}`, `::released`],
          holdAfterChunks: 1,
          holdUntil: hold(id).promise,
        };
      } else if (spec.startsWith('sleep')) {
        const ms = Number(spec.slice(5));
        await new Promise((r) => setTimeout(r, ms));
        reply = { content: `CHILD_RESULT::${id}::slept${ms}` };
      } else if (spec === 'shell') {
        reply = {
          toolCalls: [
            fakeToolCall('run_shell_command', { command: `echo child-${id} > child-${id}.txt; pwd` }, `call_c_${id}`),
          ],
        };
      } else if (spec === 'error') {
        reply = { errorContent: `child model failure ${id}` };
      } else if (/^fill\d+c\d+$/.test(spec)) {
        const [, n, c] = /^fill(\d+)c(\d+)$/.exec(spec)!;
        reply = { content: `CHILD_RESULT::${id}::` + String.fromCharCode(Number(c)).repeat(Number(n)) };
      } else if (/^mix\d+c\d+x\d+c\d+$/.test(spec)) {
        const [, n, c, m2, d] = /^mix(\d+)c(\d+)x(\d+)c(\d+)$/.exec(spec)!;
        reply = {
          content: `CHILD_RESULT::${id}::` + String.fromCharCode(Number(c)).repeat(Number(n)) + String.fromCharCode(Number(d)).repeat(Number(m2)),
        };
      } else if (spec === 'lines') {
        reply = { content: `CHILD_RESULT::${id}::first line\nsecond line\n- item A\n- item B` };
      } else if (spec === 'mid') {
        reply = { content: `CHILD_RESULT::${id}::` + 'y'.repeat(100 * 1024) };
      } else if (spec === 'big') {
        reply = { content: `CHILD_RESULT::${id}::` + 'x'.repeat(300 * 1024) };
      } else {
        reply = { content: `CHILD_RESULT::${id}::${spec}` };
      }
    }
    return logAnd(reply, role);

    function logAnd(r: FakeOpenAIResponse, roleName: string) {
      appendFileSync(
        LOG,
        JSON.stringify({
          t: new Date().toISOString(),
          i: requestIndex,
          role: roleName,
          parent: parent?.[0],
          child: child?.[0],
          tools: tools.sort(),
          lastRole: last?.role,
          n: messages.length,
          toolMsgs: messages.filter((m) => m.role === 'tool').map((m) => `${(m as { tool_call_id?: string }).tool_call_id}=${text(m.content).slice(0, 160)}`),
          reply: r.content?.slice(0, 120) ?? (r.toolCalls ? r.toolCalls.map((c) => c.function.name + c.function.arguments) : r.errorContent ?? r.contentChunks),
        }) + '\n',
      );
      return r;
    }
  },
  { listenHost: '127.0.0.1', baseUrlHost: '127.0.0.1', keepAlive: false },
);
console.log(`MODEL ${server.baseUrl}`);
createServer((req, res) => {
  const m = /^\/release\/(.+)$/.exec(req.url ?? '');
  if (m) {
    hold(m[1]).release();
    res.end('released ' + m[1] + '\n');
    return;
  }
  res.statusCode = 404;
  res.end();
}).listen(24076, '127.0.0.1', () => console.log('CONTROL 24076'));
