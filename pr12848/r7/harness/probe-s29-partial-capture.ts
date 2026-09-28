// 14b77fee: a producer that holds the Shell's pipe past the drain boundary.
// Per command: turn outcome, durable manifest, then (after the Harness stops and its lease lapses)
// read the retained prefix back through the Store API and check it byte for byte.
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as L from '../../rig/lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from './fake-openai-server.ts';
import { createHttpManagedSessionStores } from '@qwen-code/qwen-code-core/managed-runtime/http-managed-session-store.js';
import { ResourceToolResultSegmentStore } from '@qwen-code/qwen-code-core/managed-runtime/resource-tool-result-store.js';
import { parseToolResultManifestBytes } from '@qwen-code/qwen-code-core/managed-runtime/managed-tool-result.js';

const DB = process.env.DB ?? 'p848l', HTTP = 18848, ROOTS = process.env.ROOTS ?? 'roots11';
const LETTERS = (process.env.LETTERS ?? 'a,b,c,d').split(',');
L.openLog(`s29-partial-capture-${process.env.ARM ?? ''}`);
const CMDS: Record<string, string> = {
  CD_AND_BG: 'cd . && sleep 20 > /dev/null 2>&1 & echo ok',
  BIG_BG: 'cd . && { head -c 3000000 /dev/zero | tr "\\000" a; sleep 20; } & sleep 5; echo done',
  LOGGER: '(i=0; while [ $i -lt 10 ]; do echo tick-$i; i=$((i+1)); sleep 0.3; done) & echo started',
  PLAIN: 'printf plain-ok',
};
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const key = (JSON.stringify(messages[lastUser]?.content ?? '').match(/\[\[([A-Z_]+)\]\]/) ?? [])[1];
  const receipts = messages.slice(lastUser + 1).filter((m) => m.role === 'tool');
  if (key && CMDS[key] && !receipts.length) return { toolCalls: [fakeToolCall('run_shell_command', { command: CMDS[key], timeout: 60000 }, `${key}-${Date.now()}`)] };
  return { content: 'ok' };
});
const h = await new L.Harness({ name: `partial-${process.env.ARM ?? ''}`, modelUrl: model.baseUrl, brokerUrl: 'http://127.0.0.1:19848' }).start();
const done: Array<{ key: string; ws: string; sessionId: string }> = [];
for (const [i, key] of Object.keys(CMDS).entries()) {
  const st = LETTERS[i], ws = `ws-${st}`;
  if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws}'`)[0][0] === '0') L.seedRegistry(DB, ws, `st-${st}`);
  fs.mkdirSync(`${L.RIG}/${ROOTS}/${st}/child`, { recursive: true });
  const sessionId = await L.createWorkspaceSession(HTTP, ws);
  const s = new L.HSession(h, sessionId, L.storeConnection(h, ws, HTTP));
  await s.create({ toolProfile: 'hosted-workspace-shell/1' });
  const r = await s.prompt(`[[${key}]]`, 120000);
  const receipt = (r.events ?? []).flatMap((e: any) => e.data?.record?.message?.parts ?? []).filter((p: any) => p.functionResponse).map((p: any) => p.functionResponse.response?.capture?.deliveryStatus)[0] ?? 'no receipt';
  L.say(key, `${L.summarizeTurn(r)}; receipt=${receipt}; harness=${h.log().split('\n').filter((l) => l.includes(r.promptId ?? '#')).slice(-1)[0]?.replace(/^.*recovery blocked: /, '').slice(0, 90) ?? ''}`);
  done.push({ key, ws, sessionId });
}
await h.stop();
await L.sleep(Number(process.env.LEASE_WAIT ?? 62000));
for (const { key, ws, sessionId } of done) {
  const row = L.sql(DB, `SELECT resource_id, sha256, schema_version, LENGTH(inline_bytes), HEX(inline_bytes) FROM qwen_managed_session_resource WHERE kind='managed-tool-result-manifest' AND session_id='${sessionId}' ORDER BY created_at DESC LIMIT 1`)[0];
  if (!row) { L.say(`${key} manifest`, 'none'); continue; }
  const [resourceId, digest, schemaVersion, byteLength, hex] = row;
  const manifestRef = { resourceId, kind: 'managed-tool-result-manifest', schemaVersion: Number(schemaVersion), byteLength: Number(byteLength), digest };
  const sessionKey = { tenantId: L.TENANT, workspaceId: ws, sessionId };
  const manifest = parseToolResultManifestBytes(Buffer.from(hex, 'hex'));
  L.say(`${key} manifest`, `${manifest.captureStatus}/${manifest.captureReason} ${JSON.stringify(manifest.contents.map((c: any) => `${c.streamId}:${c.state}:${c.byteLength}:missing=${JSON.stringify(c.missingRanges)}`))}`);
  const stores = createHttpManagedSessionStores({ baseUrl: `http://127.0.0.1:${HTTP}`, sessionKey, writerId: randomUUID() });
  try {
    await stores.journalStore.open({ sessionKey });
    const reader = new ResourceToolResultSegmentStore(stores.toolResultResources);
    for (const c of manifest.contents as any[]) {
      const parts: Buffer[] = [];
      for (let offset = 0; offset < c.byteLength; offset += 1024 * 1024) {
        const range = await reader.readRange({ manifestRef, expectedIdentity: manifest, streamId: c.streamId, offset, length: Math.min(1024 * 1024, c.byteLength - offset) });
        if (range.status !== 'ok') throw new Error(`${c.streamId} @${offset}: ${JSON.stringify(range)}`);
        parts.push(Buffer.from(range.result));
      }
      const bytes = Buffer.concat(parts);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const text = bytes.toString('latin1');
      const shape = key === 'BIG_BG' ? `a=${(text.match(/a/g) ?? []).length} done=${(text.match(/done\n/g) ?? []).length}` : JSON.stringify(text.slice(0, 80));
      L.say(`${key} readback ${c.streamId}`, `${bytes.length} B, sha ${sha === c.digest ? 'matches manifest' : 'MISMATCH'}; ${shape}`);
    }
    await reader.close();
  } catch (e) {
    L.say(`${key} readback`, `error ${String(e).slice(0, 200)}`);
  }
}
process.exit(0);
