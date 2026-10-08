// Measures the bytes that HostedChildAgentSession.buildResultNotification
// actually publishes: Buffer.from(JSON.stringify({ text: notification })).
import {
  CHILD_NOTIFICATION_INLINE_LIMIT,
  childResultNotificationText,
} from '/Users/wenshao/git/pr13550-head/packages/cli/src/serve/hosted-child-agent-session.ts';
import { HTTP_MANAGED_SESSION_STORE_CONTRACT } from '/Users/wenshao/git/pr13550-head/packages/core/src/managed-runtime/http-managed-session-store.ts';

const limit = HTTP_MANAGED_SESSION_STORE_CONTRACT.maxInlineResourceBytes;
const cases: Array<[string, string]> = [
  ['plain 2 KiB', 'a'.repeat(2048)],
  ["20 KiB of '<' (round-1 B1 shape)", '<'.repeat(20 * 1024)],
  ["30,000 '\"'", '"'.repeat(30000)],
  ['60,000 plain ASCII, no newline', 'a'.repeat(60000)],
  ['64,000 plain ASCII, no newline', 'b'.repeat(64000)],
  ['44 KB XML-ish lines (1,100 lines)', ('<div class="row">x</div>' + ' '.repeat(15) + '\n').repeat(1100)],
  ["20,000 '\\\\' then 20,000 '<'", '\\'.repeat(20000) + '<'.repeat(20000)],
  ["16,290 '<' (round-2 B1b shape)", '<'.repeat(16290)],
  ['multi-line (round-2 N1 shape)', 'first line\nsecond line\n- item A\n- item B'],
  ['70,000 emoji code points', '\u{1F600}'.repeat(70000)],
];
console.log(`CHILD_NOTIFICATION_INLINE_LIMIT=${CHILD_NOTIFICATION_INLINE_LIMIT} store maxInlineResourceBytes=${limit}`);
for (const [label, text] of cases) {
  const n = childResultNotificationText({ taskId: 'task_x', description: 'probe', text });
  const published = Buffer.from(JSON.stringify({ text: n }), 'utf8').byteLength;
  console.log(
    `${label.padEnd(44)} raw=${Buffer.byteLength(text)} notif=${Buffer.byteLength(n)} truncated=${n.includes('(truncated:')} published=${published} ${published > limit ? 'REJECTED (> limit)' : 'fits'} newlines=${(n.match(/\n/g) ?? []).length} loneSurrogate=${/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(n)}`,
  );
}
