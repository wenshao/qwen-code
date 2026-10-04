// S2: owner failover of a parked tool Turn, re-implemented independently of the PR's runner, with
// extra oracles (file-system watcher, Broker/Harness request ledgers, journal and lease rows) and
// optional fault injection on the replacement owner.
// usage: tsx s2-takeover.ts <label> <inflight|continuation|first-round> [fault]
//   fault: none | drop-load-reply | drop-continue-reply | cut-stream | start-fail-once |
//          start-fail-always | load-503-once | cancel | db-cancel | db-cancel-drop-reply |
//          db-cancel-load-status-fail | db-cancel-history-read-fail | db-cancel-terminal-write-fail |
//          db-cancel-release-fail   (the db-cancel-* faults are round 5, #13173)
//   #13350 additions: db-cancel-drop-load-reply (passive takeover, first load reply lost) |
//          slow-load (no proxy fault: the replacement's :start is delayed past a short coordinator
//          request timeout, RIG_REQ_TIMEOUT / RIG_START_DELAY_MS).
//   env RIG_ACQUIRE_FAIL_NTH=n (+RIG_ACQUIRE_FAIL_COUNT, RIG_ACQUIRE_FAIL_KIND=503|drop-request):
//          fail the n-th Broker B tool-sessions:acquire (the redrive's re-acquire is n=2).
//   env RIG_PROBE=1: after the dropped first load reply, hold the coordinator's first redrive
//          RIG_PROBE_DELAY_MS and fire direct loads at Harness B (3 concurrent identical
//          redrives, a flag-less load, a create).
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
    if (fault === 'cut-stream' || process.env['RIG_LATE_LOAD'] === '1')
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
        ? // RIG_INFLIGHT_SETTLED=1: the execution runs and settles on the Broker, but owner A never
          // learns it (its checkpoint item stays in_progress) — the Broker then holds no active operation.
          process.env['RIG_INFLIGHT_SETTLED'] === '1'
          ? 'forward-hold'
          : 'hold'
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
    if (process.env['RIG_INFLIGHT_SETTLED'] === '1')
      await rig.until('execution settled on the Broker', () => executionRows()[0]?.[1] === 'SETTLED', 60_000);
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
    45_000,
  );
  await rig.until(
    'dispatch lease expiry',
    () =>
      rig.sql(
        `SELECT IF(dispatch_lease_until IS NULL OR dispatch_lease_until < UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, 1, 0) FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`,
      ) === '1',
    15_000,
  );
  // The public API refuses cancel for Workspace Sessions (409 workspace_unavailable), so the
  // db-cancel faults apply the store's own cancel transition (insertCancelCommand) directly.
  // Since #13112 (main 2b15eac8) the creator may cancel a Workspace Turn through the public API:
  // RIG_CANCEL=public posts agent.session.cancel to owner B instead of flipping the row.
  const publicCancel = process.env['RIG_CANCEL'] === 'public' && fault.startsWith('db-cancel');
  let cancelTransition: string | undefined;
  if (fault.startsWith('db-cancel') && !publicCancel) {
    rig.sql(
      `UPDATE qwen_managed_agent.managed_agent_turn SET status = 'CANCELLING', updated_at = UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000, version = version + 1 WHERE ${filter} AND status IN ('ACCEPTED', 'RUNNING')`,
    );
    cancelTransition = rig.sql(`SELECT status FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`);
  }

  // ---- owner B behind taps ----
  const harnessPortB = await freePort();
  let loads = 0;
  let continues = 0;
  let cancels = 0;
  let takeoverLoadBody = '';
  let takeoverLoadHeaders: Record<string, unknown> = {};
  let acquires = 0;
  let acquireFails = 0;
  const probeOn = process.env['RIG_PROBE'] === '1';
  let probeDelayed = false;
  const probeDelay = Number(process.env['RIG_PROBE_DELAY_MS'] ?? 12_000);
  let starts = 0;
  // Round-5 (#13173) faults on the cancellation takeover: Broker status during the passive load,
  // the final handback, and store traffic of the cancel route (terminal write / history read).
  let statusFails = 0;
  let releaseFails = 0;
  let terminalFails = 0;
  let historyFails = 0;
  let cancelSeen = false;
  let commitsSinceCancel = 0;
  let settledSinceCancel = false;
  const storeNotes: string[] = [];
  const brokerError = (code: string) => ({
    status: 503,
    body: JSON.stringify({ code, error: 'rig injected transient failure' }),
  });
  const coordinatorTap = await rig.tap(
    'coordinatorB->harnessB',
    `http://127.0.0.1:${harnessPortB}`,
    (info: TapInfo): TapAction => {
      const { method, path: p } = info;
      if (method === 'POST' && p.endsWith('/load')) {
        loads += 1;
        if (!takeoverLoadBody) {
          takeoverLoadBody = info.body;
          takeoverLoadHeaders = { ...info.headers };
        }
        // #13350: drop the reply of the first load that actually attached (upstream 200); a load
        // refused for an unrelated reason (e.g. a stale writer grant under host load) passes through.
        const droppedAlready = coordinatorTap.log.some((e) => e.line.includes('reply DROPPED'));
        if ((fault === 'drop-load-reply' || fault === 'db-cancel-drop-load-reply') && !droppedAlready) return 'drop-reply-if-200';
        if (probeOn && droppedAlready && !probeDelayed) {
          probeDelayed = true;
          return { delayMs: probeDelay };
        }
        if (fault === 'load-lost-once' && loads === 1) return 'drop-request';
      }
      if (method === 'POST' && p.endsWith('/managed-runtime/cancel')) {
        cancels += 1;
        cancelSeen = true;
        if (fault === 'db-cancel-drop-reply' && cancels === 1) return 'drop-reply';
      }
      if (method === 'POST' && p.endsWith('/managed-runtime/continue')) {
        continues += 1;
        if (fault === 'drop-continue-reply' && continues === 1) return 'drop-reply';
      }
      return 'pass';
    },
  );
  // Harness B reaches Spring B's session store through this tap (QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL
  // is what Spring advertises to the Harness in the load body).
  const springPortB = await freePort();
  const storeTap = await rig.tap('harnessB->storeB', `http://127.0.0.1:${springPortB}`, (info: TapInfo): TapAction => {
    const { method, path: p } = info;
    const route = p.split('?')[0]!.replace(/sessions\/[^/]+/, 'sessions/<s>').replace(/resources\/([^/]+)/, (_m: string, id: string) => 'resources/~' + id.slice(-6));
    let tags = '';
    const isCommit = method === 'POST' && (p.includes('/transactions:commit') || p.includes('/receipts/commit'));
    if (isCommit) {
      try {
        const body = JSON.parse(info.body) as { recordBytesBase64?: string; operation?: string };
        const decoded = Buffer.from(body.recordBytesBase64 ?? '', 'base64').toString('utf8');
        const found = new Set<string>();
        for (const m of decoded.matchAll(/\\*"(?:subtype|kind)\\*":\\*"([a-z_.]+)/g)) found.add(m[1]!);
        tags = `op=${body.operation ?? '?'} ${[...found].join(',')}`;
      } catch {
        tags = 'unparsed';
      }
    }
    let action: TapAction = 'pass';
    if (!cancelSeen && process.env['RIG_STORE_LOG'] === '1' && isCommit) storeNotes.push(`${ms()}ms ${method} ${route} ${tags}`);
    if (cancelSeen) {
      // The cancel route's checkpoint advance is op=commitCheckpoint; its terminal turn_result
      // record reaches the store as op=settleTurn (turn.settled + checkpoint.committed).
      if (isCommit && tags.startsWith('op=commitCheckpoint')) commitsSinceCancel += 1;
      if (isCommit && tags.startsWith('op=settleTurn')) settledSinceCancel = true;
      if (fault === 'db-cancel-terminal-write-fail' && isCommit && tags.startsWith('op=settleTurn') && terminalFails < 3) {
        terminalFails += 1;
        action = { status: 503, body: JSON.stringify({ code: 'rig_store_unavailable', error: 'rig injected' }) };
      }
      // A store read between the checkpoint advance and the terminal record (file history read).
      if (
        fault === 'db-cancel-history-read-fail' &&
        method === 'GET' &&
        p.includes('/resources/') &&
        commitsSinceCancel > 0 &&
        !settledSinceCancel &&
        historyFails < Number(process.env['RIG_HISTORY_FAILS'] ?? 1)
      ) {
        historyFails += 1;
        action = { status: 503, body: JSON.stringify({ code: 'rig_store_unavailable', error: 'rig injected' }) };
      }
      storeNotes.push(`${ms()}ms ${method} ${route} ${tags}${action === 'pass' ? '' : ' -> INJECTED 503'}`);
    }
    return action;
  });
  const springB = await rig.startSpring('B', {
    harnessUrl: coordinatorTap.baseUrl,
    port: springPortB,
    extraEnv: {
      QWEN_MANAGED_AGENT_SESSION_STORE_BASE_URL: storeTap.baseUrl,
      ...(process.env['RIG_REQ_TIMEOUT'] ? { QWEN_MANAGED_AGENT_HARNESS_REQUEST_TIMEOUT: process.env['RIG_REQ_TIMEOUT'] } : {}),
    },
  });
  const brokerTapB = await rig.tap(
    'harnessB->brokerB',
    `http://127.0.0.1:${springB.brokerPort}`,
    ({ method, path: p }: TapInfo): TapAction => {
      if (method === 'POST' && p.endsWith('/tool-sessions:acquire')) {
        acquires += 1;
        const nth = Number(process.env['RIG_ACQUIRE_FAIL_NTH'] ?? 0);
        if (nth > 0 && acquires >= nth && acquireFails < Number(process.env['RIG_ACQUIRE_FAIL_COUNT'] ?? 1)) {
          acquireFails += 1;
          return process.env['RIG_ACQUIRE_FAIL_KIND'] === 'drop-request'
            ? 'drop-request'
            : brokerError('runtime_broker_unavailable');
        }
      }
      if (method === 'POST' && p.includes('/executions/') && p.endsWith(':start')) {
        starts += 1;
        if (fault === 'slow-load' && starts === 1) return { delayMs: Number(process.env['RIG_START_DELAY_MS'] ?? 15_000) };
        if (fault === 'start-fail-once' && starts === 1) return 'drop-request';
        if (fault === 'start-fail-always') return 'drop-request';
      }
      // Passive takeover load: the first execution-status read after the adoption fails once.
      if (
        fault === 'db-cancel-load-status-fail' &&
        method === 'GET' &&
        /\/executions\/[^/:?]+\?/.test(p) &&
        !cancelSeen &&
        statusFails < Number(process.env['RIG_STATUS_FAILS'] ?? 1)
      ) {
        statusFails += 1;
        return brokerError('runtime_broker_unavailable');
      }
      // The cancel route's final handback fails once after the terminal record is durable.
      if (fault === 'db-cancel-release-fail' && method === 'POST' && p.endsWith(':release') && releaseFails < 1) {
        releaseFails += 1;
        return brokerError('runtime_broker_unavailable');
      }
      return 'pass';
    },
  );
  let cancelPost: { status: number; body: string } | undefined;
  if (fault === 'cancel' || publicCancel) {
    const turnId = rig.sql(`SELECT turn_id FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`);
    const response = await fetch(`${springB.url}/v1/agents/sessions/${session.id}/events`, {
      method: 'POST',
      headers: rig.headers({ 'content-type': 'application/json', 'idempotency-key': `cancel-${Date.now()}` }),
      body: JSON.stringify({ type: 'agent.session.cancel', turn_id: turnId }),
    });
    cancelPost = { status: response.status, body: (await response.text()).slice(0, 300) };
    if (publicCancel)
      cancelTransition = `public ${response.status} -> ${rig.sql(`SELECT status FROM qwen_managed_agent.managed_agent_turn WHERE ${filter}`)}`;
  }
  const harnessB = await rig.startHarness('B', { port: harnessPortB, brokerUrl: brokerTapB.baseUrl });
  void harnessB;
  const replacementReadyAt = ms();
  let probe: Record<string, unknown> | undefined;
  if (probeOn) {
    try {
      await rig.until('first load reply dropped', () => coordinatorTap.log.some((e) => e.line.includes('reply DROPPED')), waitMs);
      const harnessUrl = `http://127.0.0.1:${harnessPortB}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(takeoverLoadHeaders))
        if (!['host', 'content-length', 'connection', 'transfer-encoding'].includes(k) && typeof v === 'string') headers[k] = v;
      const post = async (p: string, body: string) => {
        const started = ms();
        const response = await fetch(`${harnessUrl}${p}`, { method: 'POST', headers, body });
        return { status: response.status, ms: ms() - started, body: await response.text() };
      };
      const startedProbe = ms();
      const concurrent = await Promise.all([1, 2, 3].map(() => post(`/session/${session.id}/load`, takeoverLoadBody)));
      const plain = JSON.parse(takeoverLoadBody) as Record<string, unknown>;
      delete plain['driveRuntimeRecovery'];
      delete plain['passiveManagedRuntimeRecovery'];
      const plainLoad = await post(`/session/${session.id}/load`, JSON.stringify(plain));
      const createBody = { ...(JSON.parse(takeoverLoadBody) as Record<string, unknown>), sessionId: session.id, sessionScope: 'thread', approvalMode: 'yolo' };
      delete createBody['driveRuntimeRecovery'];
      delete createBody['passiveManagedRuntimeRecovery'];
      const create = await post('/session', JSON.stringify(createBody));
      const dropped = coordinatorTap.log.find((e) => e.line.includes('reply DROPPED'))?.full ?? '';
      probe = {
        msAfterDrop: startedProbe,
        headerNames: Object.keys(headers).sort(),
        droppedFirstReply: dropped,
        concurrentRedrives: concurrent.map((r) => ({ status: r.status, ms: r.ms, identicalToDropped: r.body === dropped, body: r.body.slice(0, 600) })),
        plainLoad: { status: plainLoad.status, body: plainLoad.body.slice(0, 200) },
        create: { status: create.status, body: create.body.slice(0, 200) },
        acquiresAfterProbe: acquires,
        startsAfterProbe: starts,
      };
    } catch (error) {
      probe = { error: String(error).slice(0, 400) };
    }
  }

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

  // #13350: a late duplicate of the takeover load, first while the admitted continuation is still
  // running (Session active), then after the Turn settled.
  let lateLoad: Record<string, unknown> | undefined;
  const directLoad = async () => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(takeoverLoadHeaders))
      if (!['host', 'content-length', 'connection', 'transfer-encoding'].includes(k) && typeof v === 'string') headers[k] = v;
    const response = await fetch(`http://127.0.0.1:${harnessPortB}/session/${session.id}/load`, { method: 'POST', headers, body: takeoverLoadBody });
    const body = await response.text();
    return { status: response.status, hasRecovery: body.includes('managedRuntimeRecovery'), body: body.slice(0, 300) };
  };
  if (process.env['RIG_LATE_LOAD'] === '1') {
    try {
      await rig.until('continuation streaming', async () => (await publicText(springB.url)).join('').includes('REPLACEMENT_'), waitMs);
      const acquiresBefore = acquires;
      const during = await directLoad();
      lateLoad = { duringContinuation: during, acquiresDuring: acquires - acquiresBefore };
    } catch (error) {
      lateLoad = { error: String(error).slice(0, 300) };
    }
    releaseLate();
  }
  const terminal = await rig.waitTerminal(springB.url, session.id, 0, waitMs);
  if (lateLoad && terminal) {
    try {
      lateLoad['afterTerminal'] = await directLoad();
    } catch (error) {
      lateLoad['afterTerminalError'] = String(error).slice(0, 300);
    }
  }
  const settledAt = ms();
  // Let any late duplicate effect or duplicate model call show up before the ledgers are read.
  await sleep(2500);
  watcher.close();
  const leaseAfterTurn = leaseRow();
  const executionsAfterTurn = executionRows();
  const countersAtTurnEnd = {
    loads,
    continues,
    cancels,
    replacementStarts: starts,
    cancelTransition,
    injected: { statusFails, releaseFails, terminalFails, historyFails },
  };
  // After a failed final handback: does anything discharge the owed lease later?
  let leaseTimeline: string[] | undefined;
  if (fault === 'db-cancel-release-fail' && terminal) {
    leaseTimeline = [];
    const started = ms();
    const watchMs = Number(process.env['RIG_LEASE_WATCH_S'] ?? 60) * 1000;
    for (const at of [0, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000].filter((x) => x <= watchMs)) {
      while (ms() - started < at) await sleep(250);
      leaseTimeline.push(`+${Math.round((ms() - started) / 1000)}s ${leaseRow().replace(/\t/g, ' ')}`);
    }
  }
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
    leaseTimelineAfterTurn: leaseTimeline,
    storeLedgerFromFirstCancel: storeNotes.slice(0, 120),
    harnessBStderr: (() => {
      try {
        return readFileSync(path.join(process.env['RIG_OUT'] ?? '', `${label}-harness-B.log`), 'utf8')
          .split('\n')
          .filter((line) => /could not|hand back|cancellation|recovery/i.test(line))
          .map((line) => line.slice(0, 300))
          .slice(0, 30);
      } catch (error) {
        return [String(error)];
      }
    })(),
    fileHistoryAfterTakeover: fileHistory,
    coldLoadByFreshHarness: coldLoad,
    nextTurnAfterHarnessRestart: coldTurn,
    nextTurnOnNextOwner: nextOwner,
    secondSessionOnSameWorkspace: secondSession,
    counters: { ...countersAtTurnEnd, acquires, acquireFails },
    probe,
    lateLoad,
    brokerAcquireReplies: brokerTapB.log.slice(0, brokerLedgerAtTurnEnd).filter((e) => e.line.includes('tool-sessions:acquire')).map((e) => ({ t: e.t, status: e.status ?? null, body: (e.full ?? e.line).slice(0, 900) })),
    loadReplies: (() => {
      const lines = coordinatorTap.log.slice(0, coordinatorLedgerAtTurnEnd).filter((e) => /POST \/session\/[^ ]+\/load /.test(e.line));
      const dropped = lines.find((e) => e.line.includes('reply DROPPED'))?.full;
      return lines.map((e) => ({
        t: e.t,
        status: e.status ?? null,
        dropped: e.line.includes('reply DROPPED'),
        identicalToDropped: dropped !== undefined && e.full !== undefined && !e.line.includes('reply DROPPED') ? e.full === dropped : null,
        body: (e.full ?? e.line).slice(0, 700),
      }));
    })(),
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
