/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentEventEmitter,
  AgentEventType,
  AgentTerminateMode,
  ContextState,
  ToolConfirmationOutcome,
  type ExternalAgentExecutorParams,
  type SubagentExecutor,
} from '@qwen-code/qwen-code-core/subagentRuntime';
import { Config, InputFormat } from '@qwen-code/qwen-code-core';
import {
  acpExternalAgentExecutor,
  externalModelLabel,
  isExpectedExternalAgentCleanupExit,
  optionKindForOutcome,
  resolvePermissionMode,
  selectPermissionOption,
  selectRejectOption,
} from './acp-subagent-executor.js';

const fixture = String.raw`
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { spawn } from 'node:child_process';
const scenario = process.argv[1];
if (scenario === 'term-resistant') process.on('SIGTERM', () => {});
let mode;
let prompts = 0;
let permissionCount = 0;
let connection;
const send = (update) => connection.sessionUpdate({sessionId:'fixture', update});
connection = new AgentSideConnection(() => ({
  initialize: async () => {
    if (scenario === 'init-exit') process.exit(3);
    if (scenario === 'init-hang') return new Promise(() => {});
    return {protocolVersion:1, agentCapabilities:{}};
  },
  newSession: async () => {
    if (scenario === 'session-exit') process.exit(4);
    if (scenario === 'session-hang') return new Promise(() => {});
    return {sessionId:'fixture', modes:{currentModeId:'auto', availableModes:scenario === 'no-mode' ? [] : [{id:'default',name:'Ask'},{id:'plan',name:'Plan'}]}};
  },
  setSessionMode: async (params) => {
    if (scenario === 'mode-error') throw new Error('cannot set mode');
    if (scenario === 'mode-hang') return new Promise(() => {});
    mode = params.modeId;
    return {};
  },
  authenticate: async () => ({}),
  cancel: async () => { await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'CANCEL_RECEIVED'}}); },
  prompt: async (params) => {
    prompts++;
    if (mode !== 'default' && mode !== 'plan') throw new Error('PROMPT BEFORE SAFE MODE');
    if (scenario === 'prompt-exit') process.exit(5);
    if (scenario === 'prompt-close') { process.stdout.end(); return new Promise(() => {}); }
    if (scenario === 'prompt-hang') return new Promise(() => {});
    if (scenario === 'unsupported-extension') {
      try {
        await connection.extMethod('_fixture/unsupported', {sessionId:'fixture'});
        throw new Error('Unsupported method unexpectedly succeeded');
      } catch (error) {
        await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify({code:error.code,message:error.message})}});
      }
      return {stopReason:'end_turn'};
    }
    if (scenario === 'tree') {
      const descendant = spawn(process.execPath, ['-e','process.on("SIGTERM",()=>{});process.send("ready");setInterval(()=>{},1000)'], {stdio:['ignore','ignore','ignore','ipc']});
      await new Promise(resolve => descendant.once('message', resolve));
      await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:String(descendant.pid)}});
      return {stopReason:'end_turn'};
    }
    if (scenario.startsWith('permission')) {
      const toolName = scenario === 'permission-question' ? 'AskUserQuestion' : scenario === 'permission-question-snake' ? 'ask_user_question' : 'Write';
      const request = () => connection.requestPermission({sessionId:'fixture',toolCall:{toolCallId:'same',title:'Write',kind:'edit',_meta:{claudeCode:{toolName}}},options:[{optionId:'once',name:'Once',kind:'allow_once'},{optionId:'always',name:'Always',kind:'allow_always'},{optionId:'no',name:'No',kind:'reject_once'}]});
      const result = scenario === 'permission-duplicate' ? await Promise.all([request(), request()]) : [await request()];
      await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(result)}});
      permissionCount++;
      return {stopReason:'end_turn'};
    }
    if (scenario === 'env') {
      await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(['QWEN_SERVER_TOKEN','QWEN_DAEMON_TOKEN','QWEN_CODE_EXTERNAL_TOOL_GUARD_TOKEN','QWEN_CODE_PRIVATE_ACP_CAPABILITY'].map(k => process.env[k] ?? null))}});
      return {stopReason:'end_turn'};
    }
    await send({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'thinking'}});
    await send({sessionUpdate:'agent_message_chunk',content:{type:'text',text:params.prompt.map(p=>p.text).join('|')}});
    await send({sessionUpdate:'tool_call',toolCallId:'tool-'+prompts,title:'Shell',kind:'execute',status:'in_progress',rawInput:{}});
    await send({sessionUpdate:'tool_call_update',toolCallId:'tool-'+prompts,rawInput:{command:'printf hello'},_meta:{claudeCode:{toolName:'Bash'}},content:[{type:'content',content:{type:'text',text:'hello'}}]});
    await send({sessionUpdate:'tool_call_update',toolCallId:'tool-'+prompts,status:'completed'});
    await send({sessionUpdate:'tool_call_update',toolCallId:'tool-'+prompts,status:'completed'});
    return {stopReason:scenario === 'continuation-refusal' && prompts > 1 ? 'refusal' : scenario === 'max-tokens' ? 'max_tokens' : scenario === 'unknown-stop' ? 'future_reason' : 'end_turn'};
  },
}), ndJsonStream(Writable.toWeb(process.stdout),Readable.toWeb(process.stdin)));
setInterval(()=>{},1000);
`;

