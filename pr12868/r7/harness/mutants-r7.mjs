// PR #12868 round 7: mutants of the lines commit e94f781523 adds, new anchors
// for earlier mutants whose lines it rewrote, and the earlier mutants it made
// pointless.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const SERVE = 'packages/cli/src/serve';
const PROTOCOL = `${SERVE}/managed-runtime-provider-protocol.ts`;
const WORKER = `${SERVE}/managed-runtime-provider-worker.ts`;
const CLIENT = `${SERVE}/broker-managed-runtime-provider.ts`;
const SERVICE = `${BROKER}/RuntimeBrokerService.java`;
const TRANSPORT = `${BROKER}/HttpRuntimeTransport.java`;

const RECEIPT_RULE = `                if (owned.session().getState() != RuntimeSessionRecord.State.READY
                        || binding.getState() != RuntimeBindingRecord.State.READY
                                && binding.getState() != RuntimeBindingRecord.State.DRAINING) {
                    return CompletableFuture.completedFuture(stored);
                }`;

// I2 removed the null guard of a lookup the cancel branch no longer makes: the
// ownership check hands the rows over, and refuses a record without them.
export const superseded7 = new Set(['I2']);

export const reanchored7 = {
  G2: { find: RECEIPT_RULE, replace: '' },
  G3: {
    find: '                if (owned.session().getState() != RuntimeSessionRecord.State.READY\n',
    replace: '                if (owned.session().getState() == RuntimeSessionRecord.State.READY\n',
  },
  I1: {
    find: '                if (owned.session().getState() != RuntimeSessionRecord.State.READY\n',
    replace: '                if (owned.session().getState() == RuntimeSessionRecord.State.RELEASED\n',
  },
  K35: {
    find: `                if (owned.session().getState() != RuntimeSessionRecord.State.READY
                        || binding.getState() != RuntimeBindingRecord.State.READY
                                && binding.getState() != RuntimeBindingRecord.State.DRAINING) {`,
    replace: '                if (owned.session().getState() != RuntimeSessionRecord.State.READY) {',
  },
  K33: {
    find: `        requireOpen();
        String harnessId = BrokerValues.requirePathSafe(
                BrokerValues.requireId(harnessSessionId, "harnessSessionId"),
                "harnessSessionId");
        String runtimeId = BrokerValues.requirePathSafe(`,
    replace: `        requireOpen();
        String harnessId = BrokerValues.requireId(harnessSessionId,
                "harnessSessionId");
        String runtimeId = BrokerValues.requirePathSafe(`,
  },
  K28: {
    find: `        } finally {
          forgetSession(session.identity.runtimeSessionId);
        }`,
    replace: `        } finally {
          // kept
        }`,
  },
  N11: {
    find: "          Object.keys(body).filter((key) => key !== 'details').length === 3 &&\n",
    replace: '',
  },
};

