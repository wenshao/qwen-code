// R8 (round 2, header cap a9aa10e1): a real local Managed Session log, its
// header line padded with whitespace (between "uuid" and its colon, the way
// the PR's unit test pads the fixture) to a given byte length, reopened by
// the arm under test.
//   PHASE=write  : the writer arm creates the Session, commits one goal_state
//                  envelope, closes, and makes padded copies.
//   PHASE=reopen : the arm under test reopens each copy.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ARM, SP, attempt, openLog, openSession, say } from './lib.mjs';

const PHASE = process.env.PHASE;
const STATE = `${SP}/rig/out/r8-state.json`;
const SIZES = [65_536, 65_537, 200_000];
openLog(`r8-header-cap-${ARM}-${PHASE}`);

if (PHASE === 'write') {
  const sessionId = randomUUID();
  const dir = fs.mkdtempSync(`${SP}/rig/tmp/r8-`);
  const { session, sessionKey } = await openSession({
    sessionId, writerId: 'r8', create: true, local: true, runtimeBaseDir: dir,
  });
  await session.authority.commitDomainRecord(
    { operation: 'setGoal', commandId: 'goal:1', sessionKey, contentDigest: 'd'.repeat(64) },
    { domain: 'goal_state', content: { goalId: 'goal-1', title: 't' } },
    { class: 'trusted_entry' },
  );
  await session.close();
  const copies = {};
  for (const size of SIZES) {
    const copy = `${dir}-h${size}`;
    execFileSync('cp', ['-R', dir, copy]);
    const file = `${copy}/session.jsonl`;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes('"subtype":"managed_session_header_v1"'));
    if (at < 0) throw new Error('no header line');
    const before = Buffer.byteLength(lines[at], 'utf8');
    if (lines[at].split('"uuid":').length !== 2) throw new Error('uuid anchor');
    lines[at] = lines[at].replace('"uuid":', `"uuid"${' '.repeat(size - before)}:`);
    const after = Buffer.byteLength(lines[at], 'utf8');
    if (after !== size) throw new Error(`padded to ${after}, wanted ${size}`);
    fs.writeFileSync(file, lines.join('\n'));
    copies[size] = copy;
    say('copy', { size, headerLine: at + 1, before, after });
  }
  fs.writeFileSync(STATE, JSON.stringify({ sessionId, dir, copies }));
} else if (PHASE === 'reopen') {
  const { sessionId, dir, copies } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const results = {};
  for (const [label, path] of [['unpadded', dir], ...SIZES.map((s) => [String(s), copies[s]])]) {
    // Each reopen gets its own throwaway copy so a reopen cannot change the next.
    const probe = `${path}-reopen-${ARM}-${randomUUID().slice(0, 6)}`;
    execFileSync('cp', ['-R', path, probe]);
    const r = await attempt(async () => {
      const again = await openSession({ sessionId, writerId: 'r8b', local: true, runtimeBaseDir: probe });
      const goal = again.session.authority.sessionHeader ? 'header ok' : 'no header';
      await again.session.close();
      return goal;
    });
    results[label] = r === 'committed' ? 'reopens' : r;
    say('reopen', { arm: ARM, header: label, outcome: results[label] });
  }
  say('RESULT', { arm: ARM, results });
} else if (PHASE === 'read') {
  // The reader path: readManagedSessionLog, which the message projection uses
  // to serve a Session's transcript, scans the file without a writer lease.
  const { CORE } = await import('./lib.mjs');
  const { readManagedSessionLog } = await import(`${CORE}/managed-session-authority.js`);
  const { sessionId, dir, copies } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const sessionKey = { tenantId: 't-rig13345', workspaceId: 'ws-rig', sessionId };
  const results = {};
  for (const [label, path] of [['unpadded', dir], ...SIZES.map((s) => [String(s), copies[s]])]) {
    let outcome;
    try {
      const scan = await readManagedSessionLog(`${path}/session.jsonl`, sessionKey);
      outcome = `read: committed=${scan.committed} header=${scan.header ? 'yes' : 'no'}`;
    } catch (error) {
      outcome = `${error.name}: ${String(error.message).slice(0, 100)}`;
    }
    results[label] = outcome;
    say('read', { arm: ARM, header: label, outcome });
  }
  say('RESULT', { arm: ARM, phase: 'read', results });
} else {
  throw new Error('PHASE=write|reopen|read');
}
