// R6 (round 2, R1-4): command identities through both commit paths, each in a
// fresh local Session. Records the outcome, the body files left behind, and,
// when the commit landed, whether the Session reopens. The differential
// question: does the new preflight refuse anything the old head committed and
// could reopen? And does the old head leak a body for what both refuse?
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ARM, FIXTURES, RefMapper, SP, attempt, enableMonitorRun, localCounts,
  openLog, openSession, say,
} from './lib.mjs';

openLog(`r6-identity-${ARM}`);
enableMonitorRun();
const D = 'd'.repeat(64);
const VARIANTS = [
  ['control', {}],
  ['commandId control char', { commandId: 'goal\u0001x' }],
  ['commandId 512 bytes', { commandId: 'a'.repeat(512) }],
  ['commandId 513 bytes', { commandId: 'a'.repeat(513) }],
  ['commandId NFD', { commandId: 'café' }],
  ['commandId lone surrogate', { commandId: 'x\ud800' }],
  ['commandId empty', { commandId: '' }],
  ['operation 4096 bytes', { operation: 'o'.repeat(4096) }],
  ['operation 4097 bytes', { operation: 'o'.repeat(4097) }],
  ['operation control char', { operation: 'set\u0007Goal' }],
  ['operation empty', { operation: '' }],
  ['contentDigest uppercase', { contentDigest: 'D'.repeat(64) }],
  ['contentDigest 63 hex', { contentDigest: 'd'.repeat(63) }],
  ['contentDigest non-hex', { contentDigest: 'z'.repeat(64) }],
];

async function one(path, name, patch) {
  const sessionId = randomUUID();
  const runtimeBaseDir = fs.mkdtempSync(`${SP}/rig/tmp/r6-`);
  const { session, sessionKey } = await openSession({
    sessionId,
    writerId: 'r6',
    create: true,
    local: true,
    runtimeBaseDir,
  });
  const command = {
    operation: path === 'domain' ? 'setGoal' : 'commitMonitorRun',
    commandId: path === 'domain' ? 'goal:1' : 'monitor-1:1',
    sessionKey,
    contentDigest: D,
    ...patch,
  };
  let kind;
  let result;
  if (path === 'domain') {
    kind = 'managed-goal_state';
    result = await attempt(() =>
      session.authority.commitDomainRecord(
        command,
        { domain: 'goal_state', content: { goalId: 'goal-1', title: 't' } },
        { class: 'trusted_entry' },
      ),
    );
  } else {
    kind = 'managed-monitor_run';
    const refs = new RefMapper(session.resources);
    const record = await refs.remap(FIXTURES.monitorChainCases[0].revisions[0].monitorRun);
    result = await attempt(() =>
      session.authority.commitExtensionRecord(
        command,
        { domain: 'monitor_run', record },
        { class: 'trusted_entry' },
      ),
    );
  }
  const bodies = localCounts(runtimeBaseDir, sessionId)[kind] ?? 0;
  await attempt(() => session.close());
  let reopen = '-';
  if (result === 'committed') {
    reopen = await attempt(async () => {
      const again = await openSession({ sessionId, writerId: 'r6b', local: true, runtimeBaseDir });
      await again.session.close();
    });
    reopen = reopen === 'committed' ? 'reopens' : reopen;
  }
  const line = { arm: ARM, path, name, result, bodies, reopen };
  say('CASE', line);
  return line;
}

const out = [];
for (const path of ['domain', 'extension']) {
  for (const [name, patch] of VARIANTS) out.push(await one(path, name, patch));
}
fs.writeFileSync(`${SP}/rig/out/r6-identity-${ARM}.json`, JSON.stringify(out, null, 2));
say('RESULT', { arm: ARM, cases: out.length });
