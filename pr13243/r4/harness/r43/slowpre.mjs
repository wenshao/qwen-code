// VERIFICATION RIG ONLY (PR #13243 S8): PreToolUse function Hook whose callback runs ~4 s (abort-aware)
// and leaves a side effect: a ledger line at start and, if it completes, at end.
import fs from 'node:fs';
const LEDGER = process.env.RIG_HOOK_LEDGER;
const log = (e) => LEDGER && fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), pid: process.pid, module: 'slowpre', ...e }) + '\n');
export const registered = {
  handlerRevision: 1,
  async callback(input, context) {
    const t0 = Date.now();
    log({ kind: 'callback-start', event: input.hook_event_name, tool: input.tool_name });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 4000);
        context?.signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
      });
    } catch (error) {
      log({ kind: 'callback-aborted', ranMs: Date.now() - t0 });
      throw error;
    }
    log({ kind: 'callback-end', ranMs: Date.now() - t0 });
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'R43-SLOWPRE' } };
  },
  onHookSuccess() {},
};
