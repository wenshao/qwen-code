// Round 2 mutation matrix for PR #13345.
//   old = d3b8ddd1 (wt-mut-pr), new = 4ae14d62 (wt-mut-base).
// Part A: every round-1 head mutant re-run on the new head (anchors that the
// new commits moved get a new-arm variant). Part B: one mutant per /review
// R1 finding and the header cap, on both heads where the code exists.
import { MUTANTS as R1, JSON_FNS as R1_JSON } from '../mut/mutants.mjs';

const CORE = 'packages/core/src/managed-runtime';
const JAVA =
  'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store';
const JOURNAL_FIX = `${CORE}/contracts/managed-extension-journal-v1.fixtures.json`;

const NEW_PREFLIGHT = `      // Every refusal the caller decides runs before any body publishes.
      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      if (request.input !== undefined) {
        const preflight = inputEvents(
          command,
          request.input,
          this.committed + 2,
          this.now(),
        );
        preflight.forEach((event, index) => {
          const parsed = parseManagedSessionEvent(event);
          assertManagedSessionEventActor(parsed, INPUT_ACTORS[index]!.class);
          if (this.eventIds.has(parsed.eventId)) {
            throw new ManagedSessionConflictError(
              \`event id \${parsed.eventId} is already committed.\`,
            );
          }
        });
      }
`;

const NEW_ARM_EDITS = {
  // R3-5: the whole preflight, now including the identity check.
  'T05-extension-preflight-deleted': [
    {
      file: `${CORE}/managed-session-authority.ts`,
      find: NEW_PREFLIGHT,
      replace: '',
    },
  ],
  'T06-domain-preflight-deleted': [
    {
      file: `${CORE}/managed-session-authority.ts`,
      find: `    return this.runSerial(async () => {
      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      const previous = this.domainRecords.get(request.domain);`,
      replace: `    return this.runSerial(async () => {
      const previous = this.domainRecords.get(request.domain);`,
    },
  ],
};

const partA = R1.filter((m) => m.arms.includes('pr')).map((m) => ({
  ...m,
  id: `A-${m.id}`,
  arms: ['new'],
  edits: NEW_ARM_EDITS[m.id] ?? m.edits,
}));

const both = ['old', 'new'];
const partB = [
  {
    id: 'B01-tripwire-never-fires',
    finding: 'R1-1',
    arms: both,
    lanes: ['ts'],
    desc: 'the load-time tripwire condition can never be true',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: 'if (envelopeBodyCollision.length > 0) {',
        replace: 'if (false && envelopeBodyCollision.length > 0) {',
      },
    ],
  },
  {
    id: 'B02-envelope-list-drops-goal_state',
    finding: 'R1-1',
    arms: both,
    lanes: ['ts'],
    desc: 'goal_state drops out of MANAGED_SESSION_ENVELOPE_DOMAINS (stale list)',
    edits: [
      {
        file: `${CORE}/managed-session-records.ts`,
        find: `  ['goal_state', 'session_metadata', 'file_history', 'session_source'];`,
        replace: `  ['session_metadata', 'file_history', 'session_source'];`,
      },
    ],
  },
  {
    id: 'B03-terminal-guard-deleted-ts',
    finding: 'R1-2',
    arms: both,
    lanes: ['ts'],
    desc: 'runtimeState() loses its terminal guard (TS)',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: 'if (isTerminalRunState(run.state) || run.execution === null) return null;',
        replace: 'if (run.execution === null) return null;',
      },
    ],
  },
  {
    id: 'B04-terminal-guard-deleted-java',
    finding: 'R1-2',
    arms: both,
    lanes: ['java'],
    desc: 'runtimeState() loses its terminal guard (Java)',
    edits: [
      {
        file: `${JAVA}/ManagedExtensionProjection.java`,
        find: `        if (ManagedExtensionRecords.TERMINAL.contains(
                run.get("state").textValue())
                || execution == null) {`,
        replace: `        if (execution == null) {`,
      },
    ],
  },
  {
    id: 'B05-publish-before-no-body-refusal',
    finding: 'R1-3',
    arms: both,
    lanes: ['ts'],
    desc: 'commitExtensionRecord publishes before refusing a domain with no body',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `    const body = MANAGED_EXTENSION_RECORD_BODIES[request.domain];
    if (body === undefined) {
      throw new ManagedSessionRecordError(
        \`domain \${request.domain} has no Stage H record body.\`,`,
        replace: `    const body = MANAGED_EXTENSION_RECORD_BODIES[request.domain];
    if (body === undefined) {
      await this.resources?.publish(
        \`managed-\${request.domain}\`,
        Buffer.from(JSON.stringify(request.record ?? null), 'utf8'),
      );
      throw new ManagedSessionRecordError(
        \`domain \${request.domain} has no Stage H record body.\`,`,
      },
    ],
  },
  {
    id: 'B06-identity-preflight-stripped',
    finding: 'R1-4',
    arms: ['new'],
    lanes: ['ts'],
    desc: 'both assertCommandIdentity call sites removed',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      const previous = this.domainRecords.get(request.domain);`,
        replace: `      assertExtensionActor(actor.class);
      const previous = this.domainRecords.get(request.domain);`,
      },
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `      assertExtensionActor(actor.class);
      assertCommandIdentity(command);
      if (request.input !== undefined) {`,
        replace: `      assertExtensionActor(actor.class);
      if (request.input !== undefined) {`,
      },
    ],
  },
  {
    id: 'B07-duplicate-input-branch-deleted',
    finding: 'R1-5',
    arms: both,
    lanes: ['ts'],
    desc: "the input preflight's duplicate-event-id branch is deleted",
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `          if (this.eventIds.has(parsed.eventId)) {
            throw new ManagedSessionConflictError(
              \`event id \${parsed.eventId} is already committed.\`,
            );
          }
        });`,
        replace: `        });`,
      },
    ],
  },
  {
    id: 'B08-journal-task-extra-field',
    finding: 'R1-8',
    arms: both,
    lanes: ['ts', 'java'],
    desc: 'the journal golden task node gains "lastError": null',
    json: [{ file: JOURNAL_FIX, fn: 'journalTaskExtraField' }],
  },
  {
    id: 'B09-header-cap-back-to-event-cap',
    finding: 'header cap (a9aa10e1)',
    arms: ['new'],
    lanes: ['ts'],
    desc: 'the header branch caps at maxEventBytes again',
    edits: [
      {
        file: `${CORE}/managed-session-storage.ts`,
        find: `Buffer.byteLength(line, 'utf8') > MANAGED_SESSION_LIMITS.maxHeaderBytes`,
        replace: `Buffer.byteLength(line, 'utf8') > MANAGED_SESSION_LIMITS.maxEventBytes`,
      },
    ],
  },
];

export const MUTANTS = [...partB, ...partA];

export const JSON_FNS = {
  ...R1_JSON,
  journalTaskExtraField(o) {
    if (!Array.isArray(o.tasks) || o.tasks.length === 0) throw new Error('no tasks');
    if ('lastError' in o.tasks[0]) throw new Error('already has lastError');
    o.tasks[0].lastError = null;
  },
};
