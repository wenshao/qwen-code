// Mutants for PR 13109 (head cb322eed). Each entry: id, file, find, replace,
// suite (cli | core | java), and what the mutant undoes.
const SESSION = 'packages/cli/src/serve/hosted-mcp-session.ts';
const RUNTIME = 'packages/cli/src/serve/managed-mcp-runtime.ts';
const RECORD = 'packages/core/src/managed-runtime/managed-mcp-record.ts';
const JAVA = 'packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ManagedMcpRecords.java';

const FAST = `      try {
        await this.acquireOwner();
      } catch (cause) {
        // Older writers did not persist drain receipts before owner release.
        if (
          !(cause instanceof HostedWorkspaceBrokerRejection) ||
          cause.status !== 409 ||
          ![
            'runtime_session_not_ready',
            'runtime_session_not_acquirable',
          ].includes(String(cause.code))
        )
          throw cause;
        await this.broker.release();
        await this.markReleased(configurations);
        return;
      }`;

module.exports = [
  { id: 'H1', suite: 'cli', file: SESSION, what: 'recoveryBlocked ignores drained',
    find: `          entry.releaseState === 'releasing' ||
          entry.releaseState === 'drained',`,
    replace: `          entry.releaseState === 'releasing',` },
  { id: 'H2', suite: 'cli', file: SESSION, what: 'fast path without the connectionGeneration check',
    find: `          entry.releaseState === 'releasing' &&
          entry.connectionGeneration !== null,
      ) &&`,
    replace: `          entry.releaseState === 'releasing',
      ) &&` },
  { id: 'H3', suite: 'cli', file: SESSION, what: 'fast path without the "no active configuration" check',
    find: `      configurations.every((entry) => entry.releaseState !== 'active')
    ) {`,
    replace: `      true
    ) {` },
  { id: 'H4', suite: 'cli', file: SESSION, what: 'base order restored: Broker release first, errors swallowed',
    find: FAST,
    replace: `      try {
        await this.broker.release();
        await this.markReleased(configurations);
        return;
      } catch {
        // base behaviour
      }` },
  { id: 'H5', suite: 'cli', file: SESSION, what: 'fallback on any Broker rejection status (not only 409)',
    find: `          cause.status !== 409 ||
`,
    replace: `` },
  { id: 'H6', suite: 'cli', file: SESSION, what: 'fallback no longer accepts runtime_session_not_ready',
    find: `            'runtime_session_not_ready',
            'runtime_session_not_acquirable',`,
    replace: `            'runtime_session_not_acquirable',` },
  { id: 'H7', suite: 'cli', file: SESSION, what: 'fallback no longer accepts runtime_session_not_acquirable',
    find: `            'runtime_session_not_ready',
            'runtime_session_not_acquirable',`,
    replace: `            'runtime_session_not_ready',` },
  { id: 'H8', suite: 'cli', file: SESSION, what: 'fallback on any 409 Broker rejection (code ignored)',
    find: `          cause.status !== 409 ||
          ![
            'runtime_session_not_ready',
            'runtime_session_not_acquirable',
          ].includes(String(cause.code))
        )`,
    replace: `          cause.status !== 409
        )` },
  { id: 'H9', suite: 'cli', file: SESSION, what: 'fallback also on non-rejection errors (network)',
    find: `        if (
          !(cause instanceof HostedWorkspaceBrokerRejection) ||
          cause.status !== 409 ||
          ![
            'runtime_session_not_ready',
            'runtime_session_not_acquirable',
          ].includes(String(cause.code))
        )
          throw cause;`,
    replace: `        if (
          cause instanceof HostedWorkspaceBrokerRejection &&
          (cause.status !== 409 ||
            ![
              'runtime_session_not_ready',
              'runtime_session_not_acquirable',
            ].includes(String(cause.code)))
        )
          throw cause;` },
  { id: 'H10', suite: 'cli', file: SESSION, what: 'fallback marks released without asking the Broker',
    find: `          throw cause;
        await this.broker.release();
        await this.markReleased(configurations);
        return;`,
    replace: `          throw cause;
        await this.markReleased(configurations);
        return;` },
  { id: 'H11', suite: 'cli', file: SESSION, what: 'drained records are not skipped on retry',
    find: `      if (configuration.releaseState === 'drained') continue;
`,
    replace: `` },
  { id: 'H12', suite: 'cli', file: SESSION, what: 'no drained commit for a never-dispatched configuration',
    find: `            releaseState: 'releasing',
          });
        await this.commitConfiguration({
          ...configuration,
          releaseState: 'drained',
        });
        continue;`,
    replace: `            releaseState: 'releasing',
          });
        continue;` },
  { id: 'H13', suite: 'cli', file: SESSION, what: 'no drained commit after a settled release',
    find: `        throw new HostedMcpRecoveryRequiredError();
      await this.commitConfiguration({
        ...configuration,
        releaseState: 'drained',
      });
    }
    await this.broker.release();`,
    replace: `        throw new HostedMcpRecoveryRequiredError();
    }
    await this.broker.release();` },
  { id: 'T1', suite: 'cli', file: RUNTIME, what: 'no late settlement after a drain timeout',
    find: `        void connection.closeDone.then(() =>
          this.settled(operation, { response: { released: true } }),
        );
`,
    replace: `` },
  { id: 'T2', suite: 'cli', file: RUNTIME, what: 'timed-out release settles at once, without physical closure',
    find: `        this.unknown(operation, 'managed_mcp_drain_unknown');
        void connection.closeDone.then(() =>
          this.settled(operation, { response: { released: true } }),
        );
        return;`,
    replace: `        this.settled(operation, { response: { released: true } });
        return;` },
  { id: 'C1', suite: 'core', file: RECORD, what: 'parser rejects drained',
    find: `    body.releaseState !== 'drained' &&
`,
    replace: `` },
  { id: 'C2', suite: 'core', file: RECORD, what: 'releasing → drained is not a successor',
    find: `        (before.releaseState === 'releasing' &&
          after.releaseState === 'drained') ||
`,
    replace: `` },
  { id: 'C3', suite: 'core', file: RECORD, what: 'drained → released is not a successor',
    find: `        (before.releaseState === 'drained' &&
          after.releaseState === 'released') ||
`,
    replace: `` },
  { id: 'C4', suite: 'core', file: RECORD, what: 'any state → drained accepted (active → drained, released → drained)',
    find: `        (before.releaseState === 'releasing' &&
          after.releaseState === 'drained') ||`,
    replace: `        after.releaseState === 'drained' ||` },
  { id: 'C5', suite: 'core', file: RECORD, what: 'drained → any state accepted (drained → releasing)',
    find: `        (before.releaseState === 'drained' &&
          after.releaseState === 'released') ||`,
    replace: `        before.releaseState === 'drained' ||` },
  { id: 'J1', suite: 'java', file: JAVA, what: 'Java store rejects drained',
    find: `List.of("active", "releasing", "drained", "released")`,
    replace: `List.of("active", "releasing", "released")` },
  { id: 'J2', suite: 'java', file: JAVA, what: 'Java: releasing → drained is not a successor',
    find: `                            || "releasing".equals(before) && "drained".equals(after)
`,
    replace: `` },
  { id: 'J3', suite: 'java', file: JAVA, what: 'Java: drained → released is not a successor',
    find: `                            || "drained".equals(before) && "released".equals(after)
`,
    replace: `` },
  { id: 'J4', suite: 'java', file: JAVA, what: 'Java: any state → drained accepted',
    find: `|| "releasing".equals(before) && "drained".equals(after)`,
    replace: `|| "drained".equals(after)` },
  { id: 'J5', suite: 'java', file: JAVA, what: 'Java: drained → any state accepted',
    find: `|| "drained".equals(before) && "released".equals(after)`,
    replace: `|| "drained".equals(before)` },
];
