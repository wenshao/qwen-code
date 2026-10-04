// Mutation matrix for PR #13345. Each mutant is applied to a clean tree by
// exact text replacement (the anchor must occur exactly once) or by a JSON
// edit, the named lanes run, and the tree is restored with git checkout.
const CORE = 'packages/core/src/managed-runtime';
const JAVA =
  'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store';
const PROJ_FIX = `${CORE}/contracts/managed-extension-projection-v1.fixtures.json`;
const STORE_FIX = `${CORE}/contracts/managed-session-store-v1.fixtures.json`;
const JOURNAL_FIX = `${CORE}/contracts/managed-extension-journal-v1.fixtures.json`;

const TS_TERMINAL_BLOCK = `  if (
    isTerminal(before.run.state) &&
    !sameJson(
      { ...before, notifiedThrough: 0 },
      { ...after, notifiedThrough: 0 },
    )
  ) {
    return false;
  }
`;

const ASSERT_REVISION = `      this.assertExtensionRevision(
        request.domain,
        body,
        parsed,
        command.commandId,
        (message) => {
          throw new ManagedSessionConflictError(message);
        },
      );
      // Refused before publishing, so a retry loop leaves no body behind.
`;
const PUBLISH = `      const recordRef = await store.publish(
        \`managed-\${request.domain}\`,
        Buffer.from(JSON.stringify(parsed.record), 'utf8'),
      );
`;

