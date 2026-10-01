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
const COLD = 'RIG_S2_COLD_TURN';
const code = (body: string) => (/"code":"([a-z_]+)"/.exec(body) ?? [])[1] ?? '';

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
    if (text.includes(COLD)) return { content: 'COLD_TURN_OK' };
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
    // Optional second tool round after the parked one (RIG_SECOND_TOOL=1).
    if (process.env['RIG_SECOND_TOOL'] === '1' && replacementLive && !text.includes('call_rig_s2_second'))
      return {
        toolCalls: [
          rig.fakeToolCall('write_file', { file_path: 'rig-second-round.txt', content: 'SECOND_ROUND\n' }, 'call_rig_s2_second'),
        ],
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
  let takeoverLoadBody = '';
  let starts = 0;
  const coordinatorTap = await rig.tap(
    'coordinatorB->harnessB',
    `http://127.0.0.1:${harnessPortB}`,
    (info: TapInfo): TapAction => {
      const { method, path: p } = info;
      if (method === 'POST' && p.endsWith('/load')) {
        loads += 1;
        if (!takeoverLoadBody) takeoverLoadBody = info.body;
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

  // File history (#13110) of the taken-over Turn, read and undone on the replacement Harness.
  let fileHistory: Record<string, unknown> | undefined;
  if (terminal && process.env['RIG_FILE_HISTORY'] === '1') {
    try {
      const harnessUrl = `http://127.0.0.1:${harnessPortB}`;
      const auth = { authorization: `Bearer ${rig.harnessToken}` };
      const caps = (await (await fetch(`${harnessUrl}/capabilities`, { headers: auth })).json()) as {
        hostedHarness?: { bootId?: string };
      };
      const loadLine = coordinatorTap.log.find((e) => /\/load #\d+ -> (upstream )?200/.test(e.line))?.line ?? '';
      const clientId = (/"clientId":"([0-9a-f-]{36})"/.exec(loadLine) ?? [])[1];
      const headers = {
        ...auth,
        'content-type': 'application/json',
        'x-qwen-harness-protocol-version': '1',
        'x-qwen-harness-boot-id': String(caps.hostedHarness?.bootId),
        ...(clientId ? { 'x-qwen-client-id': clientId } : {}),
      };
      const promptId = rig.sql(`SELECT prompt_id FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`);
      const historyResponse = await fetch(`${harnessUrl}/session/${session.id}/files/history`, { headers });
      const historyBody = (await historyResponse.json()) as { history?: Record<string, unknown> | null };
      const h = historyBody.history as
        | { pendingTurn?: unknown; pendingUndo?: unknown; state?: { snapshots?: { promptId: string }[]; files?: Record<string, unknown> } }
        | null
        | undefined;
      const before = existsSync(sideEffect) ? readFileSync(sideEffect, 'utf8') : null;
      const rewind = await fetch(`${harnessUrl}/session/${session.id}/files/rewind`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ promptId, requestId: crypto.randomUUID() }),
      });
      const rewindBody = (await rewind.text()).slice(0, 300);
      fileHistory = {
        clientIdFound: Boolean(clientId),
        historyStatus: historyResponse.status,
        pendingTurn: h?.pendingTurn ?? null,
        pendingUndo: h?.pendingUndo ?? null,
        snapshotPrompts: (h?.state?.snapshots ?? []).map((x) => (x.promptId === promptId ? 'taken-over prompt' : x.promptId)),
        trackedFiles: Object.keys(h?.state?.files ?? {}),
        undoStatus: rewind.status,
        undoBody: rewindBody,
        fileBeforeUndo: before,
        fileAfterUndo: existsSync(sideEffect) ? readFileSync(sideEffect, 'utf8') : null,
      };
    } catch (error) {
      fileHistory = { error: String(error).slice(0, 300) };
    }
  }
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
  // Cold load of the finished Session by a fresh Harness, as after a Harness restart or the next owner change.
  let coldLoad: Record<string, unknown> | undefined;
  if (terminal && process.env['RIG_COLD_LOAD'] === '1' && takeoverLoadBody) {
    try {
      await rig.kill9(harnessB, true);
      await rig.until(
        'writer lease expiry after stopping harness B',
        () =>
          rig.sql(
            `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
          ) === '1',
        30_000,
      );
      const harnessC = await rig.startHarness('C', { brokerUrl: `http://127.0.0.1:${springB.brokerPort}` });
      const auth = { authorization: `Bearer ${rig.harnessToken}` };
      let caps: { hostedHarness?: { bootId?: string } } = {};
      await rig.until(
        'harness C runtime routes',
        async () => {
          caps = (await (await fetch(`${harnessC.url}/capabilities`, { headers: auth })).json()) as typeof caps;
          const probe = await fetch(`${harnessC.url}/session/00000000-0000-4000-8000-000000000000/status`, { headers: auth });
          return caps.hostedHarness?.bootId !== undefined && (await probe.text()) !== 'Not Found';
        },
        60_000,
      );
      const base = JSON.parse(takeoverLoadBody) as Record<string, unknown> & { managedSessionStore: Record<string, unknown> };
      delete base['driveRuntimeRecovery'];
      delete base['passiveManagedRuntimeRecovery'];
      const loadOnce = async (extra: Record<string, unknown>) => {
        const response = await fetch(`${harnessC.url}/session/${session.id}/load`, {
          method: 'POST',
          headers: {
            ...auth,
            'content-type': 'application/json',
            'x-qwen-harness-protocol-version': '1',
            'x-qwen-harness-boot-id': String(caps.hostedHarness?.bootId),
          },
          body: JSON.stringify({ ...base, managedSessionStore: { ...base.managedSessionStore, writerId: caps.hostedHarness?.bootId }, ...extra }),
        });
        return `${response.status} ${(await response.text()).slice(0, 140)}`;
      };
      coldLoad = {
        plainLoad: await loadOnce({}),
        takeoverLoad: await loadOnce({ driveRuntimeRecovery: true }),
      };
    } catch (error) {
      coldLoad = { error: String(error).slice(0, 300) };
    }
  }
  // Next Turn of the same Session through the public API after Harness B restarts (new boot id, so the coordinator loads).
  let coldTurn: Record<string, unknown> | undefined;
  if (terminal && process.env['RIG_COLD_TURN'] === '1') {
    try {
      await rig.kill9(harnessB, true);
      await rig.until(
        'writer lease expiry after stopping harness B',
        () =>
          rig.sql(
            `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
          ) === '1',
        30_000,
      );
      const loadsBefore = coordinatorTap.log.length;
      await rig.startHarness('B2', { port: harnessPortB, brokerUrl: brokerTapB.baseUrl });
      const startedCold = ms();
      const posted = await rig.postMessage(springB.url, session.id, `${COLD}. Reply exactly COLD_TURN_OK.`);
      const coldTerminal = await rig.waitTerminal(springB.url, session.id, terminal.sequence, 90_000);
      const coldEvents = await rig.events(springB.url, session.id, terminal.sequence);
      coldTurn = {
        postStatus: posted.status,
        terminal: coldTerminal?.type ?? 'NONE within 90000 ms',
        terminalData: coldTerminal?.data,
        ms: ms() - startedCold,
        text: coldEvents
          .filter((e) => e.type === 'item.output_text.delta')
          .map((e) => String(e.data?.['text'] ?? ''))
          .join(''),
        turns: rig
          .sql(
            `SELECT status, IFNULL(error_code,'-'), retry_count FROM qwen_managed_agent.managed_agent_turn WHERE ${filter} ORDER BY created_at`,
          )
          .split('\n'),
        coordinatorToHarness: coordinatorTap.log
          .slice(loadsBefore)
          .filter((e) => !/ GET /.test(e.line))
          .map((e) => e.line.slice(0, 200)),
      };
    } catch (error) {
      coldTurn = { error: String(error).slice(0, 300) };
    }
  }
  // Next owner change: owner B (Spring + Harness) dies after the taken-over Turn, owner C serves the next Turn.
  let nextOwner: Record<string, unknown> | undefined;
  let eventsBeforeNextOwner: Awaited<ReturnType<typeof rig.events>> | undefined;
  if (terminal && process.env['RIG_NEXT_OWNER'] === '1') {
    try {
      eventsBeforeNextOwner = await rig.events(springB.url, session.id, 0);
      await Promise.all([rig.kill9(harnessB, true), rig.kill9(springB, false)]);
      await rig.until(
        'writer lease expiry after owner B',
        () =>
          rig.sql(
            `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
          ) === '1',
        30_000,
      );
      const harnessPortC = await freePort();
      const tapC = await rig.tap('coordinatorC->harnessC', `http://127.0.0.1:${harnessPortC}`, () => 'pass');
      const springC = await rig.startSpring('C', { harnessUrl: tapC.baseUrl });
      await rig.startHarness('C', { port: harnessPortC, brokerUrl: `http://127.0.0.1:${springC.brokerPort}` });
      const startedNext = ms();
      // Owner C admits Workspace input only once it sees a ready Harness; retry 409s for up to 60 s like a client.
      const postAttempts: string[] = [];
      let posted = { status: 0, body: '' };
      while (ms() - startedNext < 60_000) {
        posted = await rig.postMessage(springC.url, session.id, `${COLD}. Reply exactly COLD_TURN_OK.`);
        postAttempts.push(`${ms() - startedNext}ms ${posted.status} ${code(posted.body)}`);
        if (posted.status !== 409) break;
        await sleep(3000);
      }
      const nextTerminal =
        posted.status < 300 ? await rig.waitTerminal(springC.url, session.id, terminal.sequence, 120_000) : null;
      const nextEvents = await rig.events(springC.url, session.id, terminal.sequence);
      nextOwner = {
        postStatus: posted.status,
        postBody: posted.body.slice(0, 200),
        postAttempts: postAttempts.length > 3 ? [...postAttempts.slice(0, 2), `...`, ...postAttempts.slice(-1)] : postAttempts,
        terminal: nextTerminal?.type ?? (posted.status < 300 ? 'NONE within 120000 ms' : 'not admitted'),
        terminalData: nextTerminal?.data,
        ms: ms() - startedNext,
        text: nextEvents
          .filter((e) => e.type === 'item.output_text.delta')
          .map((e) => String(e.data?.['text'] ?? ''))
          .join(''),
        turns: rig
          .sql(
            `SELECT status, IFNULL(error_code,'-'), retry_count FROM qwen_managed_agent.managed_agent_turn WHERE ${filter} ORDER BY created_at`,
          )
          .split('\n'),
        coordinatorToHarness: tapC.log.filter((e) => !/ GET /.test(e.line)).map((e) => e.line.slice(0, 220)),
      };
    } catch (error) {
      nextOwner = { error: String(error).slice(0, 300) };
    }
  }
  const requests = rig.modelRequests().map(({ body }) => JSON.stringify(body['messages']));
  const mine = requests.filter((text) => text.includes(MARKER));
  const events = eventsBeforeNextOwner ?? (await rig.events(springB.url, session.id, 0));
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
      secondRoundFile: existsSync(path.join(rig.workspaceMount, 'rig-second-round.txt')),
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
    fileHistoryAfterTakeover: fileHistory,
    coldLoadByFreshHarness: coldLoad,
    nextTurnAfterHarnessRestart: coldTurn,
    nextTurnOnNextOwner: nextOwner,
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
