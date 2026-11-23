// Print the live-daemon idempotency evidence from both wire probes.
import { readFileSync } from 'node:fs';

const [rawPath, sdkPath] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
const sdk = JSON.parse(readFileSync(sdkPath, 'utf8'));

console.log('VERIFY-18177  live daemon: does a repeated idempotencyKey start a second turn?');
console.log('');
console.log('raw HTTP, three identical POST /session/:id/prompt bodies');
console.log(`  statuses ............ ${JSON.stringify(raw.statuses)}`);
console.log(`  promptIds ........... ${JSON.stringify(raw.promptIds)}`);
console.log(`  deduplicated flags .. ${JSON.stringify(raw.dedupFlags)}`);
console.log(`  distinct promptIds .. ${raw.distinctPromptIds}`);
console.log('');
console.log('real @qwen-code/sdk DaemonClient through a capture proxy');
console.log(`  captured prompt POSTs ...... ${sdk.capturedPromptPosts}`);
console.log(`  idempotencyKey on the wire . ${JSON.stringify(sdk.capturedKeys)}`);
console.log(`  key present in first body .. ${sdk.keyPresentInFirstBody}`);
console.log(`  first  promptId ............ ${sdk.firstPromptId}`);
console.log(`  second promptId ............ ${sdk.secondPromptId}`);
console.log(`  same promptId .............. ${sdk.samePromptId}`);
console.log(`  second deduplicated ........ ${sdk.secondDeduplicated}`);