export const round7 = [
  // ---- the worker: released Sessions ------------------------------------
  { id: 'L1', suite: 'ts', file: WORKER, what: 'released Sessions are never retired (no bound)',
    find: 'const RETAINED_RELEASED_SESSIONS = 8;', replace: 'const RETAINED_RELEASED_SESSIONS = 1_000_000;' },
  { id: 'L2', suite: 'ts', file: WORKER, what: 'nine released Sessions are kept, not eight',
    find: 'const RETAINED_RELEASED_SESSIONS = 8;', replace: 'const RETAINED_RELEASED_SESSIONS = 9;' },
  { id: 'L3', suite: 'ts', file: WORKER, what: 'seven released Sessions are kept, not eight',
    find: 'const RETAINED_RELEASED_SESSIONS = 8;', replace: 'const RETAINED_RELEASED_SESSIONS = 7;' },
  { id: 'L4', suite: 'ts', file: WORKER, what: 'a retirement does not dispose the runtime',
    find: '      () => value?.runtime.dispose(),\n', replace: '' },
  { id: 'L5', suite: 'ts', file: WORKER, what: 'a retirement does not drain the file history',
    find: '      () => value?.history?.drain(),\n      () =>\n        value?.config.shutdown({', replace: '      () =>\n        value?.config.shutdown({' },
  { id: 'L6', suite: 'ts', file: WORKER, what: 'a retirement does not shut the Config down',
    find: `      () =>
        value?.config.shutdown({
          shutdownTelemetry: false,
          skipSessionWriter: true,
        }),
`, replace: '' },
  { id: 'L7', suite: 'ts', file: WORKER, what: 'the Config of a retired Session shuts telemetry down',
    find: '          shutdownTelemetry: false,\n          skipSessionWriter: true,', replace: '          shutdownTelemetry: true,\n          skipSessionWriter: true,' },
  { id: 'L8', suite: 'ts', file: WORKER, what: 'the Config of a retired Session flushes the session writer',
    find: '          shutdownTelemetry: false,\n          skipSessionWriter: true,', replace: '          shutdownTelemetry: false,\n          skipSessionWriter: false,' },
  { id: 'L9', suite: 'ts', file: WORKER, what: 'a retired Session keeps its runtime (no tombstone)',
    find: '    entry.value = undefined;\n    entry.ready = undefined;\n', replace: '' },
  { id: 'L10', suite: 'ts', file: WORKER, what: 'a step that fails ends the retirement',
    find: '      } catch (error) {\n        errors.push(error);\n      }', replace: '      } catch (error) {\n        throw error;\n      }' },
  { id: 'L11', suite: 'ts', file: WORKER, what: 'a retirement that failed reports nothing',
    find: '    if (errors.length > 0)\n      throw new AggregateError(', replace: '    if (false)\n      throw new AggregateError(' },
  { id: 'L12', suite: 'ts', file: WORKER, what: 'a tombstone refuses status and cancel instead of answering unknown',
    find: "      if (operation.kind === 'status' || operation.kind === 'cancel')\n        return { state: 'unknown' };\n", replace: '' },
  { id: 'L13', suite: 'ts', file: WORKER, what: 'a tombstone answers unknown to every operation',
    find: "      if (operation.kind === 'status' || operation.kind === 'cancel')\n        return { state: 'unknown' };\n", replace: "      return { state: 'unknown' };\n" },
  { id: 'L14', suite: 'ts', file: WORKER, what: 'the newest idle Session is retired, not the oldest',
    find: '      const index = this.released.findIndex((entry) => entry.pending === 0);', replace: '      const index = this.released.findLastIndex((entry) => entry.pending === 0);' },
  { id: 'L15', suite: 'ts', file: WORKER, what: 'a Session is retired while it is being observed',
    find: '      const index = this.released.findIndex((entry) => entry.pending === 0);', replace: '      const index = this.released.findIndex(() => true);' },
  { id: 'L16', suite: 'ts', file: WORKER, what: 'a released Session is not queued for retirement',
    find: '        this.released.push(entry);\n', replace: '' },
  { id: 'L17', suite: 'ts', file: WORKER, what: 'a release retires nothing',
    find: '        await this.retireReleased();\n', replace: '' },
  { id: 'L18', suite: 'ts', file: WORKER, what: 'a retirement that failed fails the release that triggered it',
    find: `      await retire(entry).catch((error: unknown) =>
        debugLogger.warn('Retiring a released Session failed:', error),
      );`, replace: '      await retire(entry);' },
  { id: 'L19', suite: 'ts', file: WORKER, what: 'close() retires nothing',
    find: '          await session.ready;\n          await retire(session);\n', replace: '          await session.ready;\n' },
  { id: 'L20', suite: 'ts', file: WORKER, what: 'a release retires at most one Session',
    find: '    while (this.released.length > RETAINED_RELEASED_SESSIONS) {', replace: '    if (this.released.length > RETAINED_RELEASED_SESSIONS) {' },
  { id: 'L21', suite: 'ts', file: WORKER, what: 'every caller starts its own retirement',
    find: '  entry.retirement ??= (async () => {', replace: '  entry.retirement = (async () => {' },
  { id: 'L22', suite: 'ts', file: WORKER, what: 'the bound counts one Session too many (>= instead of >)',
    find: '    while (this.released.length > RETAINED_RELEASED_SESSIONS) {', replace: '    while (this.released.length >= RETAINED_RELEASED_SESSIONS) {' },
  // ---- confirmation results ----------------------------------------------
  { id: 'L23', suite: 'ts', file: PROTOCOL, what: 'an edit confirmation without fileDiff is accepted',
    find: "        edit: ['fileName', 'filePath', 'fileDiff', 'newContent'],", replace: "        edit: ['fileName', 'filePath', 'newContent']," },
  { id: 'L24', suite: 'ts', file: PROTOCOL, what: 'an exec confirmation without rootCommand is accepted',
    find: "        exec: ['command', 'rootCommand'],", replace: "        exec: ['command']," },
  { id: 'L25', suite: 'ts', file: PROTOCOL, what: 'an mcp confirmation without toolDisplayName is accepted',
    find: "        mcp: ['serverName', 'toolName', 'toolDisplayName'],", replace: "        mcp: ['serverName', 'toolName']," },
  { id: 'L26', suite: 'ts', file: PROTOCOL, what: 'an info confirmation without prompt is accepted',
    find: "        info: ['prompt'],", replace: '        info: [],' },
  { id: 'L27', suite: 'ts', file: PROTOCOL, what: 'an edit confirmation may carry any originalContent',
    find: `        required.some((key) => typeof result[key] !== 'string') ||
        (result['type'] === 'edit' &&
          result['originalContent'] !== null &&
          typeof result['originalContent'] !== 'string')`, replace: "        required.some((key) => typeof result[key] !== 'string')" },
  { id: 'L28', suite: 'ts', file: PROTOCOL, what: 'no variant requires its fields',
    find: "        required.some((key) => typeof result[key] !== 'string') ||", replace: '        false ||' },
  // ---- the Broker client ---------------------------------------------------
  { id: 'L29', suite: 'ts', file: CLIENT, what: 'an error that carries details loses its reason again',
    find: "          Object.keys(body).filter((key) => key !== 'details').length === 3 &&", replace: '          Object.keys(body).length === 3 &&' },
  { id: 'L30', suite: 'ts', file: CLIENT, what: 'details of any type are accepted',
    find: `          (details === undefined ||
            (details !== null &&
              typeof details === 'object' &&
              !Array.isArray(details))) &&
`, replace: '' },
  // ---- the Broker ----------------------------------------------------------
  { id: 'L31', suite: 'broker', file: SERVICE, what: 'warm does not apply the rule to the Harness Session id',
    find: `        String harnessId = BrokerValues.requirePathSafe(
                BrokerValues.requireId(harnessSessionId, "harnessSessionId"),
                "harnessSessionId");
        return resolveScope(harnessId)`, replace: `        String harnessId = BrokerValues.requireId(harnessSessionId,
                "harnessSessionId");
        return resolveScope(harnessId)` },
  { id: 'L32', suite: 'broker', file: TRANSPORT, what: 'the response buffer reserves the whole cap again',
    find: '            this.bytes = new byte[Math.min(limit, 8192)];', replace: '            this.bytes = new byte[limit];' },
  { id: 'L33', suite: 'broker', file: TRANSPORT, what: 'the response buffer grows past the cap',
    find: `                bytes = Arrays.copyOf(bytes, (int) Math.min(limit,
                        Math.max(2L * bytes.length, (long) size + count)));`, replace: `                bytes = Arrays.copyOf(bytes, (int) Math.max(2L * bytes.length,
                        (long) size + count));` },
  { id: 'L34', suite: 'broker', file: TRANSPORT, what: 'the response buffer grows to the needed size only (no doubling)',
    find: `                bytes = Arrays.copyOf(bytes, (int) Math.min(limit,
                        Math.max(2L * bytes.length, (long) size + count)));`, replace: `                bytes = Arrays.copyOf(bytes, (int) Math.min(limit,
                        (long) size + count));` },
  { id: 'L35', suite: 'broker', file: SERVICE, what: 'the ownership check of a terminal record no longer compares the generation',
    find: '            if (binding == null || binding.getGeneration() != record.getRuntimeGeneration()', replace: '            if (binding == null' },
];
