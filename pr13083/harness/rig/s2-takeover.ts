// S2: owner failover of a parked tool Turn, re-implemented independently of the PR's runner, with
// extra oracles (file-system watcher, Broker/Harness request ledgers, journal and lease rows) and
// optional fault injection on the replacement owner.
// usage: tsx s2-takeover.ts <label> <inflight|continuation|first-round> [fault]
//   fault: none | drop-load-reply | drop-continue-reply | cut-stream | start-fail-once |
//          start-fail-always | load-503-once | cancel
import { existsSync, readFileSync, rmSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { createRig, freePort, ms, sleep, type TapInfo, type TapAction } from './stack.js';

const label = process.argv[2] ?? 's2';
const mode = (process.argv[3] ?? 'inflight') as 'inflight' | 'continuation' | 'first-round';
const fault = process.argv[4] ?? 'none';
const waitMs = Number(process.env['RIG_WAIT_MS'] ?? 60_000);
if (process.platform !== 'linux') throw new Error('S2 needs Linux (durable local-Worker reclaim)');

const MARKER = 'RIG_S2_TAKEOVER';
const FILE = 'rig-side-effect.txt';
const CONTENT = 'RIG_TOOL_EXECUTED\n';
const PARTIAL = 'DEAD_OWNER_PARTIAL ';
const ANSWER = 'REPLACEMENT_ANSWER';
const SECOND = 'RIG_S2_SECOND_SESSION';

const rig = await createRig({ label, workspace: true, durable: true });
let failure: unknown;
try {
  let replacementLive = false;
  let releaseDead = () => {};
  const deadHold = new Promise<void>((resolve) => (releaseDead = resolve));
  let releaseLate = () => {};
  const lateHold = new Promise<void>((resolve) => (releaseLate = resolve));
  await rig.startModel(({ body }) => {
    const text = JSON.stringify(body['messages']);
    const hasToolResult = text.includes('"role":"tool"');
    if (text.includes(SECOND)) {
      if (!hasToolResult)
        return {
          toolCalls: [
            rig.fakeToolCall('write_file', { file_path: 'second-session.txt', content: 'SECOND\n' }, 'call_rig_second'),
          ],
        };
      return { content: 'SECOND_SESSION_OK' };
    }
    if (mode === 'first-round') {
      if (!replacementLive)
        return { contentChunks: [PARTIAL, 'never sent'], holdAfterChunks: 1, holdUntil: deadHold };
      return { content: ANSWER };
    }
    if (!hasToolResult)
      return {
        toolCalls: [rig.fakeToolCall('write_file', { file_path: FILE, content: CONTENT }, 'call_rig_s2')],
      };
    if (mode === 'continuation' && !replacementLive)
      return { contentChunks: [PARTIAL, 'never sent'], holdAfterChunks: 1, holdUntil: deadHold };
    // The replacement's answer is streamed in two chunks so a fault can land mid-answer.
    if (fault === 'cut-stream')
      return { contentChunks: ['REPLACEMENT_', 'ANSWER'], holdAfterChunks: 1, holdUntil: lateHold };
    return { content: ANSWER };
  });

  const sideEffect = path.join(rig.workspaceMount, FILE);
  const fsLedger: string[] = [];
  const watcher = watch(rig.workspaceMount, (eventType, filename) => {
    fsLedger.push(`${ms()}ms ${eventType} ${filename ?? ''}`);
  });

  // ---- owner A ----
  const harnessPortA = await freePort();
  const springA2 = await rig.startSpring('A', { harnessUrl: `http://127.0.0.1:${harnessPortA}` });
  const brokerTapA = await rig.tap(
    'harnessA->brokerA',
    `http://127.0.0.1:${springA2.brokerPort}`,
    ({ method, path: p }: TapInfo): TapAction =>
      mode === 'inflight' && method === 'POST' && p.includes('/executions/') && p.endsWith(':start')
        ? 'hold'
        : 'pass',
  );
  const harnessA = await rig.startHarness('A', { port: harnessPortA, brokerUrl: brokerTapA.baseUrl });

  const session = await rig.createSession(
    springA2.url,
    `${MARKER}. Execute the requested tool once and reply exactly ${ANSWER}.`,
  );
  const filter = rig.sessionFilter(session.id);
  const executionRows = () =>
    rig
      .sql(
        `SELECT execution_call_id, execution_state, dispatch_generation, IF(result_json IS NULL,0,1) FROM qwen_managed_agent.qwen_tool_execution`,
      )
      .split('\n')
      .filter(Boolean)
      .map((row) => row.split('\t'));
  const leaseRow = () =>
    rig.sql(
      `SELECT IFNULL(holder_key,'NULL'), IFNULL(runtime_session_id,'NULL') FROM qwen_managed_agent.managed_workspace_execution_lease`,
    );
  const turnRow = () =>
    rig
      .sql(
        `SELECT status, IFNULL(error_code,'-'), retry_count, submission_attempted FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`,
      )
      .split('\t');
  const publicText = async (springUrl: string) =>
    (await rig.events(springUrl, session.id, 0))
      .filter((e) => e.type === 'item.output_text.delta')
      .map((e) => String(e.data?.['text'] ?? ''));

  // ---- park the Turn ----
  if (mode === 'inflight') {
    await rig.until('held :start', () => brokerTapA.log.some((e) => e.line.includes('held')), 180_000);
  } else {
    await rig.until(
      'dead owner partial text is public',
      async () => (await publicText(springA2.url)).join('').includes(PARTIAL.trim()),
      180_000,
    );
  }
  const before = {
    executions: executionRows(),
    sideEffectExists: existsSync(sideEffect),
    sideEffectStat: existsSync(sideEffect)
      ? (({ ino, mtimeNs, ctimeNs }) => `${ino}/${mtimeNs}/${ctimeNs}`)(statSync(sideEffect, { bigint: true }))
      : null,
    publicText: await publicText(springA2.url),
    publicEventTypes: (await rig.events(springA2.url, session.id, 0)).map((e) => e.type),
    checkpoint: rig.sql(
      `SELECT IFNULL(latest_checkpoint_resource_id,'NULL') FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
    ),
    lease: leaseRow(),
    turn: turnRow(),
    fsEvents: fsLedger.length,
  };
  const bootA = rig.sql(`SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${filter}`);

  // ---- crash owner A: the Harness process tree and only the JVM of Spring (worker survives) ----
  const crashedAt = ms();
  await Promise.all([rig.kill9(harnessA, true), rig.kill9(springA2, false)]);
  replacementLive = true;
  releaseDead();
  await brokerTapA.close();
  rmSync(harnessA.home!, { recursive: true, force: true });
  rmSync(springA2.home!, { recursive: true, force: true });
  await rig.until(
    'writer lease expiry',
    () =>
      rig.sql(
        `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
      ) === '1',
    15_000,
  );
  await rig.until(
    'dispatch lease expiry',
    () =>
      rig.sql(
        `SELECT IF(dispatch_lease_until IS NULL OR dispatch_lease_until < UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, 0) FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`,
      ) === '1',
    15_000,
  );

  // ---- owner B behind taps ----
  const harnessPortB = await freePort();
  let loads = 0;
  let continues = 0;
  let starts = 0;
  const coordinatorTap = await rig.tap(
    'coordinatorB->harnessB',
    `http://127.0.0.1:${harnessPortB}`,
    ({ method, path: p }: TapInfo): TapAction => {
      if (method === 'POST' && p.endsWith('/load')) {
        loads += 1;
        if (fault === 'drop-load-reply' && loads === 1) return 'drop-reply';
        if (fault === 'load-lost-once' && loads === 1) return 'drop-request';
      }
      if (method === 'POST' && p.endsWith('/managed-runtime/continue')) {
        continues += 1;
        if (fault === 'drop-continue-reply' && continues === 1) return 'drop-reply';
      }
      return 'pass';
    },
  );
  const springB = await rig.startSpring('B', { harnessUrl: coordinatorTap.baseUrl });
  const brokerTapB = await rig.tap(
    'harnessB->brokerB',
    `http://127.0.0.1:${springB.brokerPort}`,
    ({ method, path: p }: TapInfo): TapAction => {
      if (method === 'POST' && p.includes('/executions/') && p.endsWith(':start')) {
        starts += 1;
        if (fault === 'start-fail-once' && starts === 1) return 'drop-request';
        if (fault === 'start-fail-always') return 'drop-request';
      }
      return 'pass';
    },
  );
  let cancelPost: { status: number; body: string } | undefined;
  if (fault === 'cancel') {
    const turnId = rig.sql(`SELECT turn_id FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`);
    const response = await fetch(`${springB.url}/v1/agents/sessions/${session.id}/events`, {
      method: 'POST',
      headers: rig.headers({ 'content-type': 'application/json', 'idempotency-key': `cancel-${Date.now()}` }),
      body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
    });
    cancelPost = { status: response.status, body: (await response.text()).slice(0, 300) };
  }
  const harnessB = await rig.startHarness('B', { port: harnessPortB, brokerUrl: brokerTapB.baseUrl });
  void harnessB;
  const replacementReadyAt = ms();

  if (fault === 'cut-stream') {
    await rig.until(
      'replacement answer in flight',
      async () => (await publicText(springB.url)).join('').includes('REPLACEMENT_'),
      waitMs,
    );
    await sleep(300);
    coordinatorTap.cutStreams();
    await sleep(500);
    releaseLate();
  }

  const terminal = await rig.waitTerminal(springB.url, session.id, 0, waitMs);
  const settledAt = ms();
  // Let any late duplicate effect or duplicate model call show up before the ledgers are read.
  await sleep(2500);
  watcher.close();
  const leaseAfterTurn = leaseRow();
  const executionsAfterTurn = executionRows();
  const countersAtTurnEnd = { loads, continues, replacementStarts: starts };
  const brokerLedgerAtTurnEnd = brokerTapB.log.length;
  const coordinatorLedgerAtTurnEnd = coordinatorTap.log.length;
  const fsEventsAtTurnEnd = fsLedger.length;
  const statAtTurnEnd = existsSync(sideEffect)
    ? (({ ino, mtimeNs, ctimeNs }) => `${ino}/${mtimeNs}/${ctimeNs}`)(statSync(sideEffect, { bigint: true }))
    : null;

  // Is the Workspace usable by another Session once the taken-over Turn is over?
  let secondSession: Record<string, unknown> | undefined;
  if (terminal && process.env['RIG_SECOND'] !== '0') {
    const startedSecond = ms();
    try {
      const second = await rig.createSession(
        springB.url,
        `${SECOND}. Execute the requested tool once and reply exactly SECOND_SESSION_OK.`,
      );
      const secondTerminal = await rig.waitTerminal(springB.url, second.id, 0, 45_000);
      const secondEvents = await rig.events(springB.url, second.id, 0);
      secondSession = {
        terminal: secondTerminal?.type ?? 'NONE within 45000 ms',
        terminalData: secondTerminal?.data,
        ms: ms() - startedSecond,
        text: secondEvents
          .filter((e) => e.type === 'item.output_text.delta')
          .map((e) => String(e.data?.['text'] ?? ''))
          .join(''),
        fileWritten: existsSync(path.join(rig.workspaceMount, 'second-session.txt')),
        turn: rig
          .sql(
            `SELECT status, IFNULL(error_code,'-'), retry_count FROM qwen_managed_agent.managed_agent_turn WHERE ${rig.sessionFilter(second.id)}`,
          )
          .split('\t'),
        leaseAfter: leaseRow(),
      };
    } catch (error) {
      secondSession = { error: String(error).slice(0, 400) };
    }
  }
  const requests = rig.modelRequests().map(({ body }) => JSON.stringify(body['messages']));
  const mine = requests.filter((text) => text.includes(MARKER));
  const events = await rig.events(springB.url, session.id, 0);
  const deltas = events.filter((e) => e.type === 'item.output_text.delta');
  const bootB = rig.sql(`SELECT harness_boot_id FROM qwen_managed_agent.managed_agent_session WHERE ${filter}`);
  const result = {
    label,
    mode,
    fault,
    platform: `${process.platform} ${process.arch}`,
    db: rig.dbVersion,
    beforeCrash: before,
    terminal: terminal?.type ?? `NONE within ${waitMs} ms`,
    terminalData: terminal?.data,
    msReplacementReadyToTerminal: terminal ? settledAt - replacementReadyAt : null,
    msCrashToTerminal: terminal ? settledAt - crashedAt : null,
    after: {
      executions: executionsAfterTurn,
      sameExecutionCallId:
        before.executions[0]?.[0] !== undefined &&
        executionsAfterTurn.length === 1 &&
        executionsAfterTurn[0]?.[0] === before.executions[0]?.[0],
      modelRequestsInitial: mine.filter((text) => !text.includes('"role":"tool"')).length,
      modelRequestsWithToolResult: mine.filter((text) => text.includes('"role":"tool"')).length,
      sideEffect: existsSync(sideEffect) ? readFileSync(sideEffect, 'utf8') : null,
      sideEffectStat: statAtTurnEnd,
      fsEventsTotal: fsEventsAtTurnEnd,
      fsEventsAfterCrash: fsEventsAtTurnEnd - before.fsEvents,
      fsLedger: fsLedger.slice(0, fsEventsAtTurnEnd),
      publicTextDeltas: deltas.map((e) => String(e.data?.['text'] ?? '')),
      publicText: deltas.map((e) => String(e.data?.['text'] ?? '')).join(''),
      publicEventTypes: events.map((e) => e.type),
      terminalEventsInStore: rig.sql(
        `SELECT COUNT(*) FROM qwen_managed_agent.managed_agent_event WHERE ${filter} AND terminal=TRUE`,
      ),
      turn: turnRow(),
      lease: leaseAfterTurn,
      harnessBoot: `${bootA} -> ${bootB}`,
      journalHead: rig.sql(
        `SELECT writer_generation, journal_revision, committed_sequence FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
      ),
    },
    cancelPost,
    secondSessionOnSameWorkspace: secondSession,
    counters: countersAtTurnEnd,
    coordinatorToHarnessB: coordinatorTap.log
      .slice(0, coordinatorLedgerAtTurnEnd)
      .filter((e) => !/heartbeat|capabilities/.test(e.line))
      .map((e) => `${e.t}ms ${e.line.replace('[coordinatorB->harnessB] ', '').slice(0, 330)}`),
    harnessBToBroker: brokerTapB.log.slice(0, brokerLedgerAtTurnEnd).map(
      (e) => `${e.t}ms ${e.line.replace('[harnessB->brokerB] ', '').replace(/runtime-sessions\/[^/]+/, 'runtime-sessions/<rs>').slice(0, 200)}`,
    ),
    harnessAToBroker: brokerTapA.log.map(
      (e) => `${e.t}ms ${e.line.replace('[harnessA->brokerA] ', '').replace(/runtime-sessions\/[^/]+/, 'runtime-sessions/<rs>').slice(0, 160)}`,
    ),
  };
  rig.save('result.json', result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  await rig.cleanup();
}
if (failure) process.exit(1);
