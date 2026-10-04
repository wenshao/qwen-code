// Candidate fix, applied to the cand arm's bundle by exact anchors (fail-closed).
import fs from 'node:fs';
const S = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/f2664731-3690-4937-833c-9c220ef51e4c/scratchpad';
const F = `${S}/wt-cand/dist/chunks/server-VRPHOUSB.js`;
const real = fs.realpathSync(F);
if (!real.startsWith(`${S}/wt-cand/`)) throw new Error('cand chunk is not a private copy: ' + real);
let s = fs.readFileSync(F, 'utf8');
const edits = [
  ['cancelled:"The turn was cancelled before this tool call ran."', 'cancelled:"The turn was cancelled before this tool call ran.",deadline:"The turn reached its deadline before this tool call ran."'],
  ['return asked&&signal.aborted?refusals.map(reason=>reason??APPROVAL_REFUSALS.cancelled):refusals}', 'return asked&&signal.aborted?refusals.map(reason=>reason??(signal.reason===HOSTED_TURN_DEADLINE?APPROVAL_REFUSALS.deadline:APPROVAL_REFUSALS.cancelled)):refusals}'],
  ['if(signal.aborted)return APPROVAL_REFUSALS.cancelled;await this.harness.commitDurableWait', 'if(signal.aborted)return signal.reason===HOSTED_TURN_DEADLINE?APPROVAL_REFUSALS.deadline:APPROVAL_REFUSALS.cancelled;await this.harness.commitDurableWait'],
  ['await endHostedAction(this.session,requestId,signal.aborted?"cancelled":"expired")', 'await endHostedAction(this.session,requestId,signal.aborted&&signal.reason!==HOSTED_TURN_DEADLINE?"cancelled":"expired")'],
  ['if(action.state!=="expired")return APPROVAL_REFUSALS.cancelled;this.unanswered=true;return APPROVAL_REFUSALS.expired}', 'if(action.state!=="expired")return APPROVAL_REFUSALS.cancelled;if(signal.reason===HOSTED_TURN_DEADLINE)return APPROVAL_REFUSALS.deadline;this.unanswered=true;return APPROVAL_REFUSALS.expired}'],
];
for (const [a, b] of edits) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`anchor count ${n}: ${a.slice(0, 70)}`);
  s = s.replace(a, b);
}
fs.writeFileSync(F, s);
console.log('patched', edits.length, 'edits');