const executors: SubagentExecutor[] = [];
afterEach(async () => {
  await Promise.all(
    executors.splice(0).map((executor) => executor.dispose?.()),
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function params(scenario = 'normal'): ExternalAgentExecutorParams {
  const runtimeContext = new Config({
    sessionId: 'fixture-test',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    model: 'unused',
    debugMode: false,
  });
  vi.spyOn(runtimeContext, 'isInteractive').mockReturnValue(true);
  return {
    spec: {
      kind: 'acp',
      command: process.execPath,
      args: ['--input-type=module', '-e', fixture, scenario],
    },
    name: 'fixture',
    promptConfig: { systemPrompt: '' },
    modelConfig: { model: 'unused' },
    runConfig: {},
    runtimeContext,
    eventEmitter: new AgentEventEmitter(),
  };
}

async function create(
  options: ExternalAgentExecutorParams,
): Promise<SubagentExecutor> {
  const executor = await acpExternalAgentExecutor.create(options);
  executors.push(executor);
  return executor;
}

function context(text = 'task'): ContextState {
  const state = new ContextState();
  state.set('task_prompt', text);
  return state;
}

describe('permission mapping', () => {
  it('honors loader approval precedence and fails unknown modes towards asking', () => {
    expect(resolvePermissionMode('bypassPermissions', 'plan')).toBe('plan');
    expect(resolvePermissionMode('auto', 'default')).toBe('default');
    expect(resolvePermissionMode('auto', 'auto-edit')).toBe('acceptEdits');
    expect(resolvePermissionMode(undefined, undefined)).toBe('default');
    expect(resolvePermissionMode('unknown', undefined)).toBe('default');
  });
  it('never grants for non-approval outcomes or widens a single approval', () => {
    expect(optionKindForOutcome(ToolConfirmationOutcome.RestorePrevious)).toBe(
      'reject_once',
    );
    expect(optionKindForOutcome(ToolConfirmationOutcome.ModifyWithEditor)).toBe(
      'reject_once',
    );
    const options = [
      { optionId: 'always', kind: 'allow_always' },
      { optionId: 'no', kind: 'reject_once' },
    ];
    expect(
      selectPermissionOption(options, ToolConfirmationOutcome.ProceedOnce),
    ).toBe('no');
    expect(
      selectPermissionOption(options, ToolConfirmationOutcome.Cancel),
    ).toBeUndefined();
    expect(
      selectPermissionOption(
        [{ optionId: 'once', kind: 'allow_once' }],
        ToolConfirmationOutcome.ProceedAlways,
      ),
    ).toBe('once');
    expect(
      selectPermissionOption(
        [
          { optionId: 'same', kind: 'allow_once' },
          { optionId: 'same', kind: 'reject_once' },
        ],
        ToolConfirmationOutcome.ProceedOnce,
      ),
    ).toBeUndefined();
  });
  it('uses an external model label', () => {
    expect(externalModelLabel('/usr/bin/claude')).toBe('external-acp:claude');
    expect(externalModelLabel('C:\\tools\\claude')).toBe('external-acp:claude');
  });
  it('selects the narrowest reject option and refuses to guess', () => {
    const full = [
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' },
      { optionId: 'no', kind: 'reject_once' },
    ];
    // Prefers reject_once over reject_always (deny this call, not the session).
    expect(selectRejectOption(full)).toBe('no');
    expect(
      selectRejectOption([
        { optionId: 'never', kind: 'reject_always' },
        { optionId: 'once', kind: 'allow_once' },
      ]),
    ).toBe('never');
    // No reject option at all → undefined, so the caller falls back to cancel
    // rather than selecting an allow.
    expect(
      selectRejectOption([
        { optionId: 'once', kind: 'allow_once' },
        { optionId: 'always', kind: 'allow_always' },
      ]),
    ).toBeUndefined();
    expect(selectRejectOption([])).toBeUndefined();
    // Ambiguous duplicate IDs → refuse to guess.
    expect(
      selectRejectOption([
        { optionId: 'same', kind: 'reject_once' },
        { optionId: 'same', kind: 'allow_once' },
      ]),
    ).toBeUndefined();
  });
});

describe('cleanup-exit classification', () => {
  it('treats a foreign root that died during disposal as expected', () => {
    // The Linux race: the prompt rejects on stdout EOF, dispose() enters the
    // registry's initial tree snapshot, and the root exits mid-snapshot.
    expect(
      isExpectedExternalAgentCleanupExit(
        new Error(
          'ACP child pid=2628870 exited before its initial process-tree snapshot completed',
        ),
      ),
    ).toBe(true);
    // The root we signalled exiting by that signal.
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      expect(
        isExpectedExternalAgentCleanupExit(
          new Error(
            `ACP child pid=4242 exited uncleanly during shutdown (code=none, signal=${signal})`,
          ),
        ),
      ).toBe(true);
    }
  });
  it('propagates every genuine cleanup-proof failure', () => {
    const mustThrow = [
      // A non-zero exit CODE is the agent's own status, not a signal we sent;
      // it stays visible rather than being laundered into a clean disposal.
      'ACP child pid=4242 exited uncleanly during shutdown (code=5, signal=none)',
      'ACP child pid=4242 process-tree snapshot exceeded 512 processes or depth 8',
      'ACP child pid=4242 was absent from the initial process-tree snapshot',
      'ACP child pid=4242 was not an isolated process-group leader',
      'ACP child pid=4242 process-tree snapshot failed: ps exited 1',
      'ACP child pid=4242 could not send SIGKILL to pgid=4242: EPERM',
      'ACP child pid=4242 could not inspect pgid=999: EACCES',
      'ACP child pid=4242 did not exit within 5000ms',
      // A signal other than the two we escalate through is not ours.
      'ACP child pid=4242 exited uncleanly during shutdown (code=none, signal=SIGHUP)',
    ];
    for (const message of mustThrow) {
      expect(isExpectedExternalAgentCleanupExit(new Error(message))).toBe(
        false,
      );
    }
  });
  it('rejects non-Error and near-miss values', () => {
    expect(isExpectedExternalAgentCleanupExit(undefined)).toBe(false);
    expect(isExpectedExternalAgentCleanupExit(null)).toBe(false);
    expect(
      isExpectedExternalAgentCleanupExit(
        'ACP child pid=1 exited before its initial process-tree snapshot completed',
      ),
    ).toBe(false);
    expect(
      isExpectedExternalAgentCleanupExit(
        new Error(
          'prefix ACP child pid=1 exited before its initial process-tree snapshot completed',
        ),
      ),
    ).toBe(false);
    expect(
      isExpectedExternalAgentCleanupExit(
        new Error(
          'ACP child pid=notanumber exited before its initial process-tree snapshot completed',
        ),
      ),
    ).toBe(false);
  });
});

describe('real ACP subprocess', () => {
  it('returns method-not-found -32601 across the real extension request wire', async () => {
    const executor = await create(params('unsupported-extension'));
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toMatchObject({ code: -32601 });
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.GOAL);
  });
  it('sets an advertised asking mode before prompt and preserves text/thought/tool transcript events', async () => {
    const options = params();
    const text = vi.fn();
    const stream = vi.fn();
    const results = vi.fn();
    options.eventEmitter!.on(AgentEventType.ROUND_TEXT, text);
    options.eventEmitter!.on(AgentEventType.STREAM_TEXT, stream);
    options.eventEmitter!.on(AgentEventType.TOOL_RESPONSES_FINALIZED, results);
    const executor = await create(options);
    await executor.execute(context());
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.GOAL);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'task', thoughtText: 'thinking' }),
    );
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'thinking', thought: true }),
    );
    expect(results).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(results.mock.calls)).toContain('hello');
    expect(
      results.mock.calls[0]![0].responses[0].responseParts[0].functionResponse,
    ).toMatchObject({
      name: 'execute',
      response: { input: { command: 'printf hello' }, toolName: 'Bash' },
    });
    expect(executor.getExecutionSummary()).toMatchObject({
      totalToolCalls: 1,
      successfulToolCalls: 1,
      rounds: 1,
    });
    const duration = executor.getExecutionSummary().totalDurationMs;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(executor.getExecutionSummary().totalDurationMs).toBe(duration);
  });
  it.each(['no-mode', 'mode-error', 'init-exit', 'session-exit'])(
    'fails creation for %s',
    async (scenario) => {
      await expect(create(params(scenario))).rejects.toThrow();
    },
  );
  it.each(['init-hang', 'session-hang', 'mode-hang'])(
    'bounds and reaps a %s handshake',
    async (scenario) => {
      await expect(create(params(scenario))).rejects.toThrow('timed out');
    },
    15000,
  );
  it.each(['prompt-exit', 'prompt-close'])(
    'rejects %s without an error listener',
    async (scenario) => {
      const executor = await create(params(scenario));
      await expect(executor.execute(context())).rejects.toThrow();
      expect(executor.getTerminateMode()).toBe(AgentTerminateMode.ERROR);
    },
  );
  it.each(['max-tokens', 'unknown-stop'])(
    'never certifies %s as success',
    async (scenario) => {
      const executor = await create(params(scenario));
      await executor.execute(context());
      expect(executor.getTerminateMode()).toBe(AgentTerminateMode.ERROR);
    },
  );
  it('preserves both external-input variants and updates continuation lifecycle and stats', async () => {
    const options = params('continuation-refusal');
    const finish = vi.fn();
    const external = vi.fn();
    options.eventEmitter!.on(AgentEventType.FINISH, finish);
    options.eventEmitter!.on(AgentEventType.EXTERNAL_MESSAGE, external);
    const executor = await create(options);
    await executor.execute(context('first'));
    await executor.executeExternalInputs(
      ['second', { kind: 'notification', text: 'notice' }],
      undefined,
      { resetStats: false },
    );
    expect(executor.getFinalText()).toBe('second|notice');
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.CANCELLED);
    expect(executor.getExecutionSummary()).toMatchObject({
      rounds: 2,
      totalToolCalls: 2,
    });
    expect(finish).toHaveBeenCalledTimes(2);
    expect(external).toHaveBeenCalledTimes(2);
    await executor.execute(context('fresh'));
    expect(executor.getExecutionSummary()).toMatchObject({
      rounds: 1,
      totalToolCalls: 1,
    });
  });
  it('drains registered external messages before reporting completion', async () => {
    const executor = await create(params());
    const provider = vi
      .fn()
      .mockReturnValueOnce(['queued'])
      .mockReturnValue([]);
    executor.setExternalMessageProvider(provider);
    await executor.execute(context('first'));
    expect(executor.getFinalText()).toContain('queued');
    expect(executor.getExecutionSummary().rounds).toBe(2);
  });
  it('does not send a prompt for an already-aborted turn', async () => {
    const executor = await create(params('prompt-exit'));
    await executor.execute(context(), AbortSignal.abort());
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.CANCELLED);
    expect(executor.getFinalText()).toBe('');
  });
  it('cancels and reaps an uncooperative continuation', async () => {
    const executor = await create(params('prompt-hang'));
    const abort = new AbortController();
    const running = executor.executeExternalInputs(['continue'], abort.signal);
    setTimeout(() => abort.abort(), 50);
    await running;
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.CANCELLED);
  });
  it('enforces the configured wall time', async () => {
    const options = params('prompt-hang');
    options.runConfig.max_time_minutes = 0.001;
    const executor = await create(options);
    await executor.execute(context());
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.TIMEOUT);
  });
  it('installs a ten-minute default deadline and clears it after the real prompt', async () => {
    const executor = await create(params());
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    await executor.execute(context());
    const index = timers.mock.calls.findIndex(
      ([, delay]) =>
        typeof delay === 'number' && delay > 599_000 && delay <= 600_000,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(cleared).toHaveBeenCalledWith(timers.mock.results[index]!.value);
  });
  it('refuses an unenforceable internal turn limit', async () => {
    const options = params();
    options.runConfig.max_turns = 1;
    await expect(create(options)).rejects.toThrow('max_turns');
  });
  it.each([NaN, Infinity, -1, 0, 100_000])(
    'rejects invalid timeout %s before spawning',
    async (minutes) => {
      const options = params();
      options.spec.command = '/nonexistent/external-agent';
      options.runConfig.max_time_minutes = minutes;
      await expect(create(options)).rejects.toThrow('max_time_minutes');
    },
  );
  it('cleans up when a START subscriber throws', async () => {
    const options = params();
    options.eventEmitter!.on(AgentEventType.START, () => {
      throw new Error('start listener failed');
    });
    const executor = await create(options);
    await expect(executor.execute(context())).rejects.toThrow(
      'start listener failed',
    );
    await expect(executor.execute(context())).rejects.toThrow('closed');
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.ERROR);
  });
  it.each(['permission-question', 'permission-question-snake'])(
    'denies routed interactive question %s',
    async (scenario) => {
      const options = params(scenario);
      const approval = vi.fn();
      options.eventEmitter!.on(AgentEventType.TOOL_WAITING_APPROVAL, approval);
      const executor = await create(options);
      await executor.execute(context());
      // Denies the TOOL (selects reject_once), not the TURN (`cancelled`).
      expect(JSON.parse(executor.getFinalText())).toEqual([
        { outcome: { outcome: 'selected', optionId: 'no' } },
      ]);
      expect(approval).not.toHaveBeenCalled();
    },
  );
  it('denies when no approval listener exists', async () => {
    const executor = await create(params('permission'));
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'no' } },
    ]);
  });
  it('denies when the runtime disallows permission prompts even with a listener', async () => {
    const options = params('permission');
    vi.spyOn(
      options.runtimeContext,
      'getShouldAvoidPermissionPrompts',
    ).mockReturnValue(true);
    const approval = vi.fn();
    options.eventEmitter!.on(AgentEventType.TOOL_WAITING_APPROVAL, approval);
    const executor = await create(options);
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'no' } },
    ]);
    expect(approval).not.toHaveBeenCalled();
  });
  it('denies plain headless requests despite a display-only approval listener', async () => {
    const options = params('permission');
    vi.spyOn(options.runtimeContext, 'isInteractive').mockReturnValue(false);
    vi.spyOn(
      options.runtimeContext,
      'getExperimentalZedIntegration',
    ).mockReturnValue(false);
    vi.spyOn(options.runtimeContext, 'getInputFormat').mockReturnValue(
      InputFormat.TEXT,
    );
    vi.spyOn(
      options.runtimeContext,
      'getShouldAvoidPermissionPrompts',
    ).mockReturnValue(false);
    const displayOnly = vi.fn();
    options.eventEmitter!.on(AgentEventType.TOOL_WAITING_APPROVAL, displayOnly);
    const executor = await create(options);
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'no' } },
    ]);
    expect(displayOnly).not.toHaveBeenCalled();
  });
  it('allows stream-json approval responders', async () => {
    const options = params('permission');
    vi.spyOn(options.runtimeContext, 'isInteractive').mockReturnValue(false);
    vi.spyOn(options.runtimeContext, 'getInputFormat').mockReturnValue(
      InputFormat.STREAM_JSON,
    );
    options.eventEmitter!.on(
      AgentEventType.TOOL_WAITING_APPROVAL,
      async (event) => event.respond(ToolConfirmationOutcome.ProceedOnce),
    );
    const executor = await create(options);
    await executor.execute(context());
    expect(executor.getFinalText()).toContain('"optionId":"once"');
  });
  it('isolates duplicate outstanding tool IDs and ignores stale approval callbacks', async () => {
    const options = params('permission-duplicate');
    const callbacks: Array<() => Promise<void>> = [];
    options.eventEmitter!.on(AgentEventType.TOOL_WAITING_APPROVAL, (event) => {
      callbacks.push(() => event.respond(ToolConfirmationOutcome.ProceedOnce));
      setTimeout(
        () => void event.respond(ToolConfirmationOutcome.ProceedOnce),
        30,
      );
    });
    const executor = await create(options);
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toEqual([
      { outcome: { outcome: 'selected', optionId: 'once' } },
      { outcome: { outcome: 'cancelled' } },
    ]);
    await callbacks[0]!();
  });
  it('releases pending permission requests on cancellation', async () => {
    const options = params('permission');
    const abort = new AbortController();
    options.eventEmitter!.on(AgentEventType.TOOL_WAITING_APPROVAL, () =>
      abort.abort(),
    );
    const executor = await create(options);
    await executor.execute(context(), abort.signal);
    expect(executor.getTerminateMode()).toBe(AgentTerminateMode.CANCELLED);
  });
  it('scrubs all internal credentials in the real child environment', async () => {
    for (const name of [
      'QWEN_SERVER_TOKEN',
      'QWEN_DAEMON_TOKEN',
      'QWEN_CODE_EXTERNAL_TOOL_GUARD_TOKEN',
      'QWEN_CODE_PRIVATE_ACP_CAPABILITY',
    ])
      vi.stubEnv(name, 'secret');
    const executor = await create(params('env'));
    await executor.execute(context());
    expect(JSON.parse(executor.getFinalText())).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
  it('awaits verified disposal of a SIGTERM-resistant descendant', async () => {
    const executor = await create(params('tree'));
    await executor.execute(context());
    const pid = Number(executor.getFinalText());
    expect(pid).toBeGreaterThan(0);
    process.kill(pid, 0);
    await executor.dispose?.();
    expect(() => process.kill(pid, 0)).toThrow();
  }, 15000);
});
