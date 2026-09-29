// PR #12868 round 7: the worker dies while a provider call is in flight.
// What the Broker answers for that call afterwards, and what the TypeScript
// Broker client makes of the answer (commit e94f781523 keeps the reason of an
// error that carries details).
// Runs against the macOS rig (the worker is a local process) or against the
// Linux container (BOX=<container>: the probe is on the host, the worker inside).
// usage: ARM=.. DB=.. ports.. [BOX=pr12868-linux MYSQL_PORT=13869 LABEL=durable] node s22-loss-in-flight.mjs <mode v1|v2> <storage letter>
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROOTS, WT, BROKER_URL, BROKER_TOKEN, ARM, attempt, brief, broker, check, createSession, executions,
  holders, loadProvider, openLog, prepareRequest, runtimeSession, say, seedRegistry, sleep, sql, summary, workerPids,
} from './lib.mjs';

const mode = process.argv[2] ?? 'v1';
const letter = process.argv[3] ?? 'a';
const BOX = process.env.BOX;
const LABEL = process.env.LABEL ?? (BOX ? 'linux' : 'macos');
openLog(`s22-loss-in-flight-${ARM}-${LABEL}-${mode}`);
const tag = `N-${mode}`;
const REF_KEYS = ['sessionId', 'promptId', 'callId', 'capabilityDigest', 'policyRevision', 'invocationId', 'argsDigest'];
const answer = (r) => `${r.status}${r.code ? ` ${r.code}` : ''}`;
const held = (id) => holders().some(([, h]) => h === id);
const inBox = (script) => {
  try {
    return execFileSync('docker', ['exec', BOX, 'sh', '-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return String(error.stdout ?? '').trim();
  }
};
const workers = () => (BOX ? inBox("pgrep -f 'managed-runtime-[w]orker'").split('\n').filter(Boolean).map(Number) : workerPids().map((w) => w.pid));
const cwdOf = (sub) => (BOX ? `/rig/roots/${sub}` : fs.realpathSync(path.join(ROOTS, sub)));

const before = new Set(workers());
const where = mode === 'v1'
  ? { harness: await createSession(), cwd: cwdOf('plain') }
  : await (async () => { const ws = `ws-${letter}-${Date.now()}`; seedRegistry(ws, `st-${letter}`); return { harness: await createSession(ws), cwd: cwdOf(`${letter}/child`) }; })();
const mod = await loadProvider();
const provider = new mod.BrokerManagedRuntimeProvider({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const raw = new mod.ManagedRuntimeBrokerClient({ baseUrl: BROKER_URL, token: BROKER_TOKEN });
const runtimeSessionId = randomUUID();
const request = prepareRequest(runtimeSessionId, 'bootstrap', where.cwd);
const client = await provider.getToolV2Client(request, { harnessSessionId: where.harness });
await client.fileHistory.bind({ ownerSessionId: where.harness, ownerRuntimeSessionId: runtimeSessionId, executionCwd: where.cwd, snapshots: [] });
const manifest = await client.manifest();
const identity = (callId) => ({ sessionId: runtimeSessionId, promptId: 'p1', callId, capabilityDigest: manifest.capabilityDigest, policyRevision: manifest.policyRevision });
await client.beginTurn(identity('turn'));
const base = { protocolVersion: 1, harnessSessionId: where.harness, runtimeSessionId };
const marker = `${where.cwd}/n-${runtimeSessionId.slice(0, 6)}.txt`;
const prepared = await client.prepare(identity('n'), 'run_shell_command', { command: `perl -e 'select(undef,undef,undef,20); open(F, ">", $ARGV[0]); print F "done\\n"' ${marker}`, is_background: false });
const reference = Object.fromEntries(REF_KEYS.map((k) => [k, prepared[k]]));
const reserved = await client.prepareExecution(reference);
if (mode === 'v1') await client.confirm(reference, 'proceed_once');
await client.preflight(reference);
const mine = workers().filter((p) => !before.has(p));
const running = attempt(() => client.startExecution(reference, reserved.executionCallId));
await sleep(2500);
const bindingOf = () => {
  const row = sql(`SELECT b.binding_state, b.runtime_generation, b.loss_evidence_json IS NOT NULL FROM qwen_runtime_binding b JOIN qwen_runtime_session s ON s.binding_id=b.binding_id WHERE s.runtime_session_id='${runtimeSessionId}'`)[0];
  return row ? `${row[0]}/gen${row[1]}${row[2] === '1' ? ', loss evidence recorded' : ''}` : 'none';
};
const record = () => executions(runtimeSessionId).map((r) => `${r.state}/${r.status}`).join(',');
say(tag, `${LABEL} | a Shell command that takes 20 s is running | record ${record()} | binding ${bindingOf()} | workers of this Session: ${mine.length}`);
if (BOX) inBox(`kill -9 ${mine.join(' ')}`);
else for (const pid of mine) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
const started = await running;
say(tag, `worker killed | the call the caller was waiting on: ${started.ok ? `${started.value.executionStatus}` : `status=${started.status} code=${started.code} "${started.message}"`}`);

const seen = [];
for (let i = 0; i < 6; i++) {
  const got = await broker('GET', `executions/${reserved.executionCallId}?requestId=${randomUUID()}&harnessSessionId=${where.harness}&runtimeSessionId=${runtimeSessionId}`);
  const line = `${answer(got)} retryable=${got.json?.retryable} "${String(got.json?.error).slice(0, 70)}" details=${JSON.stringify(got.json?.details ?? null).replace(reserved.executionCallId, '<id>')}`;
  if (seen.at(-1)?.line !== line) {
    seen.push({ line, got });
    say(tag, `GET, ${i * 2} s later: ${line} | record ${record()} | binding ${bindingOf()}`);
  }
  if (got.json?.details) break;
  await sleep(2000);
}
const last = seen.at(-1).got;
const viaClient = await attempt(() => raw.getExecution(runtimeSessionId, where.harness, reserved.executionCallId, undefined, AbortSignal.timeout(30_000)));
const inspected = await attempt(() => provider.inspectExecution({ harnessSessionId: where.harness, runtimeSessionId, executionCallId: reserved.executionCallId }));
say(tag, `the TypeScript Broker client, same request: ${viaClient.ok ? 'answered' : `status=${viaClient.status} code=${viaClient.code} message="${viaClient.message}"`}`);
say(tag, `the provider's inspection: ${inspected.ok ? JSON.stringify(inspected.value) : brief(inspected).slice(0, 160)}`);
const again = await attempt(() => client.startExecution(reference, reserved.executionCallId));
const release = await broker('POST', `tool-sessions/${runtimeSessionId}:release`, { protocolVersion: 1, requestId: randomUUID(), harnessSessionId: where.harness });
await sleep(21_000);
const content = BOX ? inBox(`cat ${marker} 2>/dev/null`) : fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
const written = String(content.length > 0);
const times = content.split('\n').filter((l) => l === 'done').length;
say(tag, `start sent again: ${again.ok ? again.value.executionStatus : `status=${again.status} code=${again.code}`} | the command's file after 21 s more: written=${written}${written === 'true' ? `, ${times} time${times === 1 ? '' : 's'}` : ''} | release ${answer(release)}${release.status === 200 ? '' : ` "${String(release.json?.error).slice(0, 80)}"`} | Session ${runtimeSession(runtimeSessionId)?.state} | record ${record()}${mode === 'v2' ? ` | storage held=${held(runtimeSessionId)}` : ''}`);
const terminal = last.json?.details?.terminal === true;
if (written === 'true') say(tag, 'OBSERVED: the process of the command outlived the worker that started it and finished its work; the call was not started a second time');
say(tag, `OBSERVED: the Broker's answer ${terminal ? `is terminal (reason ${last.json.details.reason})` : 'carries no details; the record is not sealed'}; the client's message ${viaClient.ok ? 'n/a' : /\. .+/.test(viaClient.message) ? 'carries the reason' : 'carries no reason'}`);
check(`${tag}.1`, 'the call is not started a second time: start sent again is refused, the effect happens at most once', times <= 1 && !again.ok, `written ${times} time(s), start again ${again.ok ? again.value.executionStatus : `${again.status} ${again.code}`}`);
check(`${tag}.4`, 'while the outcome is unknown the Session is not released and its storage is not given away', release.status !== 200 && runtimeSession(runtimeSessionId)?.state !== 'RELEASED' && (mode !== 'v2' || held(runtimeSessionId)), `release ${answer(release)}`);
check(`${tag}.2`, 'the Broker client keeps the reason the Broker gave, with or without details', !viaClient.ok && viaClient.message.includes(String(last.json?.error)), viaClient.ok ? 'answered' : viaClient.message);
check(`${tag}.3`, 'the provider reads a terminal answer as terminal', !terminal || (inspected.ok && inspected.value.outcome === 'unknown' && inspected.value.terminal === true && inspected.value.reason === 'runtime_lost'), inspected.ok ? JSON.stringify(inspected.value) : brief(inspected).slice(0, 120));
const ok = summary();
provider.dispose();
void WT; void pathToFileURL;
process.exit(ok ? 0 : 1);
