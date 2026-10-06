import sys
root=sys.argv[1]
def edit(p, pairs):
    s=open(root+'/'+p).read()
    for a,b in pairs:
        assert s.count(a)==1,(p,a)
        s=s.replace(a,b)
    open(root+'/'+p,'w').write(s)
edit('packages/core/src/managed-runtime/managed-event-envelope.ts',[
("""/** The envelope format version carried by `v`. */
export const MANAGED_EVENT_ENVELOPE_FORMAT_VERSION = 1;
""","""/** The envelope format version carried by `v`. */
export const MANAGED_EVENT_ENVELOPE_FORMAT_VERSION = 1;

/**
 * The committed source whose sequence an envelope names. A Session keeps two
 * independent counters — the journal's commit sequence and the public
 * `managed_agent_event.sequence_id` — that reuse the same numbers for
 * different facts, so a sequence is only an identity together with its
 * stream. v1 distributes journal facts only.
 */
export const MANAGED_EVENT_ENVELOPE_STREAMS = Object.freeze([
  'authoritative_journal',
] as const);

export type ManagedEventEnvelopeStream =
  (typeof MANAGED_EVENT_ENVELOPE_STREAMS)[number];
"""),
("""  readonly workspaceId: string;
  readonly sequence: number;
  readonly eventId: string;""","""  readonly workspaceId: string;
  readonly stream: ManagedEventEnvelopeStream;
  readonly sequence: number;
  readonly eventId: string;"""),
("""export interface ManagedEventEnvelopeKey {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly sequence: number;
}""","""export interface ManagedEventEnvelopeKey {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly stream: ManagedEventEnvelopeStream;
  readonly sequence: number;
}"""),
("""  'workspaceId',
  'sequence',
  'eventId',""","""  'workspaceId',
  'stream',
  'sequence',
  'eventId',"""),
("""    workspaceId: assertManagedSessionStableId(
      body.workspaceId,
      'envelope.workspaceId',
    ),
    sequence,""","""    workspaceId: assertManagedSessionStableId(
      body.workspaceId,
      'envelope.workspaceId',
    ),
    stream: assertEnum(
      body.stream,
      MANAGED_EVENT_ENVELOPE_STREAMS,
      'envelope.stream',
    ),
    sequence,"""),
("""    workspaceId: event.sessionKey.workspaceId,
    sequence: event.sequence,""","""    workspaceId: event.sessionKey.workspaceId,
    stream: 'authoritative_journal',
    sequence: event.sequence,"""),
("""/** The idempotence key of a parsed envelope: `(tenantId, sessionId,
 * sequence)`. */""","""/** The idempotence key of a parsed envelope: `(tenantId, sessionId,
 * stream, sequence)`. */"""),
("""    tenantId: envelope.tenantId,
    sessionId: envelope.sessionId,
    sequence: envelope.sequence,""","""    tenantId: envelope.tenantId,
    sessionId: envelope.sessionId,
    stream: envelope.stream,
    sequence: envelope.sequence,"""),
("""    left.sessionId === right.sessionId &&
    left.sequence === right.sequence""","""    left.sessionId === right.sessionId &&
    left.stream === right.stream &&
    left.sequence === right.sequence"""),
("""// event row by its tenant-scoped ordering key (tenantId + sessionId +
// sequence), carries""","""// event row by its tenant-scoped ordering key (tenantId + sessionId +
// stream + sequence), carries"""),
])
edit('packages/core/src/managed-runtime/contracts/managed-event-envelope-v1.schema.json',[
('''        "sessionId",
        "tenantId",
        "v",
        "workspaceId"
      ],''','''        "sessionId",
        "stream",
        "tenantId",
        "v",
        "workspaceId"
      ],'''),
('''        "workspaceId": {
          "$ref": "#/$defs/stableId"
        },
        "sequence": {''','''        "workspaceId": {
          "$ref": "#/$defs/stableId"
        },
        "stream": {
          "enum": ["authoritative_journal"]
        },
        "sequence": {'''),
])
print("ok")
