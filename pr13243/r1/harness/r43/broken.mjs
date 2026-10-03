import fs from 'node:fs';
import path from 'node:path';
const LEDGER = process.env.RIG_HOOK_LEDGER;
const log = (e) => LEDGER && fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), pid: process.pid, module: "broken", ...e }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
log({ kind: 'eval-start' });
throw new Error('r43 broken module');

log({ kind: 'eval-done' });
export const registered = {
  handlerRevision: 1,
  async callback(input) {
    log({ kind: 'callback', event: input.hook_event_name, session: input.session_id });
    return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: 'R43-CTX-broken' } };
  },
  onHookSuccess() {},
};
