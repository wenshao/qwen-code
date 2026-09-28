// Cold load of S3's faulted Sessions in a new Harness after the 60 s writer lease expired.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '../wt-pr/integration-tests/fake-openai-server.ts';
const ARM = process.env.ARM ?? 'pr';
const res = JSON.parse(fs.readFileSync(path.join(L.RIG, 'out', `s3-commit-fault-${ARM}.json`), 'utf8'));
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as any[];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  return receipts.length ? { content: 'PLAIN_DONE' } : { toolCalls: [fakeToolCall('write_file', { file_path: `cold-${Date.now()}.txt`, content: 'cold' }, `cold-${Date.now()}`)] };
});
const h = await new L.Harness({ name: `s3b-${ARM}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19950' }).start();
for (const r of res) {
  const s = new L.HSession(h, r.sessionId, L.storeConnection(h, `ws-${r.letter}`, 18950));
  const ld = await s.load();
  const st = ld.status === 200 ? await s.status() : null;
  const pr = ld.status === 200 ? await s.submit('[[PLAIN]]') : null;
  if (pr?.status === 202) await s.waitIdle().catch(() => undefined);
  L.say(`${r.fault}:cold`, `load=${ld.status} ${ld.status === 200 ? '' : JSON.stringify(ld.json).slice(0, 90)} blocked=${st?.recoveryBlocked} prompt=${pr ? `${pr.status} ${pr.status === 202 ? '' : JSON.stringify(pr.json).slice(0, 90)}` : 'n/a'}`);
}
await h.stop();
process.exit(0);
