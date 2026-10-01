// S7: rollback / mixed fleet. A Workspace-bound Session whose journal holds message.delta events
// (written by the PR's Harness) is later opened by a Harness running the BASE build. The base
// server has no way to supply an actor principal in a packaged stack, so the old Harness is asked
// to load the Session directly, with the same request its coordinator would send.
// usage: tsx s7-mixed-version.ts <label> <base-tree>   (cwd = PR tree)
import { createRig, freePort } from './stack.js';

const label = process.argv[2] ?? 's7';
const baseTree = process.argv[3];
if (!baseTree) throw new Error('base tree required');
const rig = await createRig({ label, workspace: true, durable: process.platform === 'linux' });
let failure: unknown;
try {
  await rig.startModel(() => ({ contentChunks: ['NEW_', 'BUILD_', 'ANSWER'] }));
  const portA = await freePort();
  const createBodies = new Map<string, string>();
  const tapA = await rig.tap('newCoordinator->newHarness', `http://127.0.0.1:${portA}`, (info) => {
    if (info.method === 'POST' && info.path === '/session')
      createBodies.set(String((JSON.parse(info.body) as { sessionId?: string }).sessionId), info.body);
    return 'pass';
  });
  const springA = await rig.startSpring('new', { harnessUrl: tapA.baseUrl });
  const harnessA = await rig.startHarness('new', { port: portA, brokerUrl: `http://127.0.0.1:${springA.brokerPort}` });
  const session = await rig.createSession(springA.url, 'S7_FIRST. Reply exactly NEW_BUILD_ANSWER.');
  const first = await rig.waitTerminal(springA.url, session.id, 0, 90_000);
  // Control: an unbound Session journals no message.delta events under either build.
  const control = await rig.createSession(springA.url, 'S7_CONTROL. Reply exactly NEW_BUILD_ANSWER.', false);
  const controlTerminal = await rig.waitTerminal(springA.url, control.id, 0, 90_000);
  const filter = rig.sessionFilter(session.id);
  const journalTx = rig.sql(`SELECT COUNT(*) FROM qwen_managed_agent.qwen_managed_session_journal_tx WHERE ${filter}`);
  const text = (await rig.events(springA.url, session.id, 0))
    .filter((e) => e.type === 'item.output_text.delta')
    .map((e) => String(e.data?.['text'] ?? ''));
  await rig.kill9(harnessA, true);
  await rig.until(
    'writer lease expiry',
    () =>
      rig.sql(
        `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
      ) === '1',
    15_000,
  );
  const load = async (tree: string | undefined, name: string, target = session.id) => {
    const createBody = createBodies.get(target) ?? '{}';
    const targetFilter = rig.sessionFilter(target);
    const harness = await rig.startHarness(name, {
      brokerUrl: `http://127.0.0.1:${springA.brokerPort}`,
      ...(tree ? { tree } : {}),
    });
    const auth = { authorization: `Bearer ${rig.harnessToken}` };
    // /health answers during bootstrap; session routes exist only once the runtime app is up.
    let capabilities: { hostedHarness?: { bootId?: string } } = {};
    await rig.until(
      'runtime capabilities',
      async () => {
        capabilities = (await (await fetch(`${harness.url}/capabilities`, { headers: auth })).json()) as typeof capabilities;
        const probe = await fetch(`${harness.url}/session/00000000-0000-4000-8000-000000000000/status`, { headers: auth });
        return capabilities.hostedHarness?.bootId !== undefined && (await probe.text()) !== 'Not Found';
      },
      30_000,
    );
    const created = JSON.parse(createBody) as { managedSessionStore: Record<string, unknown>; toolProfile?: string };
    const response = await fetch(`${harness.url}/session/${target}/load`, {
      method: 'POST',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'x-qwen-harness-protocol-version': '1',
        'x-qwen-harness-boot-id': String(capabilities.hostedHarness?.bootId),
      },
      body: JSON.stringify({
        managedSessionStore: { ...created.managedSessionStore, writerId: capabilities.hostedHarness?.bootId },
        ...(created.toolProfile ? { toolProfile: created.toolProfile } : {}),
      }),
    });
    const body = (await response.text()).slice(0, 120);
    await rig.kill9(harness, true);
    await rig.until(
      'writer lease expiry',
      () =>
        rig.sql(
          `SELECT IF(writer_lease_until IS NULL OR writer_lease_until < CURRENT_TIMESTAMP(6), 1, 0) FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${targetFilter}`,
        ) === '1',
      15_000,
    );
    return `${response.status} ${body}`;
  };
  const result = {
    label,
    platform: `${process.platform} ${process.arch}`,
    db: rig.dbVersion,
    newBuildTurn: first?.type ?? 'NONE',
    newBuildPublicTextDeltas: text,
    journalTransactions: Number(journalTx),
    controlTurn: controlTerminal?.type ?? 'NONE',
    'bound Session (journal has message.delta) loaded by a BASE-build Harness': await load(baseTree, 'old'),
    'bound Session loaded by another PR-build Harness': await load(undefined, 'new2'),
    'unbound Session (no message.delta) loaded by a BASE-build Harness': await load(baseTree, 'old2', control.id),
    journalHeadAfter: rig.sql(
      `SELECT state, recovery_status, IFNULL(recovery_detail_code,'-') FROM qwen_managed_agent.qwen_managed_session_journal_head WHERE ${filter}`,
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
