// VERIFICATION RIG ONLY (PR #13129): trusted function Hook handlers loaded by the Tool Runtime worker.
// Every physical invocation appends one line to RIG_HOOK_LEDGER; behaviour is steered per export by RIG_HOOK_CONTROL.
import fs from 'node:fs';

const LEDGER = process.env.RIG_HOOK_LEDGER;
const CONTROL = process.env.RIG_HOOK_CONTROL;
const control = () => {
  try {
    return JSON.parse(fs.readFileSync(CONTROL, 'utf8'));
  } catch {
    return {};
  }
};
const log = (entry) => {
  if (LEDGER) fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), pid: process.pid, ...entry }) + '\n');
};
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
  });
const ctx = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

function make(name, behave) {
  return {
    handlerRevision: 1,
    async callback(input, context) {
      const c = control()[name] ?? {};
      const entry = {
        name,
        event: input.hook_event_name,
        tool: input.tool_name,
        toolInput: input.tool_input,
        toolUseId: input.tool_use_id ?? context?.toolUseID,
        stopHookActive: input.stop_hook_active,
        session: input.session_id,
        messages: context?.messages?.length,
        messagesBytes: context?.messages ? Buffer.byteLength(JSON.stringify(context.messages)) : undefined,
        cwd: input.cwd,
        deletedSessionId: input.deleted_session_id,
        reason: input.reason,
      };
      log(entry);
      if (c.throw) throw new Error(`rig ${name} failure`);
      if (c.sleepMs) await sleep(c.sleepMs, context?.signal);
      if (c.hangUntilFile) {
        while (!fs.existsSync(c.hangUntilFile)) await sleep(100, context?.signal);
      }
      if (c.bigBytes) return ctx(input.hook_event_name, 'B'.repeat(c.bigBytes));
      return behave(input, c, context);
    },
    onHookSuccess(result) {
      log({ name, kind: 'onHookSuccess', handlerId: result?.hookConfig?.id });
    },
  };
}

const fileOf = (input) => String(input.tool_input?.file_path ?? input.tool_input?.absolute_path ?? '');

export const perm = make('perm', (input) =>
  fileOf(input).includes('permdeny')
    ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'RIG-PERM-DENY' } } }
    : { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } },
);

export const pre = make('pre', (input) => {
  const f = fileOf(input);
  if (f.includes('blocked'))
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'RIG-PRE-DENY' } };
  if (f.includes('rewrite'))
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...input.tool_input, file_path: f.replace('rewrite', 'rewritten'), content: 'REWRITTEN-BY-HOOK' },
        additionalContext: `PRE-CTX:${f}`,
      },
    };
  if (f.includes('ask')) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'RIG-ASK' } };
  return ctx('PreToolUse', `PRE-CTX:${f}`);
});

export const post = make('post', (input, c) => (c.stop ? { continue: false, stopReason: 'RIG-POST-STOP' } : ctx(input.hook_event_name, `POST-CTX:${fileOf(input)}`)));
export const batch = make('batch', (input, c) => (c.stop ? { continue: false, stopReason: 'RIG-BATCH-STOP' } : ctx('PostToolBatch', 'BATCH-CTX')));
export const ups = make('ups', () => ctx('UserPromptSubmit', 'UPS-CTX'));
export const start = make('start', () => ctx('SessionStart', 'START-CTX'));
export const stop = make('stop', (input, c) =>
  c.blockOnce && !input.stop_hook_active ? { decision: 'block', reason: 'RIG-STOP-CONTINUE' } : c.continueFalseOnce && !input.stop_hook_active ? { continue: false, stopReason: 'RIG-STOP-CF' } : undefined,
);
export const display = make('display', () => undefined);
export const notify = make('notify', () => ctx('Notification', 'NOTIFY-CTX'));
export const lifecycle = make('lifecycle', () => undefined);
export const once = make('once', () => ctx('UserPromptSubmit', 'ONCE-CTX'));
export const plain = make('plain', () => undefined);
export const slow = make('slow', () => undefined);
export const rev1 = make('rev1', (input) => ctx(input.hook_event_name, 'REV1-CTX'));
export const rev2 = make('rev2', (input) => ctx(input.hook_event_name, 'REV2-CTX'));

// Round 3: dedicated exports for the cancellation probe (steered by RIG_HOOK_CONTROL[name].sleepMs).
export const cxUps = make('cxUps', () => ctx('UserPromptSubmit', 'CXUPS-CTX'));
export const cxPre = make('cxPre', () => ctx('PreToolUse', 'CXPRE-CTX'));
export const cxPost = make('cxPost', () => ctx('PostToolUse', 'CXPOST-CTX'));
export const cxStop = make('cxStop', () => undefined);
export const lifeThrow = make('lifeThrow', () => { throw new Error('rig SessionEnd failure'); });
