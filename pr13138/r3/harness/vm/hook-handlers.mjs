// VERIFICATION RIG ONLY (PR #13138 round 3): trusted function Hook handlers for the merged W1b + H2 tree.
// Each invocation appends one JSON line to RIG_HOOK_LEDGER.
import fs from 'node:fs';
const LEDGER = process.env.RIG_HOOK_LEDGER;
const log = (entry) => { if (LEDGER) fs.appendFileSync(LEDGER, JSON.stringify({ t: Date.now(), pid: process.pid, ...entry }) + '\n'); };
const ctx = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
function make(name, behave) {
  return {
    handlerRevision: 1,
    async callback(input) {
      log({ name, event: input.hook_event_name, tool: input.tool_name, session: input.session_id });
      return behave(input);
    },
  };
}
export const ups = make('ups', () => ctx('UserPromptSubmit', 'W1B-HOOK-UPS-CTX'));
export const pre = make('pre', (input) => ctx('PreToolUse', `W1B-HOOK-PRE:${input.tool_input?.file_path ?? ''}`));
