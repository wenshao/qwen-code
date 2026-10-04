/**
 * PR #13355 cross-language differential (maintainer verification harness).
 *
 * Real TypeScript authority + real HttpManagedSessionStore client against a
 * real Spring managed-agent-server (MySQL 8.4). For each case the authority
 * writes a genuine goal_state transaction; a fetch shim rewrites ONE defect
 * into the record bytes on the wire (recomputing the commit marker and the
 * request descriptor consistently, so the injected line is the only defect),
 * the Java store answers, and then a fresh writer reopens the Session through
 * the production read path (HTTP read + scanManagedSessionJournal +
 * LocalManagedSessionAuthority.open).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHttpManagedSessionStores } from '../managed-runtime/http-managed-session-store.js';
import { LocalManagedSessionAuthority } from '../managed-runtime/managed-session-authority.js';
import {
  MANAGED_SESSION_LIMITS,
  managedSessionEventsDigest,
  type ManagedSessionEvent,
} from '../managed-runtime/managed-session-records.js';
import { managedToolDigest } from '../tools/managed-tool-protocol.js';
import { parseMcpConfiguration } from '../managed-runtime/managed-mcp-record.js';

const URL_ = process.env['XLANG_URL']!;
const ARM = process.env['XLANG_ARM']!;
const OUT = process.env['XLANG_OUT']!;
const TENANT = 'tenant-xlang';
const WORKSPACE = 'ws-xlang';

type Rec = Record<string, any>;
type Line = Rec | string;
interface Ctx {
  sessionId: string;
  first: Rec; // the genuine domain.committed record
  marker: Rec; // the genuine commit marker record
  seq: number; // sequence of the genuine event
}

const sha = (s: string | Buffer) =>
  createHash('sha256').update(s).digest('hex');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function eventRecord(
  ctx: Ctx,
  sequence: number,
  eventId: string,
  kind: string,
  payload: Rec,
  edit: (event: Rec) => void = () => {},
): Rec {
  const record = clone(ctx.first);
  record['uuid'] = randomUUID();
  const event: Rec = {
    v: 1,
    sequence,
    eventId,
    sessionKey: clone(ctx.first['managedSession']['sessionKey']),
    kind,
    occurredAt: ctx.first['managedSession']['occurredAt'],
    payload,
  };
  edit(event);
  record['managedSession'] = event;
  return record;
}

/** A second event the reader accepts: another body-less goal_state record. */
function goalEvent(
  ctx: Ctx,
  sequence: number,
  eventId: string,
  edit: (event: Rec) => void = () => {},
): Rec {
  const payload = clone(ctx.first['managedSession']['payload']);
  payload['operationId'] = 'goal-extra';
  return eventRecord(ctx, sequence, eventId, 'domain.committed', payload, edit);
}

/** A well-formed activation subject, so message.delta's only defect is its payload. */
const withActivation = (event: Rec) => {
  event['subject'] = {
    type: 'activation',
    scopeId: 'scope-xlang',
    activationId: 'activation-xlang',
    epoch: 1,
  };
};

const delta = (extra: Rec = {}) => ({
  messageId: 'message-xlang',
  turnId: 'turn-xlang',
  role: 'assistant',
  text: 'hello',
  ...extra,
});

interface Case {
  id: string;
  group: 'control' | 'pr-negative' | 'residual';
  label: string;
  mutate: (ctx: Ctx) => Line[];
  markerEdit?: (marker: Rec) => void;
  /** After a clean reopen, commit the Session's first MCP configuration record. */
  followUp?: boolean;
}

const firstWith = (ctx: Ctx, edit: (event: Rec) => void): Rec => {
  const record = clone(ctx.first);
  edit(record['managedSession']);
  return record;
};

