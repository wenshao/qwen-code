// S19 (real OSS): turn on bucket versioning, then (a) read a range of an
// existing publication and (b) run a new O2 Shell turn.
// env: DB, TAG (of an earlier s1 run), ST (storage for the new turn)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
import { fakeToolCall, startFakeOpenAIServer } from '/Users/wenshao/git/qwen-code-pr12894/integration-tests/fake-openai-server.ts';

const DB = process.env.DB ?? 'o3a', HTTP = 18894, BPORT = 19894, PROXY = 18895;
const TAG = process.env.TAG ?? 'rov';
const ST = process.env.ST ?? 's25';
L.openLog(`s19-${TAG}`);
const saved = JSON.parse(fs.readFileSync(`${L.RIG}/out/s1-${TAG}.json`, 'utf8'));
const { sessionId, ws, pub, resp } = saved;
const RO = `${L.SP}/realoss`;
const bucket = fs.readFileSync(`${RO}/bucket.txt`, 'utf8').trim();
const oss = (...args: string[]) => execFileSync(`${process.env.HOME}/Install/jdk21/bin/java`, ['-Dhttps.proxyHost=', '-Dhttp.proxyHost=', '-cp', `${RO}/out:${RO}/lib/*`, 'RealOss', ...args], { encoding: 'utf8' }).split('\n').filter((l) => l && !/SLF4J|Commons Logging/.test(l)).join(' | ');
const w = await L.acquireWriter(HTTP, ws, sessionId);
L.say("writer", `acquire ${w.status}`);
const b = JSON.parse(L.sql(DB, `SELECT binding_json FROM qwen_tool_publication WHERE publication_id='${pub.id}'`)[0][0]);
const expectedIdentity = {
  tenantId: b.sessionKey.tenantId, sessionId: b.sessionKey.sessionId, turnId: b.turnId, executionCallId: b.executionCallId,
  callId: b.reference.callId, invocationDigest: b.reference.argsDigest, bindingGeneration: b.bindingGeneration, captureId: b.captureId, revision: 1,
};
const read = async (label: string) => {
  const rr = await L.readRange(HTTP, ws, sessionId, pub.id, w.token, { manifestRef: resp.manifestRef, expectedIdentity, streamId: 'stdout', offset: 1000, length: 4096 });
  const ok = rr.status === 200 && rr.bytes.equals(L.genSlice(TAG, 'stdout', 1000, 4096));
  L.say(label, `-> ${rr.status} ${ok ? 'EXACT' : String(rr.text ?? '').slice(0, 200)}`);
};
await read('range read, bucket unversioned');
L.say('bucket', oss('versioning', bucket, 'Enabled'));
await read('range read, versioning Enabled');
L.say('catalog after read', JSON.stringify(L.publications(DB, sessionId).map((p: any) => ({ state: p.state, phase: p.phase, quarantined: p.quarantined }))));
if (process.env.READ_ONLY === "1") process.exit(0);
// (b) a new Shell turn while versioning is on
const model = await startFakeOpenAIServer(async ({ body }) => {
  const messages = body['messages'] as Array<{ role: string; content: unknown }>;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  if (!messages.slice(lastUser + 1).some((x) => x.role === 'tool'))
    return { toolCalls: [fakeToolCall('run_shell_command', { command: `echo versioned-${TAG}; head -c 2000000 /dev/zero | tr '\\0' y; echo` }, `call-${TAG}-v`)] };
  return { content: `done ${TAG}` };
});
const h = await new L.Harness({ name: `s19-${TAG}`, modelUrl: model.baseUrl, brokerUrl: `http://127.0.0.1:${BPORT}` }).start();
process.on('exit', () => { try { h.child?.kill('SIGKILL'); } catch {} });
const ws2 = `ws-${ST}`;
if (L.sql(DB, `SELECT COUNT(*) FROM managed_workspace_registry WHERE workspace_id='${ws2}'`)[0][0] === '0') L.seedRegistry(DB, ws2, `st-${ST}`);
const sid2 = await L.createWorkspaceSession(HTTP, ws2);
const s = new L.HSession(h, sid2, { ...L.storeConnection(h, ws2, HTTP), baseUrl: `http://127.0.0.1:${PROXY}` });
await s.create();
const t0 = Date.now();
const r = await s.prompt(`[[${TAG}]] run`, 600_000).catch((e: any) => ({ terminal: [], err: String(e) }));
L.say('new turn, versioning Enabled', `${L.summarizeTurn(r)} (${Date.now() - t0} ms)`);
L.say('new publication', JSON.stringify(L.publications(DB, sid2).map((p: any) => ({ state: p.state, phase: p.phase, quarantined: p.quarantined }))));
L.say('status', JSON.stringify(await s.status()));
L.say('harness', h.log().split('\n').filter((l: string) => /fail|block|error|versio/i.test(l)).map((l: string) => l.slice(0, 220)).slice(0, 6));
await h.stop();
process.exit(0);