const PREFLIGHT_BLOCK = `      // Every refusal the caller decides runs before any body publishes.
      assertExtensionActor(actor.class);
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

const GOAL_STATE_BODY = `  goal_state: Object.freeze({
    taskKind: null,
    parse: (value: unknown) => {
      const record = parseHookExecution(value);
      return { record, recordId: record.hookExecutionId, run: record.run };
    },
    isStart: isHookExecutionStart,
    isSuccessor: isHookExecutionSuccessor,
  }),
  monitor_run: Object.freeze({
    taskKind: 'monitor',`;

const both = ['base', 'pr'];
const head = ['pr'];

export const MUTANTS = [
  // (1) R2-1: the terminal rule of the monitor chain.
  {
    id: 'T01-terminal-block-ts',
    arms: both,
    lanes: ['ts'],
    desc: 'delete the terminal block in isMonitorRunSuccessor (TS)',
    edits: [
      {
        file: `${CORE}/managed-extension-record.ts`,
        find: TS_TERMINAL_BLOCK,
        replace: '',
      },
    ],
  },
  {
    id: 'J01-terminal-block-java',
    arms: both,
    lanes: ['java'],
    desc: 'delete the terminal block in ManagedExtensionRecords.isMonitorRunSuccessor (Java)',
    edits: [
      {
        file: `${JAVA}/ManagedExtensionRecords.java`,
        find: `        if (TERMINAL.contains(text(previous.get("run"), "state"))
                && !same(without(previous, "notifiedThrough"),
                        without(next, "notifiedThrough"))) {
            return false;
        }
`,
        replace: '',
      },
    ],
  },
  // (2) R2-2: the revision guard ordered after publish.
  {
    id: 'T02-assert-revision-after-publish',
    arms: both,
    lanes: ['ts'],
    desc: 'move assertExtensionRevision below store.publish in commitExtensionRecord',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: ASSERT_REVISION + `      this.assertCommandWritable(command);
      this.assertExpectedSequence(command);
` + PUBLISH,
        replace: `      this.assertCommandWritable(command);
      this.assertExpectedSequence(command);
` + PUBLISH + ASSERT_REVISION,
      },
    ],
  },
  // (3) Fixture meta-pins.
  {
    id: 'D01-projection-contractVersion-2',
    arms: both,
    lanes: ['ts', 'java', 'broker'],
    desc: 'projection fixture contractVersion 1 -> 2',
    json: [{ file: PROJ_FIX, fn: 'contractVersion2' }],
  },
  {
    id: 'D02-view-seventh-field',
    arms: both,
    lanes: ['ts', 'java'],
    desc: 'a seventh field in a history revision view',
    json: [{ file: PROJ_FIX, fn: 'seventhViewField' }],
  },
  {
    id: 'D03-taskKinds-renamed',
    arms: head,
    lanes: ['ts', 'java'],
    desc: 'rename a taskKinds fixture entry (automation_run -> automation)',
    json: [{ file: PROJ_FIX, fn: 'renameTaskKind' }],
  },
  {
    id: 'T03-task-kind-constant-renamed',
    arms: both,
    lanes: ['ts'],
    desc: 'rename MANAGED_TASK_KINDS automation_run -> automation (TS constant)',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: `  'monitor',
  'automation_run',
] as const;`,
        replace: `  'monitor',
  'automation',
] as const;`,
      },
    ],
  },
  {
    id: 'T04-runtime-state-constant-renamed',
    arms: both,
    lanes: ['ts'],
    desc: 'rename MANAGED_TASK_RUNTIME_STATES draining -> drained (TS constant)',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: `  'ready',
  'draining',
  'lost',
] as const;`,
        replace: `  'ready',
  'drained',
  'lost',
] as const;`,
      },
    ],
  },
  {
    id: 'D04-limits-tenth-key',
    arms: both,
    lanes: ['ts', 'java'],
    desc: 'a tenth key in the store fixture limits block',
    json: [{ file: STORE_FIX, fn: 'tenthLimit' }],
  },
  {
    id: 'D05-headers-third-key',
    arms: both,
    lanes: ['ts', 'java'],
    desc: 'a third key in the store fixture headers block',
    json: [{ file: STORE_FIX, fn: 'thirdHeader' }],
  },
  {
    id: 'D06-historyCases-emptied',
    arms: both,
    lanes: ['ts', 'java'],
    desc: 'historyCases emptied (it.each over [] registers nothing)',
    json: [{ file: PROJ_FIX, fn: 'emptyHistories' }],
  },
  {
    id: 'D07-journal-contractVersion-2',
    arms: head,
    lanes: ['ts', 'java'],
    desc: 'journal golden contractVersion 1 -> 2',
    json: [{ file: JOURNAL_FIX, fn: 'contractVersion2' }],
  },
  // (4) R3-5: the preflight.
  {
    id: 'T05-extension-preflight-deleted',
    arms: head,
    lanes: ['ts'],
    desc: 'delete the actor/input preflight in commitExtensionRecord',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: PREFLIGHT_BLOCK,
        replace: '',
      },
    ],
  },
  {
    id: 'T06-domain-preflight-deleted',
    arms: head,
    lanes: ['ts'],
    desc: 'delete the actor preflight in commitDomainRecord',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `    return this.runSerial(async () => {
      assertExtensionActor(actor.class);
      const previous = this.domainRecords.get(request.domain);`,
        replace: `    return this.runSerial(async () => {
      const previous = this.domainRecords.get(request.domain);`,
      },
    ],
  },
  // (5) R3-7: runtimeState clause order and the settledAt clamp.
  {
    id: 'T07-runtime-clause-swap-ts',
    arms: both,
    lanes: ['ts'],
    desc: 'swap the unbound/ready clauses of runtimeState (TS)',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: `  if (run.runtime === null) return 'unbound';
  if (run.execution === 'running_attached') return 'ready';`,
        replace: `  if (run.execution === 'running_attached') return 'ready';
  if (run.runtime === null) return 'unbound';`,
      },
    ],
  },
  {
    id: 'J02-runtime-clause-swap-java',
    arms: both,
    lanes: ['java'],
    desc: 'swap the unbound/ready clauses of runtimeState (Java)',
    edits: [
      {
        file: `${JAVA}/ManagedExtensionProjection.java`,
        find: `        if (run.get("runtime").isNull()) {
            return "unbound";
        }
        if ("running_attached".equals(execution)) {
            return "ready";
        }`,
        replace: `        if ("running_attached".equals(execution)) {
            return "ready";
        }
        if (run.get("runtime").isNull()) {
            return "unbound";
        }`,
      },
    ],
  },
  {
    id: 'T08-clamp-startedAt-ts',
    arms: both,
    lanes: ['ts'],
    desc: 'drop the startedAt operand of the settledAt clamp (TS)',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: `Math.max(occurredAt, startedAt ?? createdAt)`,
        replace: `Math.max(occurredAt, createdAt)`,
      },
    ],
  },
  {
    id: 'J03-clamp-startedAt-java',
    arms: both,
    lanes: ['java'],
    desc: 'drop the startedAt operand of the settledAt clamp (Java)',
    edits: [
      {
        file: `${JAVA}/ManagedExtensionProjection.java`,
        find: `Long.valueOf(Math.max(occurredAt, startedAt != null
                                ? startedAt : createdAt))`,
        replace: `Long.valueOf(Math.max(occurredAt, createdAt))`,
      },
    ],
  },
  // (6) R3-8: the grant gate.
  {
    id: 'T09-revoke-accepts-max-safe',
    arms: head,
    lanes: ['ts'],
    desc: 'revoke accepts Number.MAX_SAFE_INTEGER again (base check)',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: `    assertManagedSessionSequence(operationRevision, 'operationRevision');
    if (operationRevision < 1) {`,
        replace: `    if (!Number.isSafeInteger(operationRevision) || operationRevision < 1) {`,
      },
    ],
  },
  {
    id: 'T10-phase-union-on-replace',
    arms: both,
    lanes: ['ts'],
    desc: 'a replacement stores the union of old and new phases',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: `    this.entries.set(key, {
      grant,
      revokedThrough: entry?.revokedThrough ?? 0,
    });`,
        replace: `    this.entries.set(key, {
      grant:
        current === undefined
          ? grant
          : {
              ...grant,
              resourceScope: {
                ...grant.resourceScope,
                phases: [
                  ...new Set([
                    ...current.resourceScope.phases,
                    ...grant.resourceScope.phases,
                  ]),
                ],
              },
            },
      revokedThrough: entry?.revokedThrough ?? 0,
    });`,
      },
    ],
  },
  {
    id: 'T11-renewal-keeps-old-lease',
    arms: both,
    lanes: ['ts'],
    desc: 'a same-revision renewal keeps the old grant (lease not extended)',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: `    this.entries.set(key, {
      grant,
      revokedThrough: entry?.revokedThrough ?? 0,
    });`,
        replace: `    this.entries.set(key, {
      grant:
        current !== undefined &&
        current.operationRevision === grant.operationRevision
          ? current
          : grant,
      revokedThrough: entry?.revokedThrough ?? 0,
    });`,
      },
    ],
  },
  {
    id: 'T12-install-before-validate',
    arms: both,
    lanes: ['ts'],
    desc: 'install writes the entry before the successor check (incumbent lost on conflict)',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: `    const current = entry?.grant;
    if (current !== undefined) {`,
        replace: `    const current = entry?.grant;
    this.entries.set(key, {
      grant,
      revokedThrough: entry?.revokedThrough ?? 0,
    });
    if (current !== undefined) {`,
      },
    ],
  },
  {
    id: 'T13-workspace-buckets-merged',
    arms: both,
    lanes: ['ts'],
    desc: 'gate key drops workspaceId (Workspaces share a bucket)',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: 'return `${key.tenantId}\\0${key.workspaceId}\\0${key.sessionId}\\0${id}`;',
        replace: 'return `${key.tenantId}\\0${key.sessionId}\\0${id}`;',
      },
    ],
  },
  {
    id: 'T14-admits-reads-empty-entry',
    arms: both,
    lanes: ['ts'],
    desc: 'admits reads an entry a revocation created without a grant',
    edits: [
      {
        file: `${CORE}/managed-operation-grant-gate.ts`,
        find: `    if (entry?.grant === undefined) return false;
    const { grant } = entry;`,
        replace: `    if (entry === undefined) return false;
    const grant = entry.grant!;`,
      },
    ],
  },
  // (7) R3-12: the reopen skip and the build-time tripwire.
  {
    id: 'T15-envelope-skip-deleted',
    arms: head,
    lanes: ['ts'],
    desc: 'delete the pre-registration envelope skip in loadExtensionRevision',
    edits: [
      {
        file: `${CORE}/managed-session-authority.ts`,
        find: `    if (isPreRegistrationEnvelope(value)) {
      return null;
    }
`,
        replace: '',
      },
    ],
  },
  {
    id: 'T16-goal-state-body-registered',
    arms: both,
    lanes: ['ts'],
    desc: 'register a record body for the envelope domain goal_state',
    edits: [
      {
        file: `${CORE}/managed-extension-projection.ts`,
        find: `  monitor_run: Object.freeze({
    taskKind: 'monitor',`,
        replace: GOAL_STATE_BODY,
      },
    ],
  },
];

export const JSON_FNS = {
  contractVersion2(o) {
    if (o.contractVersion !== 1) throw new Error('contractVersion is not 1');
    o.contractVersion = 2;
  },
  seventhViewField(o) {
    const view = o.historyCases[0].revisions[0].view;
    if (Object.keys(view).length !== 6) throw new Error('view is not 6 keys');
    view.extra = null;
  },
  renameTaskKind(o) {
    const i = o.taskKinds.indexOf('automation_run');
    if (i < 0) throw new Error('no automation_run');
    o.taskKinds[i] = 'automation';
  },
  tenthLimit(o) {
    if (Object.keys(o.limits).length !== 9) throw new Error('limits not 9');
    o.limits.maxHeaderBytes = 65536;
  },
  thirdHeader(o) {
    if (Object.keys(o.headers).length !== 2) throw new Error('headers not 2');
    o.headers.requestId = 'X-Qwen-Request-Id';
  },
  emptyHistories(o) {
    if (!(o.historyCases.length > 0)) throw new Error('no historyCases');
    o.historyCases = [];
  },
};
