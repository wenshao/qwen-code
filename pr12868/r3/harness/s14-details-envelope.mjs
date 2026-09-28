// PR #12868 round 3: how the BUILT TypeScript client reads main's four-key
// error envelope ({error, code, retryable, details}). The peer here is a
// loopback stand-in, not the Broker: the real stack did not produce an
// ABANDONED record in this round, so this is the only way to show the client
// side of it. The envelope shape is RuntimeBrokerHttpServer.sendError's.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { attempt, check, loadProvider, openLog, say, summary } from './lib.mjs';

openLog('s14-details-envelope-pr');
let next;
const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const text = JSON.stringify(next.body);
    res.writeHead(next.status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { BrokerManagedRuntimeProvider } = await loadProvider();
const provider = new BrokerManagedRuntimeProvider({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'stand-in' });
const ids = { harnessSessionId: randomUUID(), runtimeSessionId: randomUUID(), executionCallId: randomUUID() };
const error = 'Runtime execution was abandoned after Runtime loss';
const cases = [
  ['three keys', { status: 409, body: { error, code: 'runtime_broker_execution_unknown', retryable: false } }],
  ['four keys, terminal runtime_lost', { status: 409, body: { error, code: 'runtime_broker_execution_unknown', retryable: false, details: { terminal: true, reason: 'runtime_lost' } } }],
  ['four keys, other code', { status: 409, body: { error: 'Runtime generation is no longer live', code: 'runtime_admission_closed', retryable: false, details: { terminal: true, reason: 'runtime_lost' } } }],
  ['three keys, other code', { status: 409, body: { error: 'Runtime generation is no longer live', code: 'runtime_admission_closed', retryable: false } }],
];
const seen = {};
for (const [name, answer] of cases) {
  next = answer;
  const inspected = await attempt(() => provider.inspectExecution(ids));
  seen[name] = inspected;
  say('N', `${name.padEnd(34)} inspectExecution -> ${inspected.ok ? JSON.stringify(inspected.value) : `raises ${inspected.status} ${inspected.code} message=${JSON.stringify(inspected.message)}`}`);
}
check('N.1', 'a terminal runtime_lost answer is reported as unknown + terminal; a plain unknown stays plain',
  seen['three keys'].ok && seen['three keys'].value.terminal === undefined &&
  seen['four keys, terminal runtime_lost'].ok && seen['four keys, terminal runtime_lost'].value.terminal === true);
check('N.2', 'the same refusal raised with details carries the code but no reason text; without details it carries both',
  !seen['four keys, other code'].ok && seen['four keys, other code'].code === 'runtime_admission_closed' &&
  !/no longer live/.test(seen['four keys, other code'].message ?? '') &&
  /no longer live/.test(seen['three keys, other code'].message ?? ''));
const ok = summary();
provider.dispose();
server.close();
process.exit(ok ? 0 : 1);
