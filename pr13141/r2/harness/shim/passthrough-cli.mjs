// Pass-through control entry for HostedPublicWorkspaceIT (identical shim, stripping disabled).
// the real PR bundle, but drops --managed-runtime-broker-url/--managed-runtime-broker-token
// from the Hosted Harness command line only (Broker workers pass through untouched).
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const REAL = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2910cb39-982a-4357-86da-545b55029fc1/scratchpad/wt-pr/dist/cli.js';
const LOG = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2910cb39-982a-4357-86da-545b55029fc1/scratchpad/results-r2/shim-calls.log';
const args = process.argv.slice(2);
const hosted = false; // pass-through control: never strips
const kept = [];
const dropped = [];
for (let i = 0; i < args.length; i++) {
  if (hosted && (args[i] === '--managed-runtime-broker-url' || args[i] === '--managed-runtime-broker-token')) {
    dropped.push(args[i]);
    i++;
    continue;
  }
  kept.push(args[i]);
}
appendFileSync(LOG, JSON.stringify({ pid: process.pid, first: args.slice(0, 3), hosted, dropped }) + '\n');
// Record every 4xx/5xx the Harness itself answers (observation only).
if (args[0] === 'serve') {
  const http = await import('node:http');
  const end = http.ServerResponse.prototype.end;
  http.ServerResponse.prototype.end = function (chunk, ...rest) {
    if (this.statusCode >= 400) {
      appendFileSync('/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/2910cb39-982a-4357-86da-545b55029fc1/scratchpad/results-r2/harness-4xx.log', JSON.stringify({ pid: process.pid, stripped: dropped.length > 0, method: this.req?.method, url: this.req?.url, status: this.statusCode, body: chunk ? String(chunk).slice(0, 200) : '' }) + '\n');
    }
    return end.call(this, chunk, ...rest);
  };
}
process.argv.splice(1, Infinity, REAL, ...kept);
await import(pathToFileURL(REAL).href);