const CASES: Case[] = [
  {
    id: 'K0',
    group: 'control',
    label: 'genuine authority transaction, unmodified',
    mutate: (c) => [c.first, c.marker],
  },
  {
    id: 'K1',
    group: 'control',
    label: 'genuine event + a valid second event (goal_state domain.committed)',
    followUp: true,
    mutate: (c) => [c.first, goalEvent(c, c.seq + 1, 'goal-extra-1'), c.marker],
  },
  {
    id: 'N1',
    group: 'pr-negative',
    label: 'event line without its body',
    mutate: (c) => ['{"subtype":"managed_session_event_v1"}', c.marker],
  },
  {
    id: 'N2',
    group: 'pr-negative',
    label: 'second event line out of sequence (+5)',
    mutate: (c) => [
      c.first,
      goalEvent(c, c.seq + 5, 'goal-extra-1'),
      c.marker,
    ],
  },
  {
    id: 'N3',
    group: 'pr-negative',
    label: 'second event (valid goal_state record) with reserved id monitor_run:1',
    mutate: (c) => [
      c.first,
      goalEvent(c, c.seq + 1, 'monitor_run:1'),
      c.marker,
    ],
  },
  {
    id: 'N3b',
    group: 'pr-negative',
    label: 'second event (valid goal_state record) with reserved id mcp_configuration:1',
    followUp: true,
    mutate: (c) => [
      c.first,
      goalEvent(c, c.seq + 1, 'mcp_configuration:1'),
      c.marker,
    ],
  },
  {
    id: 'N4',
    group: 'pr-negative',
    label: 'second event line of an unknown kind',
    mutate: (c) => [
      c.first,
      eventRecord(c, c.seq + 1, 'event-xlang-1', 'not_a_kind', {}),
      c.marker,
    ],
  },
  {
    id: 'N5',
    group: 'pr-negative',
    label: 'second event line naming another Session',
    mutate: (c) => [
      c.first,
      goalEvent(c, c.seq + 1, 'goal-extra-1', (e) => {
        e['sessionKey']['workspaceId'] = 'other';
      }),
      c.marker,
    ],
  },
  {
    id: 'N6',
    group: 'pr-negative',
    label: 'unknown subtype after a Managed line',
    mutate: (c) => [c.first, '{"subtype":"not_a_subtype"}', c.marker],
  },
  {
    id: 'N7',
    group: 'pr-negative',
    label: 'body-less domain.committed with a fifth payload field',
    mutate: (c) => [
      firstWith(c, (e) => {
        e['payload']['extra'] = true;
      }),
      c.marker,
    ],
  },
  {
    id: 'N8',
    group: 'pr-negative',
    label: 'body-less domain.committed of record version 2',
    mutate: (c) => [
      firstWith(c, (e) => {
        e['payload']['version'] = 2;
      }),
      c.marker,
    ],
  },
  {
    id: 'N9',
    group: 'pr-negative',
    label: 'domain.committed naming a domain outside the v1 index',
    mutate: (c) => [
      firstWith(c, (e) => {
        e['payload']['domain'] = 'not_a_domain';
      }),
      c.marker,
    ],
  },
  {
    id: 'N10',
    group: 'pr-negative',
    label: 'commit marker past its 64 KiB cap',
    mutate: (c) => [c.first, c.marker],
    markerEdit: (m) => {
      m['padding'] = 'x'.repeat(100_000);
    },
  },
  {
    id: 'N11',
    group: 'pr-negative',
    label: 'second event (valid goal_state record) whose event id is not NFC-normalized',
    mutate: (c) => [c.first, goalEvent(c, c.seq + 1, 'goal-e\u0301-1'), c.marker],
  },
  {
    id: 'N12',
    group: 'pr-negative',
    label: 'body-less domain.committed whose operationId is not NFC-normalized',
    mutate: (c) => [
      firstWith(c, (e) => {
        e['payload']['operationId'] = 'goal-e\u0301';
      }),
      c.marker,
    ],
  },
  {
    id: 'R1',
    group: 'residual',
    label:
      'foreign subtype as the only "event" line of a non-genesis transaction',
    mutate: (c) => ['{"subtype":"not_a_subtype"}', c.marker],
  },
  {
    id: 'R2',
    group: 'residual',
    label: 'second event input.accepted with an empty payload',
    mutate: (c) => [
      c.first,
      eventRecord(c, c.seq + 1, 'input-xlang-1', 'input.accepted', {}),
      c.marker,
    ],
  },
  {
    id: 'R3',
    group: 'residual',
    label: 'second event message.delta missing required payload.text',
    mutate: (c) => {
      const p: Rec = delta();
      delete p['text'];
      return [
        c.first,
        eventRecord(c, c.seq + 1, 'delta-xlang-1', 'message.delta', p, withActivation),
        c.marker,
      ];
    },
  },
  {
    id: 'R4',
    group: 'residual',
    label: 'second event message.delta with an unknown payload key',
    mutate: (c) => [
      c.first,
      eventRecord(
        c,
        c.seq + 1,
        'delta-xlang-1',
        'message.delta',
        delta({ extra: true }),
        withActivation,
      ),
      c.marker,
    ],
  },
  {
    id: 'R5',
    group: 'residual',
    label: 'second event (valid goal_state record) with a malformed subject',
    mutate: (c) => [
      c.first,
      goalEvent(c, c.seq + 1, 'goal-extra-1', (e) => {
        e['subject'] = { type: 'bogus' };
      }),
      c.marker,
    ],
  },
  {
    id: 'R6',
    group: 'residual',
    label: 'commit marker whose eventsDigest does not match its events',
    mutate: (c) => [c.first, c.marker],
    markerEdit: (m) => {
      m['eventsDigest'] = sha('not-the-events');
    },
  },
  {
    id: 'R7',
    group: 'residual',
    label: 'second event message.delta without its required activation subject',
    mutate: (c) => [
      c.first,
      eventRecord(c, c.seq + 1, 'delta-xlang-1', 'message.delta', delta()),
      c.marker,
    ],
  },
];

interface WireResult {
  status: number;
  code?: string;
  message?: string;
  storedLines?: string[];
}

function makeShim() {
  let armed: { c: Case; resolve: (r: WireResult) => void } | undefined;
  let last: WireResult | undefined;
  const shim: typeof fetch = async (input, init) => {
    const url = String(input);
    if (
      armed &&
      init?.method === 'POST' &&
      url.endsWith('/transactions:commit')
    ) {
      const { c } = armed;
      armed = undefined;
      const body = JSON.parse(String(init.body));
      const records = Buffer.from(body.recordBytesBase64, 'base64')
        .toString('utf8')
        .slice(0, -1)
        .split('\n')
        .map((l) => JSON.parse(l));
      const ctx: Ctx = {
        sessionId: records[0]['sessionId'],
        first: records[0],
        marker: clone(records[records.length - 1]),
        seq: records[0]['managedSession']['sequence'],
      };
      const lines = c.mutate(ctx).map((l) => clone(l));
      const markerRecord = lines[lines.length - 1] as Rec;
      const marker = markerRecord['managedSession'];
      const eventCount = lines.length - 1;
      marker['eventCount'] = eventCount;
      marker['lastSequence'] = marker['firstSequence'] + eventCount - 1;
      const events = lines
        .slice(0, -1)
        .filter(
          (l): l is Rec =>
            typeof l !== 'string' &&
            l['subtype'] === 'managed_session_event_v1',
        )
        .map((l) => l['managedSession'] as ManagedSessionEvent);
      try {
        marker['eventsDigest'] = managedSessionEventsDigest(events);
      } catch {
        marker['eventsDigest'] = sha('unrepresentable-events');
      }
      c.markerEdit?.(marker);
      let commitDigest: string;
      try {
        commitDigest = managedToolDigest(
          marker,
          MANAGED_SESSION_LIMITS.maxCommitMarkerBytes,
        );
      } catch {
        commitDigest = sha(JSON.stringify(marker));
      }
      const text =
        lines
          .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
          .join('\n') + '\n';
      const bytes = Buffer.from(text, 'utf8');
      Object.assign(body, {
        transactionId: marker['transactionId'],
        eventCount,
        lastSequence: marker['lastSequence'],
        eventsDigest: marker['eventsDigest'],
        commitDigest,
        recordCount: lines.length,
        recordBytesBase64: bytes.toString('base64'),
        recordDigest: sha(bytes),
      });
      const response = await fetch(url, {
        ...init,
        body: JSON.stringify(body),
      });
      const copy = response.clone();
      let parsed: Rec = {};
      try {
        parsed = (await copy.json()) as Rec;
      } catch {
        /* not JSON */
      }
      last = {
        status: response.status,
        code: parsed['error']?.['code'] ?? parsed['code'],
        message: parsed['error']?.['message'] ?? parsed['message'],
      };
      return response;
    }
    return fetch(input, init);
  };
  return {
    fetch: shim,
    arm: (c: Case) => {
      armed = { c, resolve: () => {} };
      last = undefined;
    },
    last: () => last,
  };
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? `${error.constructor.name}: ${error.message}`
    : String(error);

const token = () => `xlang_${randomBytes(24).toString('hex')}`;

async function runCase(c: Case) {
  const sessionId = randomUUID();
  const sessionKey = { tenantId: TENANT, workspaceId: WORKSPACE, sessionId };
  const shim = makeShim();
  const s1 = createHttpManagedSessionStores({
    baseUrl: URL_,
    sessionKey,
    writerId: 'writer-xlang-a',
    writerToken: token(),
    leaseDurationMs: 60_000,
    fetchFn: shim.fetch,
  });
  const journal = await s1.journalStore.open({ sessionKey });
  const authority = await LocalManagedSessionAuthority.open({
    journal,
    sessionKey,
    cwd: '/workspace',
    version: 'xlang/1',
    create: {
      definitionRef: await s1.resourceStore.publish(
        'managed-definition',
        Buffer.from(JSON.stringify({ engine: 'managed', sessionId })),
      ),
      rootSnapshotRef: await s1.resourceStore.publish(
        'managed-root',
        Buffer.from(JSON.stringify({ cwd: '/workspace' })),
      ),
      createdBy: 'xlang',
    },
    requireNew: true,
    resources: s1.resourceStore,
  });
  const command = (id: string, content: Rec) => ({
    operation: 'commitDomainRecord',
    commandId: id,
    sessionKey,
    contentDigest: sha(JSON.stringify(content)),
  });
  const first = { goal: 'first' };
  await authority.commitDomainRecord(
    command('goal-1', first),
    { domain: 'goal_state', content: first },
    { class: 'trusted_entry' },
  );
  const second = { goal: 'second' };
  shim.arm(c);
  let clientError: string | null = null;
  try {
    await authority.commitDomainRecord(
      command('goal-2', second),
      { domain: 'goal_state', content: second },
      { class: 'trusted_entry' },
    );
  } catch (error) {
    clientError = errorText(error);
  }
  const wire = shim.last();
  await authority.close().catch(() => undefined);
  await s1.close().catch(() => undefined);

  const token2 = token();
  const s2 = createHttpManagedSessionStores({
    baseUrl: URL_,
    sessionKey,
    writerId: 'writer-xlang-b',
    writerToken: token2,
    leaseDurationMs: 60_000,
  });
  let reopen: { ok: boolean; committed?: number; error?: string };
  let followUp: string | null = null;
  try {
    const j2 = await s2.journalStore.open({ sessionKey });
    const reopened = await LocalManagedSessionAuthority.open({
      journal: j2,
      sessionKey,
      cwd: '/workspace',
      version: 'xlang/1',
      resources: s2.resourceStore,
    });
    reopen = { ok: true, committed: reopened.committedSequence };
    if (c.followUp) {
      // The authority assigns the first MCP configuration revision the id
      // mcp_configuration:1; a stored line already holding it wedges that.
      try {
        await reopened.commitExtensionRecord(
          {
            operation: 'commitMcpRecord',
            commandId: 'configure-1',
            sessionKey,
            contentDigest: 'd'.repeat(64),
          },
          {
            domain: 'mcp_configuration',
            record: parseMcpConfiguration({
              configurationId: 'configure-1',
              runtimeSessionId: 'mcp:session-1',
              serverId: 'server-1',
              serverRevision: 1,
              configRevision: 1,
              catalogRevision: null,
              connectionGeneration: null,
              catalogRef: null,
              releaseState: 'active',
              run: {
                state: 'admitted',
                reason: null,
                definition: {
                  definitionId: 'server-1',
                  definitionRevision: 1,
                  definitionDigest: 'b'.repeat(64),
                },
                executionCallId: null,
                effectId: 'configure-1',
                dispatchId: null,
                deliveryId: null,
                execution: 'intent',
                runtime: null,
                delivery: null,
              },
            }),
          },
          { class: 'trusted_entry' },
        );
        followUp = 'mcp_configuration record committed';
      } catch (error) {
        followUp = `refused: ${errorText(error)}`;
      }
    }
    await reopened.close().catch(() => undefined);
  } catch (error) {
    reopen = { ok: false, error: errorText(error) };
  }
  // The raw transactions the store holds, read as the current writer.
  let stored: string[] = [];
  try {
    const response = await fetch(
      `${URL_}/internal/managed-session-store/v1/sessions/${sessionId}/transactions?workspaceId=${WORKSPACE}&afterRevision=0&limit=100`,
      {
        headers: {
          Accept: 'application/json',
          'X-Qwen-Tenant-Id': TENANT,
          'X-Qwen-Managed-Writer-Token': token2,
        },
      },
    );
    const page = (await response.json()) as Rec;
    stored = (page['transactions'] ?? []).map(
      (t: Rec) =>
        `rev ${t['journalRevision']} ${t['operation']}: ` +
        Buffer.from(t['recordBytesBase64'], 'base64')
          .toString('utf8')
          .trimEnd()
          .split('\n')
          .map((l) => (l.length > 160 ? `${l.slice(0, 157)}...` : l))
          .join(' | '),
    );
  } catch (error) {
    stored = [`<read failed: ${errorText(error)}>`];
  }
  await s2.close().catch(() => undefined);
  return {
    id: c.id,
    group: c.group,
    label: c.label,
    sessionId,
    wire: wire ?? null,
    clientError,
    reopen,
    followUp,
    storedRevisions: stored.length,
    stored,
  };
}

describe(`PR #13355 cross-language differential (${ARM})`, () => {
  it('runs every case against the real Java store', async () => {
    const results = [];
    for (const c of CASES) {
      results.push(await runCase(c));
    }
    writeFileSync(
      OUT,
      JSON.stringify({ arm: ARM, url: URL_, results }, null, 2),
    );
    expect(results.length).toBe(CASES.length);
  }, 600_000);
});
